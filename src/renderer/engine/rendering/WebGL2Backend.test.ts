import { mat4 } from 'gl-matrix';
import { DrawApi, RGBA } from '../draw';
import type { FrameTimer } from './FrameTimer';
import type { GpuTimer } from './GpuTimer';
import type { ContextListener, Renderer } from './Renderer';
import { WebGL2Backend } from './WebGL2Backend';
import { UBER_ATTRIBUTES, UBER_FRAME_BLOCK, UBER_INSTANCE, UBER_MODE, UBER_STRIDE } from './UberGeometryEncoder';
import { TextureStore } from '../gpu/TextureStore';
import { WebGL2TextureDevice } from './WebGL2TextureDevice';
import { committedFontAtlas } from '../text/testing';
import type { FontRole } from '../text/fontFaces';

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
	// WEBGL_provoking_vertex, recording into the same log as the context.
	const provokingVertex = {
		FIRST_VERTEX_CONVENTION_WEBGL: 0x8e4d,
		provokingVertexWEBGL: (mode: number) => calls.push({ name: 'provokingVertexWEBGL', args: [mode], result: undefined }),
	};
	const answers: Record<string, (...args: unknown[]) => unknown> = {
		getExtension: (name) => (name === 'WEBGL_provoking_vertex' ? provokingVertex : null),
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
				if (answers[property]) result = answers[property](...args);
				else if (property.startsWith('create')) result = { object: property, id: ++objects };
				calls.push({ name: property, args, result });
				return result;
			};
		},
	});
	return { gl: gl as WebGL2RenderingContext, calls, constant };
}

const WHITE: RGBA = [1, 1, 1, 1];

/** The frame block, projection and rounded clip table, and the 256-aligned slot it sits in. */
const FRAME_BLOCK_BYTES = UBER_FRAME_BLOCK.floats * 4;
const FRAME_SLOT_BYTES = Math.ceil(FRAME_BLOCK_BYTES / 256) * 256;

interface SetupOptions {
	instanceRingBytes?: number;
	timed?: boolean;
	/** Font roles to load, each as its own resident atlas. */
	roles?: FontRole[];
}

function setupBackend(options: SetupOptions = {}) {
	const { gl, calls, constant } = fakeGl();
	const { timed, roles = ['body'], ...ringOptions } = options;
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
	// Each role's real metrics over a stand-in image: the tests here are
	// about GL calls, and glyph placement is the encoder's to test.
	for (const role of roles) {
		const atlasTexture = renderer.textures.create({
			width: 2,
			height: 2,
			label: `font atlas ${role}`,
			source: new Uint8Array(16),
			content: 'mask',
			immediate: true,
		});
		backend.loadFontAtlas({ name: role, atlas: committedFontAtlas(role), texture: atlasTexture });
	}
	const api = new DrawApi({ backend, development: true, });

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

/** Three domains, cut by R3.20's explicit barrier, with a clip in the middle one. */
function threeDomains(draw: DrawApi): void {
	someShapesAndText(draw);
	draw.flush();
	draw.pushClip({ x: 0, y: 0, width: 50, height: 50 });
	someShapesAndText(draw);
	draw.popClip();
	draw.flush();
	someShapesAndText(draw);
}

describe('WebGL2Backend', () => {
	it('brackets the clear and each sort domain as one GPU pass, never nested (R13.16)', () => {
		const { frame } = setupBackend({ timed: true });
		const calls = frame(threeDomains).map((call) => call.name);

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
			} else if (name === 'clear' || name === 'drawArraysInstanced') {
				expect(open).toBe(true);
			}
		}
		// The clear, then the three domains `threeDomains` produces.
		expect(passes).toBe(4);
	});

	it('allocates the instance ring and the uniform slots once, at their fixed capacity, and no index buffer (R15.11, R15.15)', () => {
		const { calls, constant, named } = setupBackend({ instanceRingBytes: 3 * 1024 * 1024 });
		const sizes = named(calls, 'bufferData').map((call) => [call.args[0], call.args[1]]);
		expect(sizes).toEqual([
			[constant('UNIFORM_BUFFER'), FRAME_SLOT_BYTES * 3],
			[constant('ARRAY_BUFFER'), 3 * 1024 * 1024],
		]);
	});

	it('makes every attribute per instance, inside the vertex array, once at creation (R15.13, R15.14)', () => {
		const { calls, named, frame } = setupBackend();
		const vertexArray = named(calls, 'createVertexArray')[0].result;
		let bound: unknown = null;
		const divisors: unknown[][] = [];
		for (const call of calls) {
			if (call.name === 'bindVertexArray') bound = call.args[0];
			if (call.name === 'vertexAttribDivisor') {
				expect(bound).toBe(vertexArray);
				divisors.push(call.args);
			}
		}
		expect(divisors).toEqual(UBER_ATTRIBUTES.map((attribute) => [attribute.location, 1]));
		// Attribute 0 is an enabled array (R15.13).
		expect(named(calls, 'enableVertexAttribArray').map((call) => call.args[0])).toContain(0);
		expect(named(frame(threeDomains), 'vertexAttribDivisor')).toEqual([]);
	});

	it('takes the first vertex as provoking where the extension exists, at creation and on restore', () => {
		const { calls, named, restore, frame } = setupBackend();
		// Every flat varying is per instance, so either convention draws the
		// same; the last-vertex default costs ANGLE Metal an index pass per
		// non-indexed draw.
		expect(named(calls, 'provokingVertexWEBGL').map((call) => call.args)).toEqual([[0x8e4d]]);
		expect(named(frame(threeDomains), 'provokingVertexWEBGL')).toEqual([]);
		const before = calls.length;
		restore();
		expect(named(calls.slice(before), 'provokingVertexWEBGL')).toHaveLength(1);
	});

	it('points the eight samplers at units 0 to 7 once, at creation (R5.20)', () => {
		const { calls, named } = setupBackend();
		const [samplers] = named(calls, 'uniform1iv');
		expect(Array.from(samplers.args[1] as Int32Array)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
	});

	it('makes no synchronous call and no allocation inside a frame (R15.22, R15.11)', () => {
		const { frame, named } = setupBackend();
		frame(threeDomains);
		const calls = frame(threeDomains);
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
			const calls = frame(threeDomains);
			const clear = calls.findIndex((call) => call.name === 'clear');
			expect(calls.filter((call) => call.name === 'clear')).toHaveLength(1);
			expect(clear).toBeLessThan(calls.findIndex((call) => call.name === 'drawArraysInstanced'));
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
			expect(range.args[4]).toBe(FRAME_BLOCK_BYTES);
			slots.push(writes[0].args[1] as number);
		}
		expect(slots).toEqual([FRAME_SLOT_BYTES, 2 * FRAME_SLOT_BYTES, 0, FRAME_SLOT_BYTES]);
	});

	it('puts the logical-pixel projection in the frame block', () => {
		const { frame, named, constant } = setupBackend();
		const calls = frame(someShapesAndText);
		const write = named(calls, 'bufferSubData').find((call) => call.args[0] === constant('UNIFORM_BUFFER'));
		const block = write?.args[2] as Float32Array;
		const projection = mat4.ortho(mat4.create(), 0, 800, 600, 0, -1, 1);
		expect(Array.from(block)).toEqual(Array.from(projection));
	});

	it('uploads instances into the ring with a source range and draws six vertices an instance, with no index buffer', () => {
		const { frame, named, constant } = setupBackend();
		const first = frame(someShapesAndText);
		const second = frame(someShapesAndText);

		const writes = (calls: GlCall[]) => named(calls, 'bufferSubData')
			.filter((call) => call.args[0] === constant('ARRAY_BUFFER'))
			.map((call) => ({ offset: call.args[1] as number, srcOffset: call.args[3], length: call.args[4] as number }));
		const [firstInstances] = writes(first);
		const [secondInstances] = writes(second);

		expect(firstInstances.offset).toBe(0);
		expect(firstInstances.srcOffset).toBe(0);
		expect(firstInstances.length % UBER_STRIDE).toBe(0);
		// The second frame writes after the first rather than over it.
		expect(secondInstances.offset).toBe(firstInstances.length);

		const [draw] = named(second, 'drawArraysInstanced');
		expect(draw.args).toEqual([constant('TRIANGLES'), 0, 6, secondInstances.length / UBER_STRIDE]);
		for (const calls of [first, second]) {
			expect(named(calls, 'drawElements')).toEqual([]);
			expect(named(calls, 'bindBuffer').filter((call) => call.args[0] === constant('ELEMENT_ARRAY_BUFFER'))).toEqual([]);
		}
	});

	it('points the attributes once per upload, never per draw group (R15.14)', () => {
		const { frame, named } = setupBackend();
		const calls = frame(threeDomains);
		const uploads = named(calls, 'bindVertexArray').filter((call) => call.args[0] !== null).length;
		expect(uploads).toBe(3);
		const pointers = [...named(calls, 'vertexAttribPointer'), ...named(calls, 'vertexAttribIPointer')];
		expect(pointers).toHaveLength(uploads * UBER_ATTRIBUTES.length);
		// The flags byte is an integer attribute; everything else goes through the float path.
		expect(named(calls, 'vertexAttribIPointer')).toHaveLength(uploads);
	});

	it('points the attributes at a split draw\'s first instance, since WebGL2 has no base instance', () => {
		const { frame, named, constant } = setupBackend();
		frame(someShapesAndText);
		const rect = { x: 0, y: 0, width: 10, height: 10 };
		const calls = frame((draw) => {
			draw.drawRect({ rect, fill: WHITE });
			draw.drawRect({ rect, fill: WHITE });
			draw.drawRect({ rect, fill: WHITE, blend: 'multiply' });
		});
		const [write] = named(calls, 'bufferSubData').filter((call) => call.args[0] === constant('ARRAY_BUFFER'));
		const ringOffset = write.args[1] as number;
		const bases = named(calls, 'vertexAttribPointer')
			.filter((call) => call.args[0] === 0)
			.map((call) => call.args[5]);
		expect(bases).toEqual([ringOffset, ringOffset + 2 * UBER_STRIDE]);
		expect(named(calls, 'drawArraysInstanced').map((call) => call.args[3])).toEqual([2, 1]);
	});

	it('draws each domain, shapes, borders and text together, in one GPU draw (R5.1)', () => {
		const { frame, named } = setupBackend();
		// Three domains, each ended by a barrier; nothing inside a domain splits.
		expect(named(frame(threeDomains), 'drawArraysInstanced')).toHaveLength(3);
	});

	it('paints in submission order: text drawn before an overlapping rect stays under it (chapter 3)', () => {
		const { frame, named, constant } = setupBackend();
		const calls = frame((draw) => {
			draw.drawText({ text: 'Hi', position: { x: 20, y: 20 }, font: 'body', size: 16, color: WHITE });
			draw.drawRect({ rect: { x: 10, y: 10, width: 100, height: 40 }, fill: WHITE });
		});
		const [write] = named(calls, 'bufferSubData').filter((call) => call.args[0] === constant('ARRAY_BUFFER'));
		const bytes = write.args[2] as Uint8Array;
		const byteCount = write.args[4] as number;
		const modes: number[] = [];
		for (let offset = 0; offset < byteCount; offset += UBER_STRIDE) modes.push(bytes[offset + UBER_INSTANCE.mode * 4]);
		// Two glyph quads, then the rect's quad: nothing hoists text past it.
		expect(modes.map((mode) => (mode === UBER_MODE.text ? 'text' : 'shape'))).toEqual(['text', 'text', 'shape']);
		expect(named(calls, 'drawArraysInstanced')).toHaveLength(1);
	});

	it('never splits on a clip change inside a domain (R4.1)', () => {
		const { backend } = setupBackend();
		const rect = { x: 0, y: 0, width: 10, height: 10 };
		// A clip push is not a barrier (R3.20), so this is one domain with
		// three different clips in it.
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

	it('carries the clip in logical pixels on every instance, at any ratio (R4.1, R4.4)', () => {
		const { calls, named, api, constant } = setupBackend();
		const start = calls.length;
		api.beginFrame({ viewport: { width: 400, height: 300 }, ratio: 2 });
		api.pushClip({ x: 10, y: 20, width: 100, height: 50 });
		api.drawRect({ rect: { x: 0, y: 0, width: 60, height: 60 }, fill: WHITE });
		api.popClip();
		api.endFrame();
		const [write] = named(calls.slice(start), 'bufferSubData').filter((call) => call.args[0] === constant('ARRAY_BUFFER'));
		const bytes = write.args[2] as Uint8Array;
		const floats = new Float32Array(bytes.buffer, bytes.byteOffset, (write.args[4] as number) / 4);
		expect(floats.length).toBe(UBER_INSTANCE.words);
		expect(Array.from(floats.subarray(UBER_INSTANCE.clip, UBER_INSTANCE.clip + 4))).toEqual([10, 20, 110, 70]);
	});

	it('appends each new rounded clip to the frame slot behind the projection, before the draw that reads it (R4.14)', () => {
		const { frame, named, constant } = setupBackend();
		const rect = { x: 0, y: 0, width: 100, height: 100 };
		const calls = frame((draw) => {
			draw.pushClipRounded({ x: 10, y: 20, width: 60, height: 40 }, 8);
			draw.drawRect({ rect, fill: WHITE });
			draw.drawText({ text: 'Hi', position: { x: 12, y: 30 }, font: 'body', size: 16, color: WHITE });
			draw.popClip();
			draw.flush();
			draw.pushClipRounded({ x: 30, y: 30, width: 20, height: 20 }, 4);
			draw.drawRect({ rect, fill: WHITE });
			draw.popClip();
			draw.flush();
			draw.drawRect({ rect, fill: WHITE });
		});
		const uniforms = named(calls, 'bufferSubData').filter((call) => call.args[0] === constant('UNIFORM_BUFFER'));
		// The projection, then one entry per domain that brought a new clip; the third brought none.
		expect(uniforms).toHaveLength(3);
		const slot = uniforms[0].args[1] as number;
		const entryBytes = 8 * 4;
		expect(uniforms[1].args[1]).toBe(slot + UBER_FRAME_BLOCK.roundedClips * 4);
		expect(uniforms[2].args[1]).toBe(slot + UBER_FRAME_BLOCK.roundedClips * 4 + entryBytes);
		const table = uniforms[1].args[2] as Float32Array;
		expect(Array.from(table.subarray(0, 5))).toEqual([40, 40, 30, 20, 8]);
		expect([uniforms[1].args[3], uniforms[1].args[4], uniforms[2].args[3], uniforms[2].args[4]]).toEqual([0, 8, 8, 8]);
		// Each entry lands before the draw of the domain that refers to it.
		const draws = calls.map((call, index) => (call.name === 'drawArraysInstanced' ? index : -1)).filter((index) => index >= 0);
		expect(draws).toHaveLength(3);
		expect(calls.indexOf(uniforms[1])).toBeLessThan(draws[0]);
		expect(calls.indexOf(uniforms[2])).toBeGreaterThan(draws[0]);
		expect(calls.indexOf(uniforms[2])).toBeLessThan(draws[1]);
	});

	it('marks every instance under a rounded clip with its entry, and splits nothing for it (R4.14)', () => {
		const { calls, named, api, constant } = setupBackend();
		const start = calls.length;
		const rect = { x: 0, y: 0, width: 100, height: 100 };
		api.beginFrame({ viewport: { width: 400, height: 300 } });
		api.drawRect({ rect, fill: WHITE });
		api.pushClipRounded({ x: 10, y: 10, width: 50, height: 50 }, 6);
		api.drawRect({ rect, fill: WHITE });
		api.drawText({ text: 'Hi', position: { x: 12, y: 30 }, font: 'body', size: 16, color: WHITE });
		api.popClip();
		api.pushClipRounded({ x: 20, y: 20, width: 50, height: 50 }, 6);
		api.drawRect({ rect, fill: WHITE });
		api.popClip();
		api.endFrame();
		expect(api.getStats().gpuDraws).toBe(1);
		const [write] = named(calls.slice(start), 'bufferSubData').filter((call) => call.args[0] === constant('ARRAY_BUFFER'));
		const bytes = write.args[2] as Uint8Array;
		const instances = (write.args[4] as number) / UBER_STRIDE;
		const roundedIndex = (instance: number) => bytes[bytes.byteOffset + instance * UBER_STRIDE + UBER_INSTANCE.mode * 4 + 3];
		const indices = Array.from({ length: instances }, (_, instance) => roundedIndex(instance));
		// The unclipped rect, the rect and two glyphs under the first clip, the rect under the second.
		expect(indices).toEqual([0, 1, 1, 1, 2]);
	});

	it('binds the atlas and the placeholders once, and nothing on later frames (R5.20)', () => {
		const { frame, named } = setupBackend();
		// Unit 0 gets the atlas, units 1 to 7 the empty placeholder.
		expect(named(frame(threeDomains), 'bindTexture')).toHaveLength(8);
		expect(named(frame(threeDomains), 'bindTexture')).toHaveLength(0);
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
		expect(named(calls, 'drawArraysInstanced')).toHaveLength(1);
	});

	it('grows a ring that cannot hold two frames and says so, instead of overwriting one', () => {
		const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			// `threeDomains` is three uploads of nine instances at 104 bytes,
			// 2808 bytes a frame; a 3000-byte ring takes one frame and not the
			// next beside it.
			const { frame, named, constant } = setupBackend({ instanceRingBytes: 3000 });
			const first = frame(threeDomains);
			expect(named(first, 'bufferData')).toEqual([]);
			const calls = frame(threeDomains);
			const grown = named(calls, 'bufferData').filter((call) => call.args[0] === constant('ARRAY_BUFFER'));
			expect(grown).toHaveLength(1);
			expect(grown[0].args[1]).toBeGreaterThanOrEqual(3000 * 2);
			expect(named(calls, 'deleteBuffer')).toHaveLength(1);
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('instance ring grew'));
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
		// The uniform ring and the instance ring.
		expect(named(rebuilt, 'createBuffer')).toHaveLength(2);

		// The rebuilt vertex array gets every attribute enabled and per instance again.
		const newVertexArray = named(rebuilt, 'createVertexArray')[0].result;
		let bound: unknown = null;
		const divisors: unknown[][] = [];
		for (const call of rebuilt) {
			if (call.name === 'bindVertexArray') bound = call.args[0];
			if (call.name === 'vertexAttribDivisor') {
				expect(bound).toBe(newVertexArray);
				divisors.push(call.args);
			}
		}
		expect(divisors).toEqual(UBER_ATTRIBUTES.map((attribute) => [attribute.location, 1]));
		expect(named(rebuilt, 'enableVertexAttribArray')).toHaveLength(UBER_ATTRIBUTES.length);

		const next = frame(someShapesAndText);
		const [vertices] = named(next, 'bufferSubData').filter((call) => call.args[0] === constant('ARRAY_BUFFER'));
		expect(vertices.args[1]).toBe(0);
		// The pointer cache was dropped with the old context, so the first frame
		// points every attribute again, at offset 0 of the new ring.
		const pointers = [...named(next, 'vertexAttribPointer'), ...named(next, 'vertexAttribIPointer')];
		expect(pointers).toHaveLength(UBER_ATTRIBUTES.length);
		const firstPointer = named(next, 'vertexAttribPointer').find((call) => call.args[0] === 0);
		expect(firstPointer?.args[5]).toBe(0);
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
		expect(named(calls, 'drawArraysInstanced')).toHaveLength(3);
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

	describe('chapter 5.10 batch tests', () => {
		it('draws a mixed screen as one group per call and one GPU draw per flush', () => {
			const { frame, named, api } = setupBackend({ roles: ['display', 'body', 'mono'] });
			const art = api.createTexture({ width: 2, height: 2, label: 'art', source: new Uint8Array(16) });
			const RED: RGBA = [1, 0, 0, 1];
			const CLEAR: RGBA = [1, 0, 0, 0];
			const screen = (draw: DrawApi): void => {
				draw.drawRect({ rect: { x: 0, y: 0, width: 800, height: 600 }, fill: [0.1, 0.1, 0.1, 1] });
				draw.drawRect({ rect: { x: 20, y: 20, width: 200, height: 120 }, fill: WHITE, radius: 8, shadow: { color: [0, 0, 0, 0.5], blur: 12 } });
				draw.drawRect({ rect: { x: 240, y: 20, width: 200, height: 120 }, gradient: [RED, RED, CLEAR, CLEAR] });
				draw.drawRect({ rect: { x: 460, y: 20, width: 120, height: 40 }, fill: WHITE, border: { color: RED, width: 2, position: 'center' } });
				draw.drawCircle({ center: { x: 60, y: 200 }, radius: 24, fill: RED, border: { color: WHITE, width: 2 } });
				draw.drawLine({ from: { x: 100, y: 200 }, to: { x: 300, y: 220 }, color: WHITE, width: 3 });
				draw.drawText({ text: 'WASTELAND', position: { x: 20, y: 280 }, font: 'display', size: 32, color: WHITE });
				draw.drawText({ text: 'Body copy', position: { x: 20, y: 320 }, font: 'body', size: 14, color: WHITE });
				draw.drawText({ text: '12/20', position: { x: 20, y: 350 }, font: 'mono', size: 12, color: WHITE });
				draw.drawImage({ rect: { x: 300, y: 260, width: 64, height: 64 }, texture: art });
			};
			frame(screen);
			const calls = frame(screen);
			const stats = api.getStats();
			// Ten calls, one of them shadowed: eleven groups, none split.
			expect(stats.apiDraws).toBe(11);
			expect(stats.gpuDraws).toBe(1);
			expect(stats.splits).toEqual(expect.objectContaining({ textureSlotsExhausted: 0, blendChange: 0 }));
			expect(named(calls, 'drawArraysInstanced')).toHaveLength(1);
		});

		it('never writes an instance range the previous frame may still read, with four flushes a frame (R5.27)', () => {
			// Four uploads of nine instances at 104 bytes are 3744 bytes a
			// frame, so a 12000-byte ring holds three frames and the fourth has
			// to wrap onto the first.
			const { frame, named, constant } = setupBackend({ instanceRingBytes: 12000 });
			const fourDomains = (draw: DrawApi): void => {
				for (let domain = 0; domain < 4; domain++) {
					if (domain > 0) draw.flush();
					someShapesAndText(draw);
				}
			};
			interface Range { start: number; end: number }
			const instanceRanges = (calls: GlCall[]): Range[] => named(calls, 'bufferSubData')
				.filter((call) => call.args[0] === constant('ARRAY_BUFFER'))
				.map((call) => {
					const start = call.args[1] as number;
					return { start, end: start + (call.args[4] as number) };
				});
			const overlaps = (a: Range, b: Range): boolean => a.start < b.end && b.start < a.end;

			const frames = Array.from({ length: 6 }, () => frame(fourDomains));
			const ranges = frames.map(instanceRanges);
			for (let index = 0; index < frames.length; index++) {
				expect(ranges[index]).toHaveLength(4);
				// Inside a frame the four uploads sit side by side.
				for (let a = 0; a < 4; a++) {
					for (let b = a + 1; b < 4; b++) expect(overlaps(ranges[index][a], ranges[index][b])).toBe(false);
				}
				if (index === 0) continue;
				for (const range of ranges[index]) {
					expect(ranges[index - 1].some((previous) => overlaps(range, previous))).toBe(false);
				}
			}

			// The wrap happened (mid-frame, onto offset 0, which frame 0 wrote and
			// is three frames old by then), and nothing grew to avoid it.
			const sequence = ranges.flat();
			const wraps = sequence.flatMap((range, index) => (index > 0 && range.start < sequence[index - 1].start ? [index] : []));
			expect(wraps.length).toBeGreaterThan(0);
			expect(sequence[wraps[0]].start).toBe(0);
			expect(Math.floor(wraps[0] / 4)).toBe(3);
			const grown = frames.flatMap((calls) => named(calls, 'bufferData'));
			expect(grown).toEqual([]);
		});
	});

	it('answers R4.2a text ink from the encoder', () => {
		const { backend } = setupBackend();
		const ink = backend.textInk({ text: 'Hi', position: { x: 10, y: 20 }, font: 'body', size: 32, color: WHITE });
		expect(ink).not.toBeNull();
		expect(ink?.width).toBeGreaterThan(0);
	});
});
