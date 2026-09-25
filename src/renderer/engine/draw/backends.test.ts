import { DrawApi } from './DrawApi';
import { DrawBackend, DrawBatch, FrameDescription } from './DrawBackend';
import { NullBackend } from './NullBackend';
import { RecordingBackend } from './RecordingBackend';
import { FontAtlasHandle, TextureHandle } from './commands';
import { GpuWork } from './stats';

const BLUE = [0.2, 0.4, 0.6, 1] as const;
const RED = [1, 0, 0, 1] as const;
const VIEWPORT = { width: 800, height: 600 };

/**
 * A backend that draws nothing and admits it cannot attribute GPU work. R13.5's
 * distinction between "zero" and "nobody counted" only exists if something
 * exercises both sides of it.
 */
class SilentBackend implements DrawBackend {
	readonly name = 'silent';
	readonly fontAtlasNames: readonly string[] = ['body'];

	beginFrame(_frame: FrameDescription): void {
		// Accepted and ignored.
	}

	submit(_batch: DrawBatch): GpuWork | null {
		return null;
	}

	endFrame(): void {
		// Accepted and ignored.
	}

	invalidateState(): void {
		// Accepted and ignored.
	}

	createTexture(): TextureHandle {
		return { id: 1, width: 1, height: 1, label: null };
	}

	destroyTexture(): void {
		// Accepted and ignored.
	}

	loadFontAtlas(): FontAtlasHandle {
		return { id: 1, name: 'body' };
	}
}

describe('NullBackend (R2.21)', () => {
	it('accepts and counts every draw with no context', () => {
		const backend = new NullBackend();
		const api = new DrawApi({ backend });
		const texture = api.createTexture({ width: 4, height: 4 });
		api.loadFontAtlas({ name: 'body', metrics: {}, texture });

		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: { x: 0, y: 0, width: 10, height: 10 }, fill: BLUE, shadow: { color: RED } });
		api.drawText({ text: 'x', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED });
		api.drawCircle({ center: { x: 5, y: 5 }, radius: 3, fill: BLUE });
		api.endFrame();

		expect(backend.frameCount).toBe(1);
		expect(backend.batchCount).toBe(1);
		expect(backend.commandCount).toBe(4);
		expect(backend.countOf('shadow')).toBe(1);
		expect(backend.countOf('rect')).toBe(1);
		expect(backend.countOf('text')).toBe(1);
		expect(backend.countOf('circle')).toBe(1);
	});

	it('reports real zeros, because a backend that rasterises nothing did zero work', () => {
		const backend = new NullBackend();
		const api = new DrawApi({ backend });
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: { x: 0, y: 0, width: 10, height: 10 }, fill: BLUE });
		api.endFrame();

		const stats = api.getStats();
		expect(stats.apiDraws).toBe(1);
		expect(stats.gpuDraws).toBe(0);
		expect(stats.vertices).toBe(0);
		expect(stats.bytesUploaded).toBe(0);
	});

	it('counts invalidateState and releases a handle', () => {
		const backend = new NullBackend();
		const api = new DrawApi({ backend });
		const texture = api.createTexture({ width: 2, height: 2 });
		api.invalidateState();
		api.destroyTexture(texture);

		expect(backend.invalidateStateCount).toBe(1);
	});

	it('receives the viewport and ratio of the frame', () => {
		const backend = new NullBackend();
		const api = new DrawApi({ backend });
		api.beginFrame({ viewport: VIEWPORT, ratio: 2 });
		api.endFrame();

		expect(backend.lastFrame).toEqual({ viewport: VIEWPORT, ratio: 2, frame: 1 });
	});

	it('mints texture and atlas handles', () => {
		const backend = new NullBackend();
		const api = new DrawApi({ backend });
		const texture = api.createTexture({ width: 64, height: 64, label: 'ui' });
		api.loadFontAtlas({ name: 'mono', metrics: {}, texture });

		expect(texture).toEqual({ id: 1, width: 64, height: 64, label: 'ui' });
		expect(backend.fontAtlasNames).toEqual(['mono']);
	});
});

describe('a backend that cannot attribute its work leaves the counters null', () => {
	it('keeps apiDraws real and gpuDraws null', () => {
		const api = new DrawApi({ backend: new SilentBackend() });
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: { x: 0, y: 0, width: 10, height: 10 }, fill: BLUE });
		api.endFrame();

		const stats = api.getStats();
		expect(stats.apiDraws).toBe(1);
		expect(stats.gpuDraws).toBeNull();
		expect(stats.vertices).toBeNull();
		expect(stats.triangles).toBeNull();
		expect(stats.instances).toBeNull();
		expect(stats.textureBinds).toBeNull();
		expect(stats.bytesUploaded).toBeNull();
		expect(stats.splits).toBeNull();
	});

	it('still fills the counters from a foreign pass that did measure (R13.15)', () => {
		const api = new DrawApi({ backend: new SilentBackend() });
		api.beginFrame({ viewport: VIEWPORT });
		api.reportForeignDraws({
			gpuDraws: 2,
			vertices: 12,
			triangles: 4,
			instances: 0,
			textureBinds: 1,
			bytesUploaded: 64,
			splits: { blendChange: 1 },
		});
		api.endFrame();

		const stats = api.getStats();
		expect(stats.gpuDraws).toBe(2);
		expect(stats.splits).toEqual({ textureSlotsExhausted: 0, blendChange: 1, stencilLevel: 0 });
	});
});

describe('RecordingBackend (R2.22)', () => {
	it('returns the sorted draw list, per domain and flattened', () => {
		const backend = new RecordingBackend();
		const api = new DrawApi({ backend });

		api.beginFrame({ viewport: VIEWPORT });
		api.pushLayer('popup');
		api.drawRect({ rect: { x: 0, y: 0, width: 1, height: 1 }, fill: BLUE, id: 'menu' });
		api.popLayer();
		api.drawRect({ rect: { x: 0, y: 0, width: 1, height: 1 }, fill: BLUE, id: 'panel' });
		api.flush();
		api.drawRect({ rect: { x: 0, y: 0, width: 1, height: 1 }, fill: BLUE, id: 'debug' });
		api.endFrame();

		expect(backend.batches).toHaveLength(2);
		expect(backend.batches[0].commands.map((command) => command.id)).toEqual(['panel', 'menu']);
		expect(backend.batches[1].commands.map((command) => command.id)).toEqual(['debug']);
		expect(backend.ids).toEqual(['panel', 'menu', 'debug']);
		expect(backend.layerOrder).toEqual(['base', 'popup', 'base']);
	});

	it('keeps only the requested number of frames, oldest dropped', () => {
		const backend = new RecordingBackend({ maxFrames: 2 });
		const api = new DrawApi({ backend });

		for (const id of ['one', 'two', 'three']) {
			api.beginFrame({ viewport: VIEWPORT });
			api.drawRect({ rect: { x: 0, y: 0, width: 1, height: 1 }, fill: BLUE, id });
			api.endFrame();
		}

		expect(backend.frames).toHaveLength(2);
		expect(backend.frames.map((frame) => frame.frame)).toEqual([2, 3]);
		expect(backend.ids).toEqual(['three']);
	});

	it('still describes an old frame after later frames have run', () => {
		const backend = new RecordingBackend({ maxFrames: 3 });
		const api = new DrawApi({ backend });
		const reused = { x: 1, y: 1, width: 1, height: 1 };

		api.beginFrame({ viewport: VIEWPORT });
		api.pushOpacity(0.5);
		api.drawRect({ rect: reused, fill: BLUE, id: 'frame-one' });
		api.popOpacity();
		api.endFrame();

		const recordedFirst = JSON.parse(JSON.stringify(backend.frames[0]));

		for (let index = 0; index < 2; index++) {
			reused.x += 100;
			api.beginFrame({ viewport: VIEWPORT });
			api.drawRect({ rect: reused, fill: BLUE, id: 'later' });
			api.endFrame();
		}

		expect(JSON.parse(JSON.stringify(backend.frames[0]))).toStrictEqual(recordedFirst);
		expect(backend.frames[0].batches[0].commands[0]).toMatchObject({
			id: 'frame-one',
			opacity: 0.5,
			rect: { x: 1, y: 1, width: 1, height: 1 },
		});
	});

	it('clears on request', () => {
		const backend = new RecordingBackend();
		const api = new DrawApi({ backend });
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: { x: 0, y: 0, width: 1, height: 1 }, fill: BLUE });
		api.endFrame();

		backend.clear();
		expect(backend.frames).toHaveLength(0);
		expect(backend.lastFrame).toBeNull();
		expect(backend.commands).toEqual([]);
	});

	it('records a submit made by hand outside a frame rather than throwing', () => {
		const backend = new RecordingBackend();
		backend.submit({ domain: 0, reason: 'barrier', commands: [] });

		expect(backend.lastFrame).toBeNull();
		backend.endFrame();
		expect(backend.frames).toHaveLength(1);
		expect(backend.frames[0].frame).toBe(-1);
	});

	it('counts invalidateState so a foreign pass is observable in a test', () => {
		const backend = new RecordingBackend();
		const api = new DrawApi({ backend });
		api.invalidateState();
		api.invalidateState();
		expect(backend.invalidateStateCount).toBe(2);
	});
});
