/**
 * @jest-environment jsdom
 */
import { DrawApi, RecordingBackend } from '../draw';
import { RendererContext } from '../rendering/RendererContext';
import { DEFAULT_FONT } from '../rendering/fonts';
import { Layer } from './Layer';
import { Rectangle } from './Rectangle';
import { Text } from './Text';

/**
 * The order lock for the deviation `DrawApiOptions.legacyTextOrder` carries,
 * and the file the ordering re-baseline PR deletes.
 *
 * What it pins is the BOUND, not the reordering. The reordering lives in
 * `TextRenderer`, which holds runs until `LegacyGLBackend` flushes them at the
 * end of a batch; that is invisible from here and is the backend's own business.
 * What is visible from here, and what a golden depends on, is that a clip push
 * and a clip pop each end a sort domain, so a text run cannot outlive the scope
 * it was submitted in. Without it, the three chromium goldens whose screens clip
 * fail.
 *
 * A PR that re-mints the goldens while this file still passes has not removed
 * the hack.
 */

describe('legacyTextOrder domain bounds (TEMPORARY)', () => {
	let backend: RecordingBackend;

	function build(legacyTextOrder: boolean): DrawApi {
		backend = new RecordingBackend({ maxFrames: 1 });
		// The atlas R2.18 checks against, so `text-before-atlas` stays silent.
		backend.loadFontAtlas({
			name: DEFAULT_FONT,
			metrics: null,
			texture: { id: 1, width: 1, height: 1, label: null },
		});
		const api = new DrawApi({ backend, legacyTextOrder });
		RendererContext.getInstance().draw = api;
		return api;
	}

	/**
	 * text, rect, [clip: rect, text], text. The scene is deliberately the shape
	 * `Panel` produces: something drawn before the clip, something inside it,
	 * and something after.
	 */
	function scene(): Layer {
		const root = new Layer({ id: 'root', width: 200, height: 200 });
		root.addChild(new Text('before', { id: 'before', x: 0, y: 0 }));
		root.addChild(new Rectangle({ id: 'outside', x: 0, y: 10, width: 10, height: 10 }));

		const clipper = new Layer({ id: 'clipper', x: 0, y: 20, width: 100, height: 50, overflow: 'hidden' });
		clipper.addChild(new Rectangle({ id: 'inside', x: 0, y: 0, width: 10, height: 10 }));
		clipper.addChild(new Text('inside', { id: 'insideText', x: 0, y: 0 }));
		root.addChild(clipper);

		root.addChild(new Text('after', { id: 'after', x: 0, y: 100 }));
		return root;
	}

	function domains(): string[][] {
		return backend.batches.map((batch) => batch.commands.map((command) => command.id ?? '?'));
	}

	it('ends a domain at the clip push and at the clip pop', () => {
		const api = build(true);
		api.beginFrame({ viewport: { width: 200, height: 200 } });
		scene().render();
		api.endFrame();

		// Three domains: before the clip, inside it, after it. The text run
		// submitted before the clip is in the first, so the backend's flush
		// paints it before the scissor changes, which is what
		// `Renderer.enableScissor` did.
		expect(domains()).toEqual([
			['before', 'outside'],
			['inside', 'insideText'],
			['after'],
		]);
		expect(backend.batches.map((batch) => batch.reason)).toEqual(['barrier', 'barrier', 'endFrame']);
	});

	it('is one domain without the flag, which is what R3.20 actually requires', () => {
		const api = build(false);
		api.beginFrame({ viewport: { width: 200, height: 200 } });
		scene().render();
		api.endFrame();

		expect(domains()).toEqual([['before', 'outside', 'inside', 'insideText', 'after']]);
	});

	it('leaves submission order alone inside a domain', () => {
		// The draw API reports the true order whatever the flag says; only
		// LegacyGLBackend paints text late, and only because TextRenderer does.
		const api = build(true);
		api.beginFrame({ viewport: { width: 200, height: 200 } });
		scene().render();
		api.endFrame();

		expect(backend.commands.map((command) => command.kind)).toEqual([
			'text',
			'rect',
			'rect',
			'text',
			'text',
		]);
	});
});
