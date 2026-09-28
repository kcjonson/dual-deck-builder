import { mat4 } from 'gl-matrix';
import { DrawApi, RGBA } from '../draw';
import type { FrameTimer } from './FrameTimer';
import type { GpuTimer } from './GpuTimer';
import type { ContextListener, Renderer } from './Renderer';
import { WebGL2Backend } from './WebGL2Backend';
import { DEFAULT_INITIAL_INDEX_SLOTS } from './IndexBufferPool';
import { UBER_ATTRIBUTES, UBER_VERTEX } from './UberGeometryEncoder';
import { TextureStore } from '../gpu/TextureStore';
import { WebGL2TextureDevice } from './WebGL2TextureDevice';
import { committedFontAtlas } from '../text/testing';

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

const WHITE: RGBA = [1, 1, 1, 1];

function setupBackend(options: { vertexRingBytes?: number; indexSlots?: number; indexSlotBytes?: number; timed?: boolean } = {}) {
	const { gl, calls, constant } = fakeGl();
	const { timed, ...ringOptions } = options;
	// The timer's four calls land in the same log as the GL calls, so a test
	// can see what each pass bracketed.
	const timerCall = (name: string) => () => calls.push({ name: `timer.${name}`, args: [], result: undefined });
	const gpuTimer = timed
		? { beginFrame: timerCall('beginFrame'), beginPass: timerCall('beginPass'), endPass: timerCall('endPass'), endFrame: timerCall('endFrame') } as unknown as GpuTimer
		: null;
	const listeners: ContextListener[] = [];
	const renderer = {
		getContext: () => gl,
		textures: new TextureStore({ device: new WebGL2TextureDevice({ gl }) }),
		addContextListener: (listener: ContextListener) => {
			listeners.push(listener);
			return () => undefined;
		},
	} as unknown as Renderer;
	const frameTimer = { recordDrawCall: jest.fn(), recordTextCharacters: jest.fn() } as unknown as FrameTimer;
	const backend = new WebGL2Backend({ renderer, frameTimer, gpuTimer, ...ringOptions });
	// The body role's real metrics over a stand-in image: the tests here are
	// about GL calls, and glyph placement is the encoder's to test.
	const atlasTexture = renderer.textures.create({
		width: 2,
		height: 2,
		label: 'font atlas',
		source: new Uint8Array(16),
		content: 'mask',
		immediate: true,
	});
	backend.loadFontAtlas({ name: 'body', atlas: committedFontAtlas('body'), texture: atlasTexture });
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
	return { calls, constant, backend, api, frame, named, restore };
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
	it('brackets the clear and each sort domain as one GPU pass, never nested (R13.16)', () => {
		const { frame } = setupBackend({ timed: true });
		const calls = frame(clippedTwice).map((call) => call.name);

		expect(calls[0]).toBe('timer.beginFrame');
		expect(calls.at(-1)).toBe('timer.endFrame');
		let open = false;
		let passes = 0;
		for (const name of calls) {
			if (name === 'timer.beginPass') {
				expect(open).toBe(false);
				open = true;
				passes++;
			} else if (name === 'timer.endPass') {
				expect(open).toBe(true);
				open = false;
			} else if (name === 'clear' || name === 'drawElements') {
				expect(open).toBe(true);
			}
		}
		// The clear, then the three domains `clippedTwice` produces.
		expect(passes).toBe(4);
	});

	it('allocates the vertex ring, the index slots and the uniform slots once, at their fixed capacity (R15.11, R15.15)', () => {
		const { calls, constant, named } = setupBackend({ vertexRingBytes: 3 * 1024 * 1024, indexSlots: 4, indexSlotBytes: 8192 });
		const sizes = named(calls, 'bufferData').map((call) => [call.args[0], call.args[1]]);
		expect(sizes).toEqual([
			[constant('UNIFORM_BUFFER'), 256 * 3],
			[constant('ARRAY_BUFFER'), 3 * 1024 * 1024],
			[constant('ELEMENT_ARRAY_BUFFER'), 8192],
			[constant('ELEMENT_ARRAY_BUFFER'), 8192],
			[constant('ELEMENT_ARRAY_BUFFER'), 8192],
			[constant('ELEMENT_ARRAY_BUFFER'), 8192],
		]);
	});

	it('points the eight samplers at units 0 to 7 once, at creation (R5.20)', () => {
		const { calls, named } = setupBackend();
		const [samplers] = named(calls, 'uniform1iv');
		expect(Array.from(samplers.args[1] as Int32Array)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
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
		expect(named(calls, 'uniform1iv')).toEqual([]);
		expect(named(calls, 'uniformMatrix4fv')).toEqual([]);
	});

	it('clears once per frame before any draw, and never uses the scissor (R4.1)', () => {
		const { frame, constant } = setupBackend();
		for (let index = 0; index < 2; index++) {
			const calls = frame(clippedTwice);
			const clear = calls.findIndex((call) => call.name === 'clear');
			expect(calls.filter((call) => call.name === 'clear')).toHaveLength(1);
			expect(clear).toBeLessThan(calls.findIndex((call) => call.name === 'drawElements'));
			expect(calls.filter((call) => call.name === 'scissor')).toEqual([]);
			expect(calls.filter((call) => call.args[0] === constant('SCISSOR_TEST'))).toEqual([]);
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
			expect(range.args[4]).toBe(64);
			slots.push(writes[0].args[1] as number);
		}
		expect(slots).toEqual([256, 512, 0, 256]);
	});

	it('puts the logical-pixel projection in the frame block', () => {
		const { frame, named, constant } = setupBackend();
		const calls = frame(someShapesAndText);
		const write = named(calls, 'bufferSubData').find((call) => call.args[0] === constant('UNIFORM_BUFFER'));
		const block = write?.args[2] as Float32Array;
		const projection = mat4.ortho(mat4.create(), 0, 800, 600, 0, -1, 1);
		expect(Array.from(block)).toEqual(Array.from(projection));
	});

	it('uploads vertices into the ring with a source range and draws 32-bit indices from the start of their own slot', () => {
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
		// Indices always start their slot; the slot is what changes.
		expect(firstIndices).toMatchObject({ offset: 0, srcOffset: 0 });
		expect(secondIndices).toMatchObject({ offset: 0, srcOffset: 0 });

		const [draw] = named(second, 'drawElements');
		expect(draw.args[0]).toBe(constant('TRIANGLES'));
		expect(draw.args[2]).toBe(constant('UNSIGNED_INT'));
		expect(draw.args[3]).toBe(0);
	});

	it('gives each upload an element buffer no draw has read in the last two frames (R5.27, DDB-195)', () => {
		const { frame, named, constant } = setupBackend();
		const elementBuffers = (calls: GlCall[]) => named(calls, 'bindBuffer')
			.filter((call) => call.args[0] === constant('ELEMENT_ARRAY_BUFFER'))
			.map((call) => call.args[1]);
		const frames = [frame(clippedTwice), frame(clippedTwice), frame(clippedTwice), frame(clippedTwice)].map(elementBuffers);

		// Three domains, three distinct slots, in every frame.
		for (const buffers of frames) expect(new Set(buffers).size).toBe(3);
		// Nothing written in frame n is rewritten in frame n + 1; frame n + 2 may reuse it.
		for (let index = 1; index < frames.length; index++) {
			expect(frames[index].filter((buffer) => frames[index - 1].includes(buffer))).toEqual([]);
		}
		expect(new Set(frames.flat()).size).toBe(6);
	});

	it('binds each upload\'s element buffer inside its vertex array and draws before unbinding it', () => {
		const { frame, named, constant } = setupBackend();
		frame(clippedTwice);
		const calls = frame(clippedTwice);
		const vertexArray = named(calls, 'bindVertexArray').find((call) => call.args[0] !== null)?.args[0];
		let bound: unknown = null;
		let element: unknown = null;
		let uploads = 0;
		for (const call of calls) {
			if (call.name === 'bindVertexArray') {
				bound = call.args[0];
				element = null;
			} else if (call.name === 'bindBuffer' && call.args[0] === constant('ELEMENT_ARRAY_BUFFER')) {
				// Element binding is vertex array state: bound anywhere else it
				// would land on the default vertex array.
				expect(bound).toBe(vertexArray);
				element = call.args[1];
				uploads++;
			} else if (call.name === 'drawElements') {
				expect(bound).toBe(vertexArray);
				expect(element).not.toBeNull();
			}
		}
		expect(uploads).toBe(3);
	});

	it('creates a larger slot, once, for an upload that does not fit, and never allocates for it again', () => {
		const { frame, named, constant } = setupBackend({ indexSlots: 6, indexSlotBytes: 256 });
		const many = (draw: DrawApi) => {
			for (let index = 0; index < 40; index++) draw.drawRect({ rect: { x: index, y: 0, width: 4, height: 4 }, fill: WHITE });
		};
		const created = (calls: GlCall[]) => named(calls, 'bufferData').filter((call) => call.args[0] === constant('ELEMENT_ARRAY_BUFFER'));
		const firstThree = [frame(many), frame(many), frame(many)].map(created);
		// Forty quads are 240 indices, 960 bytes: over 256, so the first two
		// frames each create a 1024-byte slot, and the third reuses the first's,
		// which is two frames old by then (R5.27).
		expect(firstThree.map((calls) => calls.map((call) => call.args[1]))).toEqual([[1024], [1024], []]);
		for (let index = 0; index < 3; index++) expect(created(frame(many))).toEqual([]);
	});

	it('points the attributes once per upload, never per draw (R15.14)', () => {
		const { frame, named } = setupBackend();
		const calls = frame(clippedTwice);
		const uploads = named(calls, 'bindVertexArray').filter((call) => call.args[0] !== null).length;
		expect(uploads).toBe(3);
		expect(named(calls, 'vertexAttribPointer')).toHaveLength(uploads * UBER_ATTRIBUTES.length);
	});

	it('draws each domain, shapes, borders and text together, in one GPU draw (R5.1)', () => {
		const { frame, named } = setupBackend();
		// Three domains, each ended by the temporary `legacyTextOrder`
		// barrier; nothing inside a domain splits.
		expect(named(frame(clippedTwice), 'drawElements')).toHaveLength(3);
	});

	it('never splits on a clip change inside a domain (R4.1)', () => {
		const { backend } = setupBackend();
		const rect = { x: 0, y: 0, width: 10, height: 10 };
		// Without `legacyTextOrder` a clip push is not a barrier, so this is
		// one domain with three different clips in it.
		const api = new DrawApi({ backend, development: true });
		api.beginFrame({ viewport: { width: 800, height: 600 } });
		api.drawRect({ rect, fill: WHITE });
		api.pushClip({ x: 0, y: 0, width: 5, height: 5 });
		api.drawRect({ rect, fill: WHITE });
		api.popClip();
		api.drawRect({ rect, fill: WHITE });
		api.endFrame();
		expect(api.getStats().gpuDraws).toBe(1);
		expect(api.getStats().clipChange).toBe(0);
	});

	it('carries the clip in logical pixels on every vertex, at any ratio (R4.1, R4.4)', () => {
		const { calls, named, api, constant } = setupBackend();
		const start = calls.length;
		api.beginFrame({ viewport: { width: 400, height: 300 }, ratio: 2 });
		api.pushClip({ x: 10, y: 20, width: 100, height: 50 });
		api.drawRect({ rect: { x: 0, y: 0, width: 60, height: 60 }, fill: WHITE });
		api.popClip();
		api.endFrame();
		const [write] = named(calls.slice(start), 'bufferSubData').filter((call) => call.args[0] === constant('ARRAY_BUFFER'));
		const vertices = write.args[2] as Float32Array;
		for (let vertex = 0; vertex < 4; vertex++) {
			const offset = vertex * UBER_VERTEX.floats + UBER_VERTEX.clip;
			expect(Array.from(vertices.subarray(offset, offset + 4))).toEqual([10, 20, 110, 70]);
		}
	});

	it('binds the atlas and the placeholders once, and nothing on later frames (R5.20)', () => {
		const { frame, named } = setupBackend();
		// Unit 0 gets the atlas, units 1 to 7 the empty placeholder.
		expect(named(frame(clippedTwice), 'bindTexture')).toHaveLength(8);
		expect(named(frame(clippedTwice), 'bindTexture')).toHaveLength(0);
	});

	it('draws an image from a dynamic unit and puts the placeholder back at the end of the frame', () => {
		const { frame, named, api, constant } = setupBackend();
		const art = api.createTexture({ width: 2, height: 2, label: 'art', source: new Uint8Array(16) });
		frame(someShapesAndText);
		const calls = frame((draw) => {
			draw.drawImage({ rect: { x: 0, y: 0, width: 20, height: 20 }, texture: art });
		});
		const units = named(calls, 'activeTexture').map((call) => (call.args[0] as number) - constant('TEXTURE0'));
		// Unit 1 for the draw, then unit 1 again to restore the placeholder.
		expect(units).toEqual([1, 1]);
		expect(named(calls, 'drawElements')).toHaveLength(1);
	});

	it('grows a ring that cannot hold two frames and says so, instead of overwriting one', () => {
		const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			// `clippedTwice` is three uploads of 36 vertices at 128 bytes,
			// 13824 bytes a frame; a 14000-byte ring takes one frame and not
			// the next beside it.
			const { frame, named, constant } = setupBackend({ vertexRingBytes: 14000 });
			const first = frame(clippedTwice);
			expect(named(first, 'bufferData')).toEqual([]);
			const calls = frame(clippedTwice);
			const grown = named(calls, 'bufferData').filter((call) => call.args[0] === constant('ARRAY_BUFFER'));
			expect(grown).toHaveLength(1);
			expect(grown[0].args[1]).toBeGreaterThanOrEqual(14000 * 2);
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
		// The uniform ring, the vertex ring, and the initial index slots.
		expect(named(rebuilt, 'createBuffer')).toHaveLength(2 + DEFAULT_INITIAL_INDEX_SLOTS);

		const next = frame(someShapesAndText);
		const [vertices] = named(next, 'bufferSubData').filter((call) => call.args[0] === constant('ARRAY_BUFFER'));
		expect(vertices.args[1]).toBe(0);
		// The frame binds the program the restore created, not the dead one.
		expect(named(next, 'useProgram')[0].args[0]).toBe(named(rebuilt, 'createProgram')[0].result);
		expect(named(next, 'bindVertexArray')[0].args[0]).toBe(named(rebuilt, 'createVertexArray')[0].result);
		// And every unit again, since the old bindings died with the context.
		expect(named(next, 'bindTexture')).toHaveLength(8);
	});

	it('blends premultiplied over, set again after invalidateState and not on an ordinary frame (R5.22, R2.15)', () => {
		const { frame, named, backend, constant } = setupBackend();
		const fixedState = (calls: GlCall[]) => [
			...named(calls, 'blendFunc'),
			...named(calls, 'clearColor'),
			...named(calls, 'enable').filter((call) => call.args[0] === constant('BLEND')),
		];
		const first = frame(someShapesAndText);
		expect(fixedState(first)).toHaveLength(3);
		expect(named(first, 'blendFunc')[0].args).toEqual([constant('ONE'), constant('ONE_MINUS_SRC_ALPHA')]);
		expect(fixedState(frame(someShapesAndText))).toHaveLength(0);

		backend.invalidateState();
		const calls = frame(someShapesAndText);
		expect(fixedState(calls)).toHaveLength(3);
		const blend = calls.findIndex((call) => call.name === 'blendFunc');
		expect(blend).toBeLessThan(calls.findIndex((call) => call.name === 'clear'));
	});

	it('changes blend state for multiply and back, and not for additive (R5.22a)', () => {
		const { frame, named, constant } = setupBackend();
		frame(someShapesAndText);
		const rect = { x: 0, y: 0, width: 10, height: 10 };
		const calls = frame((draw) => {
			draw.drawRect({ rect, fill: WHITE });
			draw.drawRect({ rect, fill: WHITE, blend: 'additive' });
			draw.drawRect({ rect, fill: WHITE, blend: 'multiply' });
			draw.drawRect({ rect, fill: WHITE });
		});
		expect(named(calls, 'blendFunc').map((call) => call.args)).toEqual([
			[constant('DST_COLOR'), constant('ONE_MINUS_SRC_ALPHA')],
			[constant('ONE'), constant('ONE_MINUS_SRC_ALPHA')],
		]);
		expect(named(calls, 'drawElements')).toHaveLength(3);
	});

	it('uploads a queued texture at the top of the frame, before the clear, and not again (R5.32, R15.18)', () => {
		const { frame, named, api } = setupBackend();
		const art = api.createTexture({ width: 2, height: 2, label: 'art', source: new Uint8Array(16) });
		const first = frame(someShapesAndText);
		const upload = first.findIndex((call) => call.name === 'texSubImage2D');
		expect(upload).toBeGreaterThanOrEqual(0);
		expect(upload).toBeLessThan(first.findIndex((call) => call.name === 'clear'));
		expect(named(first, 'texStorage2D')).toHaveLength(1);
		expect(named(first, 'texImage2D')).toEqual([]);
		expect(api.isTextureResident(art)).toBe(true);

		expect(named(frame(someShapesAndText), 'texSubImage2D')).toEqual([]);
	});

	it('answers R4.2a text ink from the encoder', () => {
		const { backend } = setupBackend();
		const ink = backend.textInk({ text: 'Hi', position: { x: 10, y: 20 }, font: 'body', size: 32, color: WHITE });
		expect(ink).not.toBeNull();
		expect(ink?.width).toBeGreaterThan(0);
	});
});
