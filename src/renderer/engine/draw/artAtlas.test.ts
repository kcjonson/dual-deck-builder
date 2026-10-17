import { ArtAtlasError, ArtAtlasManifest, ArtPiece, artSize, drawArt, loadArtAtlasImage, validateArtAtlas } from './artAtlas';
import { DrawApi } from './DrawApi';
import { NullBackend } from './NullBackend';
import { RecordingBackend } from './RecordingBackend';
import type { ImageCommand } from './commands';

const VIEWPORT = { width: 640, height: 480 };

function manifest(pieces: Record<string, ArtPiece>): ArtAtlasManifest {
	return { width: 256, height: 128, pieces };
}

const PAPER: ArtPiece = { x: 0, y: 0, width: 64, height: 64, scale: 1, tint: 'surface', slice: { top: 16, right: 16, bottom: 16, left: 16 } };
const ICON_2X: ArtPiece = { x: 70, y: 0, width: 36, height: 36, scale: 2, tint: 'ink' };

describe('validateArtAtlas', () => {
	it('accepts disjoint pieces inside the page', () => {
		expect(validateArtAtlas(manifest({ paper: PAPER, icon: ICON_2X }))).toEqual([]);
	});

	it('names a piece that leaves the page', () => {
		expect(validateArtAtlas(manifest({ wide: { ...ICON_2X, x: 240 } }))).toEqual(['wide: rect 240,0 36x36 leaves the 256x128 page']);
	});

	it('names overlapping pieces', () => {
		expect(validateArtAtlas(manifest({ paper: PAPER, over: { ...ICON_2X, x: 40 } }))).toEqual(['paper overlaps over']);
	});

	it('rejects a sliced 2x piece and insets with no centre', () => {
		const problems = validateArtAtlas(manifest({
			sliced: { ...ICON_2X, slice: { top: 4, right: 4, bottom: 4, left: 4 } },
			tight: { ...PAPER, slice: { top: 32, right: 16, bottom: 32, left: 16 } },
		}));
		expect(problems).toEqual([
			'sliced: a sliced piece has to be 1x',
			'tight: insets 32 16 32 16 leave no centre in 64x64',
		]);
	});

	it('rejects a fractional rect and an unknown scale', () => {
		expect(validateArtAtlas(manifest({ odd: { ...ICON_2X, width: 10.5, scale: 3 } }))).toEqual([
			'odd: rect 70,0 10.5x36 is not a positive integer rect',
			'odd: scale 3 is not 1 or 2',
		]);
	});
});

describe('loadArtAtlasImage', () => {
	const options = { name: 'ui', manifest: manifest({ paper: PAPER }), imageUrl: 'ui-art.png' };

	it('resolves with the image when it is the size the manifest describes', async () => {
		const image = { naturalWidth: 256, naturalHeight: 128 };
		await expect(loadArtAtlasImage({ ...options, loadImage: async () => image })).resolves.toBe(image);
	});

	it('rejects a page rebuilt without its manifest', async () => {
		const loading = loadArtAtlasImage({ ...options, loadImage: async () => ({ naturalWidth: 256, naturalHeight: 256 }) });
		await expect(loading).rejects.toThrow(ArtAtlasError);
		await expect(loading).rejects.toThrow('art atlas ui: image is 256x256 but the manifest describes 256x128');
	});

	it('wraps a failed decode', async () => {
		const loading = loadArtAtlasImage({ ...options, loadImage: async () => Promise.reject(new Error('404')) });
		await expect(loading).rejects.toThrow('art atlas ui: image failed to load (404)');
	});
});

describe('art atlas residency and draws (R5.19, R5.20, R5.31)', () => {
	it('keeps the page by name and tells the backend once per load', () => {
		const backend = new NullBackend();
		const api = new DrawApi({ backend });
		expect(api.artAtlas('ui')).toBeNull();
		const texture = api.createTexture({ width: 256, height: 128, label: 'ui art' });
		api.loadArtAtlas({ name: 'ui', texture });
		expect(api.artAtlas('ui')).toBe(texture);
		expect(backend.artAtlasLoads).toBe(1);
	});

	it('reports a load inside a frame (R2.17)', () => {
		const api = new DrawApi({ backend: new RecordingBackend(), development: true });
		const texture = api.createTexture({ width: 256, height: 128 });
		api.beginFrame({ viewport: VIEWPORT });
		api.loadArtAtlas({ name: 'ui', texture });
		api.endFrame();
		expect(api.diagnostics.map((diagnostic) => diagnostic.code)).toContain('texture-upload-in-frame');
	});

	it('draws a piece as an image from its rect, with its insets and tint', () => {
		const backend = new RecordingBackend();
		const api = new DrawApi({ backend });
		const texture = api.createTexture({ width: 256, height: 128 });
		api.beginFrame({ viewport: VIEWPORT });
		drawArt(api, { texture, piece: PAPER, rect: { x: 10, y: 20, width: 300, height: 200 }, tint: [0.9, 0.9, 0.8, 1], id: 'sheet' });
		drawArt(api, { texture, piece: ICON_2X, rect: { x: 0, y: 0, ...artSize(ICON_2X) } });
		api.endFrame();
		const [sheet, icon] = backend.commands as ImageCommand[];
		expect(sheet).toMatchObject({
			kind: 'image',
			texture,
			rect: { x: 10, y: 20, width: 300, height: 200 },
			sourceRect: { x: 0, y: 0, width: 64, height: 64 },
			sourceSpace: 'pixels',
			slice: { top: 16, right: 16, bottom: 16, left: 16 },
			tint: [0.9, 0.9, 0.8, 1],
		});
		expect(icon).toMatchObject({ rect: { width: 18, height: 18 }, sourceRect: { x: 70, y: 0, width: 36, height: 36 }, slice: null, tint: [1, 1, 1, 1] });
	});
});
