import { mat4 } from 'gl-matrix';
import { ClipRect, DrawApi, RGBA } from '../draw';
import type { CharacterInfo } from './FontAtlas';
import type { FrameTimer } from './FrameTimer';
import type { ContextListener, Renderer } from './Renderer';
import { WebGL2Backend, scissorBox } from './WebGL2Backend';

/**
 * The one arithmetic in `WebGL2Backend` that a golden depends on and a reader
 * cannot check by eye. No GL and no DOM: `scissorBox` is a pure function so it
 * can be tested at all (R14.1).
 *
 * The expected values are the expression the deleted `Layer.ts` block ran,
 * written out longhand rather than by calling the function under test:
 *
 *     webglX      = Math.floor(screenX * dpr)
 *     webglY      = Math.floor((canvas.height / dpr - screenY - height) * dpr)
 *     webglWidth  = Math.floor(width * dpr)
 *     webglHeight = Math.floor(height * dpr)
 */

function clip(x: number, y: number, width: number, height: number): ClipRect {
	return { minX: x, minY: y, maxX: x + width, maxY: y + height };
}

describe('scissorBox', () => {
	it('converts the developer screen panel at ratio 1', () => {
		// The real clip on developerScreen and cardShowcaseScreen, at the
		// harness's pinned 1440x882 viewport and deviceScaleFactor 1.
		expect(scissorBox(clip(0, 80, 1440, 722), 1, 882)).toEqual({
			x: 0,
			y: Math.floor(882 / 1 - 80 - 722),
			width: 1440,
			height: 722,
		});
	});

	it('scales the box and the flip by the ratio', () => {
		// Same logical rect on a 2x display: the canvas is twice as tall in
		// device pixels, so the logical height it divides back to is unchanged.
		expect(scissorBox(clip(0, 80, 1440, 722), 2, 1764)).toEqual({
			x: 0,
			y: Math.floor((1764 / 2 - 80 - 722) * 2),
			width: 2880,
			height: 1444,
		});
	});

	it('floors each of the four components independently', () => {
		const box = scissorBox(clip(10.6, 20.4, 100.7, 50.9), 1.5, 1323);
		expect(box).toEqual({
			x: Math.floor(10.6 * 1.5),
			y: Math.floor((1323 / 1.5 - 20.4 - 50.9) * 1.5),
			width: Math.floor(100.7 * 1.5),
			height: Math.floor(50.9 * 1.5),
		});
		// Flooring width separately from x is what makes the box narrower than
		// the rect rather than shifted, which is the behaviour the goldens hold.
		expect(box.width).toBe(151);
	});

	it('puts a rect at the bottom of the canvas at scissor y zero', () => {
		expect(scissorBox(clip(0, 800, 100, 82), 1, 882).y).toBe(0);
	});

	it('flips a rect at the top of the canvas to the far side', () => {
		expect(scissorBox(clip(0, 0, 100, 100), 1, 882).y).toBe(782);
	});
});

// -- the backend against a recording WebGL2 context ---------------------------

interface GlCall {
	name: string;
	args: unknown[];
	result: unknown;
}

/**
 * Every synchronous entry point R15.22 bans inside the frame loop, plus the
 * program and location queries this backend makes only at creation. None may
 * appear between `beginFrame` and `endFrame`.
 */
const SYNCHRONOUS = [
	'getError',
	'getParameter',
	'checkFramebufferStatus',
	'readPixels',
	'getBufferSubData',
	'finish',
	'clientWaitSync',
	'getProgramParameter',
	'getShaderParameter',
	'getUniformLocation',
	'getAttribLocation',
	'getUniformBlockIndex',
	'getExtension',
];

/**
 * A WebGL2 context that answers the way a real one does at creation and
 * records everything. Constants are distinct numbers derived from their names,
 * so `gl.ARRAY_BUFFER` and `gl.ELEMENT_ARRAY_BUFFER` never compare equal by
 * accident.
 */
function fakeGl(): { gl: WebGL2RenderingContext; calls: GlCall[]; constant: (name: string) => number } {
	const calls: GlCall[] = [];
	const constants = new Map<string, number>();
	const constant = (name: string): number => {
		let value = constants.get(name);
		if (value === undefined) {
			value = 0x1000 + constants.size;
			constants.set(name, value);
		}
		return value;
	};
	let objects = 0;
	const answers: Record<string, () => unknown> = {
		getParameter: () => 256,
		getProgramParameter: () => true,
		getShaderParameter: () => true,
		getUniformBlockIndex: () => 0,
		getUniformLocation: () => ({ uniform: true }),
	};
	const gl = new Proxy({}, {
		get(_target, property: string) {
			if (/^[A-Z0-9_]+$/.test(property)) return constant(property);
			return (...args: unknown[]) => {
				let result: unknown;
				if (answers[property]) result = answers[property]();
				else if (property.startsWith('create')) result = { object: property, id: ++objects };
				calls.push({ name: property, args, result });
				return result;
			};
		},
	});
	return { gl: gl as WebGL2RenderingContext, calls, constant };
}

class FakeAtlas {
	readonly texture = { texture: 'atlas' };
	private readonly glyph: CharacterInfo = { x: 0, y: 0, width: 0.05, height: 0.05, offsetX: 0, offsetY: 0, advance: 10 };

	getCharacter(char: string): CharacterInfo | null {
		return char === ' ' ? null : this.glyph;
	}

	getFontSize(): number {
		return 32;
	}

	getAtlasSize(): number {
		return 512;
	}

	measureText(text: string): { width: number; height: number } {
		return { width: text.length * 10, height: 38 };
	}

	getTexture(): unknown {
		return this.texture;
	}
}

const WHITE: RGBA = [1, 1, 1, 1];

function setupBackend(options: { vertexRingBytes?: number; indexRingBytes?: number } = {}) {
	const { gl, calls, constant } = fakeGl();
	const listeners: ContextListener[] = [];
	const renderer = {
		canvas: { height: 600 },
		getContext: () => gl,
		getFontAtlas: () => new FakeAtlas(),
		addContextListener: (listener: ContextListener) => {
			listeners.push(listener);
			return () => undefined;
		},
	} as unknown as Renderer;
	const frameTimer = { recordDrawCall: jest.fn(), recordTextCharacters: jest.fn() } as unknown as FrameTimer;
	const backend = new WebGL2Backend({ renderer, frameTimer, ...options });
	const api = new DrawApi({ backend, development: true, legacyTextOrder: true });

	function frame(build: (draw: DrawApi) => void): GlCall[] {
		const start = calls.length;
		api.beginFrame({ viewport: { width: 800, height: 600 } });
		build(api);
		api.endFrame();
		return calls.slice(start);
	}

	const named = (list: GlCall[], name: string): GlCall[] => list.filter((call) => call.name === name);
	const restore = (): void => {
		for (const listener of listeners) listener.restored?.();
	};
	return { calls, constant, backend, frame, named, restore };
}

function someShapesAndText(draw: DrawApi): void {
	draw.drawRect({ rect: { x: 10, y: 10, width: 100, height: 40 }, fill: WHITE });
	draw.drawText({ text: 'Hi there', position: { x: 20, y: 20 }, font: 'body', size: 16, color: WHITE });
	draw.drawRect({ rect: { x: 10, y: 60, width: 100, height: 40 }, fill: WHITE, border: { color: WHITE, width: 2 } });
}

/** Three domains under `legacyTextOrder`: before, inside and after a clip. */
function clippedTwice(draw: DrawApi): void {
	someShapesAndText(draw);
	draw.pushClip({ x: 0, y: 0, width: 50, height: 50 });
	someShapesAndText(draw);
	draw.popClip();
	someShapesAndText(draw);
}

describe('WebGL2Backend', () => {
	it('allocates the rings and the uniform slots once, at their fixed capacity (R15.11, R15.15)', () => {
		const { calls, constant, named } = setupBackend({ vertexRingBytes: 3 * 1024 * 1024, indexRingBytes: 512 * 1024 });
		const sizes = named(calls, 'bufferData').map((call) => [call.args[0], call.args[1]]);
		expect(sizes).toEqual([
			[constant('UNIFORM_BUFFER'), 256 * 3],
			[constant('ARRAY_BUFFER'), 3 * 1024 * 1024],
			[constant('ELEMENT_ARRAY_BUFFER'), 512 * 1024],
		]);
	});

	it('makes no synchronous call and no allocation inside a frame (R15.22, R15.11)', () => {
		const { frame, named } = setupBackend();
		frame(clippedTwice);
		const calls = frame(clippedTwice);
		for (const name of SYNCHRONOUS) {
			expect(named(calls, name)).toEqual([]);
		}
		expect(named(calls, 'bufferData')).toEqual([]);
		expect(named(calls, 'texImage2D')).toEqual([]);
		expect(named(calls, 'uniform1i')).toEqual([]);
		expect(named(calls, 'uniformMatrix4fv')).toEqual([]);
	});

	it('clears once per frame with the scissor off, before any draw', () => {
		const { frame, constant } = setupBackend();
		const scissor = (call: GlCall, name: string) => call.name === name && call.args[0] === constant('SCISSOR_TEST');
		for (let index = 0; index < 2; index++) {
			const calls = frame(clippedTwice);
			const clear = calls.findIndex((call) => call.name === 'clear');
			expect(calls.filter((call) => call.name === 'clear')).toHaveLength(1);
			expect(clear).toBeLessThan(calls.findIndex((call) => call.name === 'drawElements'));
			expect(calls.slice(0, clear).some((call) => scissor(call, 'enable'))).toBe(false);
			// The clip frame one opened is closed again before its end, so frame
			// two's clear needs no disable of its own.
			const last = calls.filter((call) => scissor(call, 'enable') || scissor(call, 'disable')).at(-1);
			expect(last?.name).toBe('disable');
		}
	});

	it('writes the frame block once per frame into a rotating slot and binds that range', () => {
		const { frame, named, constant } = setupBackend();
		const slots: number[] = [];
		for (let index = 0; index < 4; index++) {
			const calls = frame(someShapesAndText);
			const writes = named(calls, 'bufferSubData').filter((call) => call.args[0] === constant('UNIFORM_BUFFER'));
			expect(writes).toHaveLength(1);
			const [range] = named(calls, 'bindBufferRange');
			expect(range.args[3]).toBe(writes[0].args[1]);
			expect(range.args[4]).toBe(128);
			slots.push(writes[0].args[1] as number);
		}
		expect(slots).toEqual([256, 512, 0, 256]);
	});

	it('puts the WebGL1 projection and an identity view in the frame block', () => {
		const { frame, named, constant } = setupBackend();
		const calls = frame(someShapesAndText);
		const write = named(calls, 'bufferSubData').find((call) => call.args[0] === constant('UNIFORM_BUFFER'));
		const block = write?.args[2] as Float32Array;
		const projection = mat4.ortho(mat4.create(), 0, 800, 600, 0, -1, 1);
		expect(Array.from(block.subarray(0, 16))).toEqual(Array.from(projection));
		expect(Array.from(block.subarray(16, 32))).toEqual(Array.from(mat4.create()));
	});

	it('uploads each domain into the rings with a source range and draws 32-bit indices from its offset', () => {
		const { frame, named, constant } = setupBackend();
		const first = frame(someShapesAndText);
		const second = frame(someShapesAndText);

		const writes = (calls: GlCall[], target: string) => named(calls, 'bufferSubData')
			.filter((call) => call.args[0] === constant(target))
			.map((call) => ({ offset: call.args[1] as number, srcOffset: call.args[3], length: call.args[4] as number }));
		const [firstVertices] = writes(first, 'ARRAY_BUFFER');
		const [secondVertices] = writes(second, 'ARRAY_BUFFER');
		const [firstIndices] = writes(first, 'ELEMENT_ARRAY_BUFFER');
		const [secondIndices] = writes(second, 'ELEMENT_ARRAY_BUFFER');

		expect(firstVertices.offset).toBe(0);
		expect(firstVertices.srcOffset).toBe(0);
		// The second frame writes after the first rather than over it.
		expect(secondVertices.offset).toBe(firstVertices.length * 4);
		expect(secondIndices.offset).toBe(firstIndices.length * 4);

		const [draw] = named(second, 'drawElements');
		expect(draw.args[2]).toBe(constant('UNSIGNED_INT'));
		expect(draw.args[3]).toBe(secondIndices.offset);
	});

	it('points the attributes once per upload, never per draw (R15.14)', () => {
		const { frame, named } = setupBackend();
		const calls = frame(clippedTwice);
		const uploads = named(calls, 'bindVertexArray').filter((call) => call.args[0] !== null).length;
		expect(uploads).toBe(3);
		expect(named(calls, 'vertexAttribPointer')).toHaveLength(uploads * 7);
	});

	it('binds the atlas once per frame, not once per upload (R5.20)', () => {
		const { frame, named } = setupBackend();
		const calls = frame(clippedTwice);
		expect(named(calls, 'bindTexture')).toHaveLength(1);
	});

	it('grows a ring that cannot hold two frames and says so, instead of overwriting one', () => {
		const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			// `clippedTwice` is three uploads of 36 vertices, 9504 bytes a frame;
			// a 9600-byte ring takes one frame and not the next beside it.
			const { frame, named, constant } = setupBackend({ vertexRingBytes: 9600 });
			const first = frame(clippedTwice);
			expect(named(first, 'bufferData')).toEqual([]);
			const calls = frame(clippedTwice);
			const grown = named(calls, 'bufferData').filter((call) => call.args[0] === constant('ARRAY_BUFFER'));
			expect(grown).toHaveLength(1);
			expect(grown[0].args[1]).toBeGreaterThanOrEqual(9600 * 2);
			expect(named(calls, 'deleteBuffer')).toHaveLength(1);
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('vertex ring grew'));
		} finally {
			warn.mockRestore();
		}
	});

	it('rebuilds every GPU resource on a restored context and starts the rings over (R15.5)', () => {
		const { frame, named, restore, constant, calls } = setupBackend();
		frame(someShapesAndText);
		const before = calls.length;
		restore();
		const rebuilt = calls.slice(before);
		expect(named(rebuilt, 'createProgram')).toHaveLength(1);
		expect(named(rebuilt, 'createVertexArray')).toHaveLength(1);
		expect(named(rebuilt, 'createBuffer')).toHaveLength(3);

		const next = frame(someShapesAndText);
		const [vertices] = named(next, 'bufferSubData').filter((call) => call.args[0] === constant('ARRAY_BUFFER'));
		expect(vertices.args[1]).toBe(0);
		// The frame binds the program the restore created, not the dead one.
		expect(named(next, 'useProgram')[0].args[0]).toBe(named(rebuilt, 'createProgram')[0].result);
		expect(named(next, 'bindVertexArray')[0].args[0]).toBe(named(rebuilt, 'createVertexArray')[0].result);
	});

	it('answers R4.2a text ink from the encoder', () => {
		const { backend } = setupBackend();
		const ink = backend.textInk({ text: 'Hi', position: { x: 10, y: 20 }, font: 'body', size: 32, color: WHITE });
		expect(ink).not.toBeNull();
		expect(ink?.width).toBeGreaterThan(0);
	});
});
