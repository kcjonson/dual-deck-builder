import { DrawApi, DrawApiOptions, Diagnostic, TEXT_MEASUREMENT_UNAVAILABLE } from './DrawApi';
import { RecordingBackend } from './RecordingBackend';
import { DrawCommand, RectCommand, TextCommand, TextureHandle } from './commands';
import { Rect } from './geometry';

const BLUE = [0.2, 0.4, 0.6, 1] as const;
const RED = [1, 0, 0, 1] as const;
const VIEWPORT = { width: 1280, height: 720 };

interface Harness {
	api: DrawApi;
	backend: RecordingBackend;
	texture: TextureHandle;
}

function harness(options: Partial<Omit<DrawApiOptions, 'backend'>> = {}): Harness {
	const backend = new RecordingBackend({ maxFrames: 4 });
	const api = new DrawApi({ backend, ...options });
	const texture = api.createTexture({ width: 512, height: 512, label: 'atlas' });
	api.loadFontAtlas({ name: 'body', metrics: {}, texture });
	return { api, backend, texture };
}

function rect(x: number, y: number, width: number, height: number): Rect {
	return { x, y, width, height };
}

function codes(api: DrawApi): string[] {
	return api.diagnostics.map((diagnostic: Diagnostic) => diagnostic.code);
}

describe('DrawApi frame lifecycle (R2.1 to R2.3)', () => {
	it('submits one domain at endFrame and reports the flush reason', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'a' });
		api.endFrame();

		expect(backend.batches).toHaveLength(1);
		expect(backend.batches[0].reason).toBe('endFrame');
		expect(backend.ids).toEqual(['a']);
	});

	it('resets stacks, counters and diagnostics at beginFrame', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushTranslate(50, 50);
		api.pushOpacity(0.5);
		api.pushLayer('modal');
		api.pushClip(rect(0, 0, 10, 10));
		api.drawRect({ rect: rect(0, 0, 5, 5), fill: BLUE });
		api.popClip();
		api.popLayer();
		api.popOpacity();
		api.popTransform();
		api.endFrame();

		api.beginFrame({ viewport: VIEWPORT });
		expect(api.transform).toEqual([1, 0, 0, 1, 0, 0]);
		expect(api.opacity).toBe(1);
		expect(api.layer).toBe('base');
		expect(api.clip).toEqual({ kind: 'none' });
		expect(api.getStats().apiDraws).toBe(0);
		expect(api.diagnostics).toHaveLength(0);
	});

	it('advances the frame index and hands the backend the viewport and ratio', () => {
		const backend = new RecordingBackend();
		const api = new DrawApi({ backend });
		api.beginFrame({ viewport: VIEWPORT, ratio: 2 });
		expect(api.frame).toBe(1);
		expect(api.viewport).toEqual(VIEWPORT);
		expect(api.devicePixelScale).toBe(2);
		api.endFrame();
		expect(api.isFrameOpen).toBe(false);
	});

	it('reports a beginFrame while a frame is already open, and the report survives the reset', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.beginFrame({ viewport: VIEWPORT });
		expect(codes(api)).toEqual(['frame-already-open']);
		api.endFrame();
	});

	describe('R2.2: there is no text batch to open', () => {
		it('keeps text and shapes in one batch, in submission order', () => {
			const { api, backend } = harness();
			api.beginFrame({ viewport: VIEWPORT });
			api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'bg' });
			api.drawText({ text: 'hi', position: { x: 1, y: 1 }, font: 'body', size: 12, color: RED, id: 'label' });
			api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'fg' });
			api.endFrame();

			expect(backend.batches).toHaveLength(1);
			expect(backend.ids).toEqual(['bg', 'label', 'fg']);
			expect(backend.commands.map((command) => command.kind)).toEqual(['rect', 'text', 'rect']);
		});
	});
});

describe('R2.1 out-of-frame policy, one rule for every entry point', () => {
	const entryPoints: Array<[string, (api: DrawApi) => void]> = [
		['flush', (api) => api.flush()],
		['endFrame', (api) => api.endFrame()],
		['pushTransform', (api) => api.pushTransform([1, 0, 0, 1, 0, 0])],
		['pushTranslate', (api) => api.pushTranslate(1, 1)],
		['popTransform', (api) => api.popTransform()],
		['pushClip', (api) => api.pushClip(rect(0, 0, 1, 1))],
		['pushClipRounded', (api) => api.pushClipRounded(rect(0, 0, 1, 1), 2)],
		['pushClipReset', (api) => api.pushClipReset()],
		['popClip', (api) => api.popClip()],
		['pushOpacity', (api) => api.pushOpacity(0.5)],
		['popOpacity', (api) => api.popOpacity()],
		['pushLayer', (api) => api.pushLayer('modal')],
		['popLayer', (api) => api.popLayer()],
		['drawRect', (api) => api.drawRect({ rect: rect(0, 0, 1, 1), fill: BLUE })],
		['drawCircle', (api) => api.drawCircle({ center: { x: 0, y: 0 }, radius: 1, fill: BLUE })],
		['drawLine', (api) => api.drawLine({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: RED, width: 1 })],
		['drawPolyline', (api) => api.drawPolyline({ points: [{ x: 0, y: 0 }], color: RED, width: 1 })],
		['drawPolygon', (api) => api.drawPolygon({ points: [{ x: 0, y: 0 }], fill: BLUE })],
		['drawText', (api) => api.drawText({ text: 'x', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED })],
		['reportForeignDraws', (api) => api.reportForeignDraws({ gpuDraws: 1, vertices: 6, triangles: 2, instances: 0, textureBinds: 0, bytesUploaded: 0 })],
	];

	it.each(entryPoints)('%s outside a frame is one recorded diagnostic in a development build', (_name, call) => {
		const { api } = harness();
		call(api);
		expect(codes(api)).toEqual(['call-outside-frame']);
	});

	it.each(entryPoints)('%s outside a frame is a silent no-op in a production build', (_name, call) => {
		const backend = new RecordingBackend();
		const api = new DrawApi({ backend, development: false });
		call(api);
		expect(api.diagnostics).toHaveLength(0);
		expect(backend.frames).toHaveLength(0);
	});

	it('does not let an out-of-frame push mutate state a later frame would inherit', () => {
		const { api } = harness();
		api.pushTranslate(500, 500);
		api.beginFrame({ viewport: VIEWPORT });
		expect(api.transform).toEqual([1, 0, 0, 1, 0, 0]);
		api.endFrame();
	});

	it('throws instead of recording when the caller asked for strict', () => {
		const backend = new RecordingBackend();
		const api = new DrawApi({ backend, strict: true });
		expect(() => api.popClip()).toThrow('call-outside-frame');
	});

	it('hands every finding to onDiagnostic as it happens', () => {
		const seen: string[] = [];
		const { api } = harness({ onDiagnostic: (diagnostic) => seen.push(diagnostic.code) });
		api.beginFrame({ viewport: VIEWPORT });
		api.pushOpacity(4);
		api.popLayer();
		api.endFrame();

		// The unpopped opacity is the third finding, which is how the endFrame
		// check proves it reaches the callback too.
		expect(seen).toEqual(['opacity-out-of-range', 'pop-empty-stack', 'unbalanced-stack']);
	});

	it('reports an underflowed pop rather than emptying the stack', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.popOpacity();
		expect(codes(api)).toEqual(['pop-empty-stack']);
		expect(api.opacity).toBe(1);
		api.endFrame();
	});

	it('reports state left unpopped at endFrame', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushClip(rect(0, 0, 10, 10));
		api.pushLayer('toast');
		api.endFrame();
		expect(codes(api)).toContain('unbalanced-stack');
	});
});

describe('the four stacks are captured into each draw (R2.4 to R2.7)', () => {
	function captured(): RectCommand {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushLayer('overlay');
		api.pushTranslate(100, 50);
		api.pushOpacity(0.5);
		api.pushOpacity(0.5);
		api.pushClip(rect(0, 0, 200, 40));
		api.drawRect({ rect: rect(10, 10, 40, 20), fill: BLUE, radius: 6, id: 'panel' });
		api.popClip();
		api.popOpacity();
		api.popOpacity();
		api.popTransform();
		api.popLayer();
		api.endFrame();
		return backend.commands[0] as RectCommand;
	}

	it('stamps the concatenated transform and leaves geometry in local space', () => {
		const command = captured();
		expect(command.transform).toEqual([1, 0, 0, 1, 100, 50]);
		expect(command.translateOnly).toBe(true);
		expect(command.rect).toEqual({ x: 10, y: 10, width: 40, height: 20 });
	});

	it('stamps the clip already converted to screen space and already intersected', () => {
		const command = captured();
		expect(command.clip).toEqual({
			kind: 'rect',
			rect: { minX: 100, minY: 50, maxX: 300, maxY: 90 },
			rounded: null,
		});
	});

	it('stamps the product of the opacity stack, not the innermost push', () => {
		expect(captured().opacity).toBe(0.25);
	});

	it('stamps the layer name and its ordinal', () => {
		const command = captured();
		expect(command.layer).toBe('overlay');
		expect(command.layerOrdinal).toBe(20);
	});

	it('is unchanged by every later pop, which is R4.6 stated for all four stacks', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushLayer('modal');
		api.pushTranslate(7, 9);
		api.pushOpacity(0.25);
		api.pushClip(rect(0, 0, 100, 100));
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'captured' });
		api.popClip();
		api.popOpacity();
		api.popTransform();
		api.popLayer();
		api.pushLayer('transition');
		api.pushTranslate(-999, -999);
		api.pushOpacity(1);
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'later' });
		api.popOpacity();
		api.popTransform();
		api.popLayer();
		api.endFrame();

		const first = backend.commands.find((command) => command.id === 'captured') as RectCommand;
		expect(first.layer).toBe('modal');
		expect(first.transform).toEqual([1, 0, 0, 1, 7, 9]);
		expect(first.opacity).toBe(0.25);
		expect(first.clip).toEqual({
			kind: 'rect',
			rect: { minX: 7, minY: 9, maxX: 107, maxY: 109 },
			rounded: null,
		});
	});

	it('produces commands that survive a JSON round trip unchanged', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushLayer('popup');
		api.pushClip(rect(0, 0, 400, 400));
		api.drawRect({
			rect: rect(10, 10, 100, 40),
			fill: BLUE,
			radius: [4, 4, 8, 8],
			border: { color: RED, width: 1 },
			gradient: [BLUE, RED, BLUE, RED],
			shadow: { color: RED, blur: 4, spread: 1, offset: { x: 0, y: 2 } },
			id: 'card',
		});
		api.drawText({ text: 'hp', position: { x: 4, y: 4 }, font: 'body', size: 12, color: RED, id: 'hp' });
		api.drawPolygon({ points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }], indices: [0, 1, 2], fill: BLUE });
		api.drawLine({ from: { x: 0, y: 0 }, to: { x: 9, y: 9 }, color: RED, width: 2, cap: 'round' });
		api.popClip();
		api.popLayer();
		api.endFrame();

		const commands = backend.commands;
		expect(commands).toHaveLength(5);
		expect(JSON.parse(JSON.stringify(commands))).toStrictEqual(commands);
	});

	it('carries no undefined anywhere, so a command means the same thing serialised', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE });
		api.drawCircle({ center: { x: 5, y: 5 }, radius: 4, fill: BLUE });
		api.drawText({ text: 'x', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED });
		api.drawPolyline({ points: [{ x: 0, y: 0 }, { x: 4, y: 4 }], color: RED, width: 1 });
		api.endFrame();

		const undefinedPaths: string[] = [];
		const walk = (value: unknown, path: string): void => {
			if (value === undefined) {
				undefinedPaths.push(path);
				return;
			}
			if (value === null || typeof value !== 'object') return;
			for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
				walk(child, `${path}.${key}`);
			}
		};
		backend.commands.forEach((command, index) => walk(command, `[${index}]`));
		expect(undefinedPaths).toEqual([]);
	});

	it('does not alias a rect or a colour the caller reuses next frame', () => {
		const { api, backend } = harness();
		const reused = { x: 1, y: 2, width: 3, height: 4 };
		const reusedColor: [number, number, number, number] = [0, 0, 0, 1];

		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: reused, fill: reusedColor, id: 'first' });
		api.endFrame();

		reused.x = 999;
		reusedColor[3] = 0;

		const command = backend.commands[0] as RectCommand;
		expect(command.rect).toEqual({ x: 1, y: 2, width: 3, height: 4 });
		expect(command.fill).toEqual([0, 0, 0, 1]);
	});
});

describe('transform stack (R2.4)', () => {
	it('tracks a pure translation as translate-only', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushTranslate(10, 10);
		expect(api.translateOnly).toBe(true);
		api.endFrame();
	});

	it('loses the flag under a scale and restores it on pop', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushTransform([2, 0, 0, 2, 0, 0]);
		expect(api.translateOnly).toBe(false);
		api.pushTranslate(5, 5);
		expect(api.translateOnly).toBe(false);
		expect(api.transform).toEqual([2, 0, 0, 2, 10, 10]);
		api.popTransform();
		api.popTransform();
		expect(api.translateOnly).toBe(true);
		api.endFrame();
	});

	it('regains the flag when a scale is composed with its own inverse', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushTransform([2, 0, 0, 2, 0, 0]);
		api.pushTransform([0.5, 0, 0, 0.5, 0, 0]);
		expect(api.translateOnly).toBe(true);
		api.endFrame();
	});
});

describe('clip stack (R2.5, R4.2, R4.7) and chapter 4.7 required tests', () => {
	it('intersects nested rects and restores the parent exactly on pop', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushClip(rect(0, 0, 100, 100));
		const outer = api.clip;
		api.pushClip(rect(50, 50, 200, 200));
		expect(api.clip).toEqual({
			kind: 'rect',
			rect: { minX: 50, minY: 50, maxX: 100, maxY: 100 },
			rounded: null,
		});
		api.popClip();
		expect(api.clip).toEqual(outer);
		api.endFrame();
	});

	it('never lets a wider nested clip widen the region a draw is clipped to', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushClip(rect(20, 30, 80, 90));
		api.pushClip(rect(-500, -500, 5000, 5000));
		api.drawRect({ rect: rect(20, 30, 10, 10), fill: BLUE, id: 'inner' });
		api.popClip();
		api.popClip();
		api.endFrame();

		expect(backend.commands[0].clip).toEqual({
			kind: 'rect',
			rect: { minX: 20, minY: 30, maxX: 100, maxY: 120 },
			rounded: null,
		});
	});

	it('produces empty for disjoint rects and emits nothing under it', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushClip(rect(0, 0, 100, 100));
		api.pushClip(rect(500, 500, 100, 100));
		expect(api.clip).toEqual({ kind: 'empty' });
		api.drawRect({ rect: rect(500, 500, 10, 10), fill: BLUE, id: 'hidden' });
		api.popClip();
		api.popClip();
		api.endFrame();

		expect(backend.commands).toHaveLength(0);
		expect(api.getStats().culled).toBe(1);
		expect(api.getStats().apiDraws).toBe(0);
	});

	it('stays empty for a nested push and never collapses to none', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushClip(rect(0, 0, 100, 100));
		api.pushClip(rect(500, 500, 100, 100));
		api.pushClip(rect(-1000, -1000, 5000, 5000));
		expect(api.clip).toEqual({ kind: 'empty' });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'still-hidden' });
		api.popClip();
		api.popClip();
		api.popClip();
		api.endFrame();
		expect(backend.commands).toHaveLength(0);
	});

	it('converts the clip through the transform current at push (R4.7)', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushTranslate(30, 40);
		api.pushClip(rect(0, 0, 10, 10));
		expect(api.clip).toEqual({
			kind: 'rect',
			rect: { minX: 30, minY: 40, maxX: 40, maxY: 50 },
			rounded: null,
		});
		// A transform pushed afterwards must not move a clip already converted.
		api.pushTranslate(1000, 1000);
		expect(api.clip).toEqual({
			kind: 'rect',
			rect: { minX: 30, minY: 40, maxX: 40, maxY: 50 },
			rounded: null,
		});
		api.popTransform();
		api.popClip();
		api.popTransform();
		api.endFrame();
	});

	it('warns when a clip is pushed under a non-translate transform', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushTransform([0, 1, -1, 0, 0, 0]);
		api.pushClip(rect(0, 0, 10, 20));
		expect(codes(api)).toEqual(['clip-under-non-translate-transform']);
		expect(api.clip).toEqual({
			kind: 'rect',
			rect: { minX: -20, minY: 0, maxX: 0, maxY: 10 },
			rounded: null,
		});
		api.popClip();
		api.popTransform();
		api.endFrame();
	});

	it('carries the innermost radius with the outer bounding rect and warns once per frame (R4.14)', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushClipRounded(rect(0, 0, 200, 200), 12);
		api.pushClipRounded(rect(10, 10, 100, 100), 4);
		api.pushClipRounded(rect(20, 20, 40, 40), 2);
		api.drawRect({ rect: rect(20, 20, 10, 10), fill: BLUE, id: 'inner' });
		api.popClip();
		api.popClip();
		api.popClip();
		api.endFrame();

		expect(codes(api)).toEqual(['nested-rounded-clip']);
		const command = backend.commands[0];
		expect(command.clip).toEqual({
			kind: 'rect',
			rect: { minX: 20, minY: 20, maxX: 60, maxY: 60 },
			rounded: { rect: { minX: 20, minY: 20, maxX: 60, maxY: 60 }, radius: 2 },
		});
	});

	it('resets the clip for a promoted subtree and nothing else (R3.8, R4.8)', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushTranslate(20, 30);
		api.pushClip(rect(0, 0, 50, 50));
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'row' });
		api.pushLayer('popup');
		api.pushClipReset();
		api.drawRect({ rect: rect(0, 0, 300, 300), fill: BLUE, id: 'menu' });
		api.popClip();
		api.popLayer();
		api.popClip();
		api.popTransform();
		api.endFrame();

		const menu = backend.commands.find((command) => command.id === 'menu') as RectCommand;
		expect(menu.clip).toEqual({ kind: 'none' });
		// R3.8: the reset is the only thing promotion changes.
		expect(menu.transform).toEqual([1, 0, 0, 1, 20, 30]);
		expect(backend.ids).toEqual(['row', 'menu']);
	});

	it('emits every visible row of a 500-row scroller and counts the rest culled (R4.2a)', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT, ratio: 1 });
		api.pushClip(rect(0, 0, 300, 284));
		for (let index = 0; index < 500; index++) {
			api.drawRect({ rect: rect(0, index * 24, 280, 20), fill: BLUE, id: `row-${index}` });
		}
		api.popClip();
		api.endFrame();

		expect(backend.ids).toEqual(Array.from({ length: 12 }, (_unused, index) => `row-${index}`));
		const stats = api.getStats();
		expect(stats.apiDraws).toBe(12);
		expect(stats.culled).toBe(488);
		expect(stats.apiDraws + stats.culled).toBe(500);
	});

	it('never bounds-culls text, because a run extent needs R6.8 glyph iteration', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushClip(rect(0, 0, 10, 10));
		api.drawText({ text: 'far away', position: { x: 5000, y: 5000 }, font: 'body', size: 12, color: RED, id: 'text' });
		api.drawRect({ rect: rect(5000, 5000, 10, 10), fill: BLUE, id: 'shape' });
		api.popClip();
		api.endFrame();

		expect(backend.ids).toEqual(['text']);
		expect(api.getStats().culled).toBe(1);
	});

	it('does not bounds-cull under an unclipped state, whose rect is R4.1 all-covering', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(-9000, -9000, 10, 10), fill: BLUE, id: 'offscreen' });
		api.endFrame();

		expect(backend.ids).toEqual(['offscreen']);
		expect(api.getStats().culled).toBe(0);
	});

	it('culls a shadow and its owner independently', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushClip(rect(0, 0, 100, 100));
		// The rect sits outside the clip; its 60px shadow padding reaches in.
		api.drawRect({
			rect: rect(140, 20, 20, 20),
			fill: BLUE,
			shadow: { color: RED, blur: 40 },
			id: 'edge',
		});
		api.popClip();
		api.endFrame();

		expect(backend.commands.map((command) => command.kind)).toEqual(['shadow']);
		expect(api.getStats().culled).toBe(1);
	});
});

describe('opacity stack (R2.6, R3.25)', () => {
	it('multiplies down the stack', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushOpacity(0.5);
		api.pushOpacity(0.5);
		api.pushOpacity(0.5);
		expect(api.opacity).toBe(0.125);
		api.popOpacity();
		expect(api.opacity).toBe(0.25);
		api.endFrame();
	});

	it('applies the same product to a shadow group as to its owner', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushOpacity(0.4);
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, shadow: { color: RED, blur: 2 }, id: 'card' });
		api.popOpacity();
		api.endFrame();

		expect(backend.commands.map((command) => command.opacity)).toEqual([0.4, 0.4]);
	});

	it('clamps an out-of-range factor and reports it', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushOpacity(2);
		expect(api.opacity).toBe(1);
		api.pushOpacity(-1);
		expect(api.opacity).toBe(0);
		expect(codes(api)).toEqual(['opacity-out-of-range', 'opacity-out-of-range']);
		api.endFrame();
	});

	it('still emits at opacity zero, because R3.27 makes that a paint decision, not a drop', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushOpacity(0);
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'invisible' });
		api.popOpacity();
		api.endFrame();

		expect(backend.ids).toEqual(['invisible']);
		expect(backend.commands[0].opacity).toBe(0);
	});
});

describe('layer stack (R2.7, R3.6)', () => {
	it('stamps the pushed layer and its ordinal', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushLayer('tooltip');
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'tip' });
		api.popLayer();
		api.endFrame();

		expect(backend.commands[0].layer).toBe('tooltip');
		expect(backend.commands[0].layerOrdinal).toBe(60);
	});

	it('keeps a base child of a raised card in raised and reports the authoring error (R3.6)', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushLayer('raised');
		api.pushLayer('base');
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'child' });
		api.popLayer();
		api.popLayer();
		api.endFrame();

		expect(backend.commands[0].layer).toBe('raised');
		expect(codes(api)).toEqual(['layer-lowered']);
	});

	it('keeps a menu opened from a toast in toast, above its host (R3.6a)', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushLayer('toast');
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'toast-bg' });
		api.pushLayer('popup');
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'menu' });
		api.popLayer();
		api.popLayer();
		api.endFrame();

		expect(backend.commands.map((command) => command.layer)).toEqual(['toast', 'toast']);
		expect(backend.ids).toEqual(['toast-bg', 'menu']);
	});

	it('restores the previous layer on pop', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushLayer('modal');
		api.pushLayer('popup');
		api.popLayer();
		expect(api.layer).toBe('modal');
		api.popLayer();
		expect(api.layer).toBe('base');
		api.endFrame();
	});
});

describe('emit order (R3.10) and chapter 3.12 required tests', () => {
	it('emits mixed layers in layer order and keeps submission order inside each', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushLayer('popup');
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'menu-bg' });
		api.popLayer();
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'panel' });
		api.pushLayer('popup');
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'menu-row' });
		api.popLayer();
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'label' });
		api.pushLayer('modal');
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'scrim' });
		api.popLayer();
		api.endFrame();

		expect(backend.ids).toEqual(['panel', 'label', 'scrim', 'menu-bg', 'menu-row']);
	});

	it('leaves a single-layer domain in its submission sequence and reorders nothing', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		for (const id of ['a', 'b', 'c', 'd']) {
			api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id });
		}
		api.endFrame();

		expect(backend.ids).toEqual(['a', 'b', 'c', 'd']);
		expect(api.getStats().reorderedGroups).toBe(0);
	});

	it('counts the groups a reorder actually moved', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushLayer('popup');
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'menu' });
		api.popLayer();
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'panel' });
		api.endFrame();

		expect(api.getStats().reorderedGroups).toBe(2);
	});

	it('isolates domains at a barrier, so a tooltip before a flush emits before a base after it', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushLayer('tooltip');
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'world-tooltip' });
		api.popLayer();
		api.flush();
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'ui-panel' });
		api.endFrame();

		expect(backend.batches.map((batch) => batch.reason)).toEqual(['barrier', 'endFrame']);
		expect(backend.ids).toEqual(['world-tooltip', 'ui-panel']);
	});

	it('keeps a shadow immediately before its owner with other groups of the same layer around it (R3.16)', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'before' });
		api.pushLayer('popup');
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'popup-above' });
		api.popLayer();
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, shadow: { color: RED, blur: 2 }, id: 'card' });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'after' });
		api.endFrame();

		expect(backend.ids).toEqual(['before', 'card', 'card', 'after', 'popup-above']);
		expect(backend.commands.map((command) => command.kind)).toEqual([
			'rect',
			'shadow',
			'rect',
			'rect',
			'rect',
		]);
		expect(backend.commands.map((command) => command.group)).toEqual([
			'primary',
			'shadow',
			'primary',
			'primary',
			'primary',
		]);
	});

	it('puts a shadowed text run immediately before its main run (R3.17)', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawText({
			text: '12/20',
			position: { x: 10, y: 10 },
			font: 'body',
			size: 12,
			color: RED,
			shadow: { color: BLUE, offset: { x: 0, y: 1 } },
			id: 'hp',
		});
		api.endFrame();

		const [shadow, main] = backend.commands as TextCommand[];
		expect(shadow.group).toBe('shadow');
		expect(shadow.color).toEqual(BLUE);
		expect(shadow.position).toEqual({ x: 10, y: 11 });
		expect(main.group).toBe('primary');
		expect(main.color).toEqual(RED);
		expect(main.position).toEqual({ x: 10, y: 10 });
	});

	it('produces an identical group sequence for two renders of the same script (R3.4)', () => {
		const script = (api: DrawApi): void => {
			api.beginFrame({ viewport: VIEWPORT });
			api.pushLayer('modal');
			api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, shadow: { color: RED }, id: 'dialog' });
			api.popLayer();
			api.drawText({ text: 'x', position: { x: 1, y: 1 }, font: 'body', size: 12, color: RED, id: 'label' });
			api.endFrame();
		};

		const { api, backend } = harness();
		script(api);
		const first = JSON.parse(JSON.stringify(backend.commands));
		script(api);
		expect(JSON.parse(JSON.stringify(backend.commands))).toStrictEqual(first);
	});

	it('numbers domains from zero and gives every group a dense sequence', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'a' });
		api.flush();
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'b' });
		api.endFrame();

		expect(backend.batches.map((batch) => batch.domain)).toEqual([0, 1]);
		expect(backend.commands.map((command) => command.sequence)).toEqual([0, 1]);
	});

	it('reports how many groups are waiting on the current domain', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		expect(api.pendingCount).toBe(0);
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, shadow: { color: RED } });
		expect(api.pendingCount).toBe(2);
		api.flush();
		expect(api.pendingCount).toBe(0);
		api.endFrame();
	});

	it('submits nothing and counts no flush for an empty barrier', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.flush();
		api.flush();
		api.endFrame();

		expect(backend.batches).toHaveLength(0);
		expect(api.getStats().flushes).toEqual({ barrier: 0, endFrame: 0, targetChange: 0, bufferFull: 0 });
	});
});

describe('draw calls (R2.8 to R2.13)', () => {
	it('fills every rect default and keeps geometry local', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(1, 2, 3, 4), fill: BLUE, border: { color: RED, width: 2 } });
		api.endFrame();

		const command = backend.commands[0] as RectCommand;
		expect(command).toMatchObject({
			kind: 'rect',
			rect: { x: 1, y: 2, width: 3, height: 4 },
			fill: BLUE,
			radius: null,
			gradient: null,
			border: { color: RED, width: 2, position: 'inside' },
			blend: 'over',
			group: 'primary',
			id: null,
		});
	});

	it('carries a per-draw blend mode (R5.22a)', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, blend: 'additive' });
		api.endFrame();
		expect(backend.commands[0].blend).toBe('additive');
	});

	it('carries the owner rect and radii on a shadow and resolves none of R5.11 geometry', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({
			rect: rect(10, 10, 40, 20),
			fill: BLUE,
			radius: 6,
			shadow: { color: RED, blur: 8, spread: 2, offset: { x: 0, y: 2 } },
		});
		api.endFrame();

		expect(backend.commands[0]).toMatchObject({
			kind: 'shadow',
			rect: { x: 10, y: 10, width: 40, height: 20 },
			radius: 6,
			shadow: { color: RED, blur: 8, spread: 2, offset: { x: 0, y: 2 } },
		});
	});

	it('emits one group for a polyline, not one per segment', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawPolyline({
			points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
			color: RED,
			width: 2,
			closed: true,
		});
		api.endFrame();

		expect(backend.commands).toHaveLength(1);
		expect(api.getStats().apiDraws).toBe(1);
	});

	it('takes a polygon with or without indices (R2.11)', () => {
		const { api, backend } = harness();
		const triangle = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
		api.beginFrame({ viewport: VIEWPORT });
		api.drawPolygon({ points: triangle, fill: BLUE, id: 'implicit' });
		api.drawPolygon({ points: triangle, indices: [0, 1, 2], colors: [BLUE, RED, BLUE], id: 'indexed' });
		api.endFrame();

		expect(backend.commands[0]).toMatchObject({ indices: null, colors: null });
		expect(backend.commands[1]).toMatchObject({ indices: [0, 1, 2], colors: [BLUE, RED, BLUE] });
	});

	it('reads a source rect in texture pixels unless told otherwise (R2.12)', () => {
		const { api, backend, texture } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawImage({ rect: rect(0, 0, 32, 32), texture, sourceRect: rect(0, 0, 16, 16), id: 'pixels' });
		api.drawImage({ rect: rect(0, 0, 32, 32), texture, sourceRect: rect(0, 0, 0.5, 0.5), sourceSpace: 'uv', id: 'uv' });
		api.endFrame();

		expect(backend.commands[0]).toMatchObject({ sourceSpace: 'pixels' });
		expect(backend.commands[1]).toMatchObject({ sourceSpace: 'uv' });
	});

	it('carries nine-slice insets and a tint (R2.12, R5.19)', () => {
		const { api, backend, texture } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawImage({
			rect: rect(0, 0, 64, 64),
			texture,
			tint: RED,
			slice: { top: 4, right: 4, bottom: 4, left: 4 },
			id: 'frame',
		});
		api.endFrame();

		expect(backend.commands[0]).toMatchObject({
			kind: 'image',
			tint: RED,
			slice: { top: 4, right: 4, bottom: 4, left: 4 },
			sourceRect: null,
		});
		expect((backend.commands[0] as { texture: unknown }).texture).toBe(texture);
	});

	it('fills every text default (R2.13)', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawText({ text: 'Total', box: rect(0, 0, 100, 20), font: 'body', size: 13, color: RED });
		api.endFrame();

		expect(backend.commands[0]).toMatchObject({
			kind: 'text',
			text: 'Total',
			position: null,
			box: { x: 0, y: 0, width: 100, height: 20 },
			align: 'left',
			verticalAlign: 'top',
			letterSpacing: 0,
			textTransform: 'none',
			maxWidth: null,
			wrap: 'none',
			overflow: 'visible',
			blur: 0,
		});
	});
});

describe('measureText (R2.14)', () => {
	it('throws rather than returning a number no glyph iteration produced', () => {
		const { api } = harness();
		expect(() => api.measureText({ text: 'hello', font: 'body', size: 13 })).toThrow(
			TEXT_MEASUREMENT_UNAVAILABLE,
		);
	});

	it('delegates to a backend that owns the glyph walk, so R6.8 is structural', () => {
		const backend = new RecordingBackend();
		const measured = { width: 42, height: 16, lines: 1, advances: [10, 20, 30, 42] };
		(backend as unknown as { measureText: () => typeof measured }).measureText = () => measured;
		const api = new DrawApi({ backend });

		expect(api.measureText({ text: 'four', font: 'body', size: 13 })).toBe(measured);
	});
});

describe('foreign draws (R2.15, R2.16)', () => {
	it('forwards invalidateState and never asks the backend what its state is', () => {
		const { api, backend } = harness();
		api.invalidateState();
		expect(backend.invalidateStateCount).toBe(1);
	});

	it('folds a foreign pass GPU work into the same counters (R13.15)', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.flush();
		api.reportForeignDraws({
			gpuDraws: 3,
			vertices: 900,
			triangles: 300,
			instances: 0,
			textureBinds: 2,
			bytesUploaded: 1024,
		});
		api.endFrame();

		const stats = api.getStats();
		expect(stats.gpuDraws).toBe(3);
		expect(stats.vertices).toBe(900);
		expect(stats.triangles).toBe(300);
		expect(stats.bytesUploaded).toBe(1024);
	});

	it('reports a foreign pass that did not flush first', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE });
		api.reportForeignDraws({
			gpuDraws: 1,
			vertices: 6,
			triangles: 2,
			instances: 0,
			textureBinds: 0,
			bytesUploaded: 0,
		});
		api.endFrame();

		expect(codes(api)).toContain('foreign-draw-without-flush');
	});

	it('says nothing when the foreign pass flushed first', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE });
		api.flush();
		api.reportForeignDraws({
			gpuDraws: 1,
			vertices: 6,
			triangles: 2,
			instances: 0,
			textureBinds: 0,
			bytesUploaded: 0,
		});
		api.endFrame();

		expect(codes(api)).toEqual([]);
	});
});

describe('resources (R2.17, R2.18)', () => {
	it('mints a handle through the backend and reports an upload inside a frame', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		const handle = api.createTexture({ width: 8, height: 8 });
		api.endFrame();

		expect(handle).toEqual({ id: 2, width: 8, height: 8, label: null });
		expect(codes(api)).toContain('texture-upload-in-frame');
	});

	it('reports drawText before its atlas is loaded and still emits the run (R2.18)', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawText({ text: 'x', position: { x: 0, y: 0 }, font: 'display', size: 12, color: RED, id: 'early' });
		api.endFrame();

		expect(codes(api)).toEqual(['text-before-atlas']);
		expect(backend.ids).toEqual(['early']);
	});

	it('says nothing once the atlas for that role is loaded', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawText({ text: 'x', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED });
		api.endFrame();

		expect(codes(api)).toEqual([]);
	});

	it('releases a handle through the backend', () => {
		const { api, texture } = harness();
		expect(() => api.destroyTexture(texture)).not.toThrow();
	});
});

describe('getStats (R2.19, R13.12 to R13.15)', () => {
	it('counts one apiDraw per emitted group, shadow groups included', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, shadow: { color: RED } });
		api.drawText({ text: 'x', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED, shadow: { color: BLUE } });
		api.endFrame();

		expect(api.getStats().apiDraws).toBe(4);
	});

	it('counts groups per layer with every band of the ladder present', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE });
		api.pushLayer('modal');
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE });
		api.popLayer();
		api.endFrame();

		expect(api.getStats().groupsByLayer).toEqual({
			base: 1,
			raised: 0,
			overlay: 0,
			modal: 2,
			popup: 0,
			toast: 0,
			tooltip: 0,
			drag: 0,
			transition: 0,
		});
	});

	it('counts every clip push including a promotion reset (R4.17)', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushClip(rect(0, 0, 10, 10));
		api.pushClipRounded(rect(0, 0, 5, 5), 2);
		api.pushClipReset();
		api.popClip();
		api.popClip();
		api.popClip();
		api.endFrame();

		expect(api.getStats().clipPushes).toBe(3);
	});

	it('counts flushes by reason', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE });
		api.flush();
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE });
		api.flush();
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE });
		api.endFrame();

		expect(api.getStats().flushes).toEqual({
			barrier: 2,
			endFrame: 1,
			targetChange: 0,
			bufferFull: 0,
		});
	});

	it('leaves occluded null, because R3.2 optional drop is not implemented', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE });
		api.endFrame();

		expect(api.getStats().occluded).toBeNull();
	});

	it('holds clipChange and shaderChange at zero, which R13.13 requires of this design', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushClip(rect(0, 0, 10, 10));
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE });
		api.drawText({ text: 'x', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED });
		api.popClip();
		api.endFrame();

		const stats = api.getStats();
		expect(stats.clipChange).toBe(0);
		expect(stats.shaderChange).toBe(0);
	});

	it('leaves the resource counters null, because R5.30 resource layer is a later PR', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.endFrame();

		const stats = api.getStats();
		expect(stats.residentTextureBytes).toBeNull();
		expect(stats.pendingUploads).toBeNull();
		expect(stats.evictions).toBeNull();
		expect(stats.targetSwitches).toBeNull();
	});

	it('keeps the last frame stats readable after endFrame', () => {
		const { api } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE });
		api.endFrame();

		expect(api.getStats().apiDraws).toBe(1);
	});
});

/**
 * TEMPORARY, deleted with the ordering re-baseline PR. `legacyTextOrder` is the
 * one option in this file that exists to preserve a bug rather than a rule; see
 * `DrawApiOptions.legacyTextOrder` and
 * docs/AI_TECHNICAL_DECISIONS/legacy-gl-backend.md.
 */
describe('legacyTextOrder (TEMPORARY)', () => {
	it('is off by default, so a clip change flushes nothing (R3.20)', () => {
		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'before' });
		api.pushClip(rect(0, 0, 5, 5));
		api.drawRect({ rect: rect(0, 0, 5, 5), fill: RED, id: 'inside' });
		api.popClip();
		api.endFrame();

		expect(backend.batches).toHaveLength(1);
		expect(backend.ids).toEqual(['before', 'inside']);
	});

	it('ends a domain at every clip push and pop when it is on', () => {
		const { api, backend } = harness({ legacyTextOrder: true });
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'before' });
		api.pushClip(rect(0, 0, 5, 5));
		api.drawRect({ rect: rect(0, 0, 5, 5), fill: RED, id: 'inside' });
		api.popClip();
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'after' });
		api.endFrame();

		expect(backend.batches.map((batch) => batch.commands.map((command) => command.id))).toEqual([
			['before'],
			['inside'],
			['after'],
		]);
		expect(backend.batches.map((batch) => batch.reason)).toEqual(['barrier', 'barrier', 'endFrame']);
	});

	it('counts those barriers as flushes so the number is not silently free', () => {
		const { api } = harness({ legacyTextOrder: true });
		api.beginFrame({ viewport: VIEWPORT });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE });
		api.pushClip(rect(0, 0, 5, 5));
		api.drawRect({ rect: rect(0, 0, 5, 5), fill: RED });
		api.popClip();
		api.endFrame();

		expect(api.getStats().flushes).toMatchObject({ barrier: 2, endFrame: 0 });
	});

	it('leaves submission order alone inside a domain', () => {
		// Only LegacyGLBackend paints text late, and only because TextRenderer
		// defers it. The API keeps reporting what was actually submitted.
		const { api, backend } = harness({ legacyTextOrder: true });
		api.beginFrame({ viewport: VIEWPORT });
		api.drawText({ text: 'a', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED, id: 'text' });
		api.drawRect({ rect: rect(0, 0, 10, 10), fill: BLUE, id: 'rect' });
		api.endFrame();

		expect(backend.ids).toEqual(['text', 'rect']);
	});
});

describe('R14.1: the module runs with no DOM and no GL', () => {
	it('renders a full frame with nothing global touched', () => {
		expect(typeof (globalThis as Record<string, unknown>).document).toBe('undefined');

		const { api, backend } = harness();
		api.beginFrame({ viewport: VIEWPORT });
		api.pushLayer('overlay');
		api.pushClip(rect(0, 0, 200, 200));
		api.drawRect({ rect: rect(0, 0, 100, 30), fill: BLUE, radius: 4, shadow: { color: RED, blur: 3 } });
		api.drawText({ text: 'ready', position: { x: 4, y: 4 }, font: 'body', size: 12, color: RED });
		api.popClip();
		api.popLayer();
		api.endFrame();

		const commands: readonly DrawCommand[] = backend.commands;
		expect(commands).toHaveLength(3);
	});
});
