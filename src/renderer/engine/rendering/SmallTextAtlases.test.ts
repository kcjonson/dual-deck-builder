import type { TextureHandle } from '../draw/commands';
import type { TextureOptions } from '../gpu/TextureStore';
import type { GlyphCanvasContext } from '../text/rasterGlyphs';
import { syntheticFontAtlas } from '../text/testing';
import { GlyphCanvas, SmallTextAtlases } from './SmallTextAtlases';

function fakeContext(): GlyphCanvasContext {
	const noop = () => undefined;
	return {
		font: '',
		fillStyle: '',
		textBaseline: 'alphabetic',
		textAlign: 'left',
		clearRect: noop,
		save: noop,
		restore: noop,
		beginPath: noop,
		rect: noop,
		clip: noop,
		fillText: noop,
	};
}

function setup({ family = 'ddb-synthetic' as string | null, canvas = true, idleFrames = 3, buildsPerFrame = 4 } = {}) {
	const created: TextureOptions[] = [];
	const released: number[] = [];
	let nextId = 1;
	const canvases: GlyphCanvas[] = [];
	const atlases = new SmallTextAtlases({
		textures: {
			create: (options) => {
				created.push(options);
				return { id: nextId++, width: options.width, height: options.height, label: options.label ?? null } as TextureHandle;
			},
			release: (handle) => released.push(handle.id),
		},
		familyOf: (font) => (font === 'body' ? family : null),
		createCanvas: (width, height) => {
			if (!canvas) return null;
			const made = { source: new Uint8Array(width * height * 4), context: fakeContext() };
			canvases.push(made);
			return made;
		},
		idleFrames,
		buildsPerFrame,
	});
	return { atlases, created, released, canvases };
}

describe('SmallTextAtlases (R6.4a)', () => {
	const font = syntheticFontAtlas();

	it('builds one immediate, colour texture per (role, device font size) and reuses it', () => {
		const { atlases, created } = setup();
		atlases.beginFrame();
		const first = atlases.glyphs('body', font, 8);
		const again = atlases.glyphs('body', font, 8);
		expect(first).not.toBeNull();
		expect(again).toBe(first);
		expect(created).toHaveLength(1);
		expect(created[0]).toMatchObject({ content: 'color', immediate: true, keepSource: true, width: first?.width, height: first?.height });
		atlases.glyphs('body', font, 7);
		expect(created).toHaveLength(2);
		expect(atlases.size).toBe(2);
	});

	it('keeps the distance field while the role has no loaded face, or there is no canvas', () => {
		expect(setup({ family: null }).atlases.glyphs('body', font, 8)).toBeNull();
		expect(setup().atlases.glyphs('display', font, 8)).toBeNull();
		expect(setup({ canvas: false }).atlases.glyphs('body', font, 8)).toBeNull();
	});

	it('builds at most its budget a frame, and the rest on later frames', () => {
		const { atlases, created } = setup({ buildsPerFrame: 2 });
		atlases.beginFrame();
		expect(atlases.glyphs('body', font, 6)).not.toBeNull();
		expect(atlases.glyphs('body', font, 7)).not.toBeNull();
		expect(atlases.glyphs('body', font, 8)).toBeNull();
		// A built size is still served past the budget.
		expect(atlases.glyphs('body', font, 6)).not.toBeNull();
		atlases.beginFrame();
		expect(atlases.glyphs('body', font, 8)).not.toBeNull();
		expect(created).toHaveLength(3);
	});

	it('frees an atlas idle past its frame budget, and keeps one in use', () => {
		const { atlases, released } = setup({ idleFrames: 3 });
		atlases.beginFrame();
		const idle = atlases.glyphs('body', font, 7);
		atlases.glyphs('body', font, 8);
		for (let frame = 0; frame < 4; frame++) {
			atlases.beginFrame();
			atlases.glyphs('body', font, 8);
		}
		expect(released).toEqual([idle?.texture.id]);
		expect(atlases.size).toBe(1);
	});

	it('replans when a role is loaded again with another atlas', () => {
		const { atlases, created, released } = setup();
		atlases.beginFrame();
		const before = atlases.glyphs('body', font, 8);
		const after = atlases.glyphs('body', syntheticFontAtlas(), 8);
		expect(after).not.toBe(before);
		expect(created).toHaveLength(2);
		expect(released).toEqual([before?.texture.id]);
	});

	it('frees everything on clear', () => {
		const { atlases, released } = setup();
		atlases.glyphs('body', font, 8);
		atlases.glyphs('body', font, 7);
		atlases.clear();
		expect(released).toHaveLength(2);
		expect(atlases.size).toBe(0);
	});
});
