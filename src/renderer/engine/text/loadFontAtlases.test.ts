import { FontAtlasError } from './FontAtlas';
import { FONT_FACES, FontFaceAsset } from './fontFaces';
import { AtlasImage, loadFontAtlases } from './loadFontAtlases';

const face = (overrides: Partial<FontFaceAsset> = {}): FontFaceAsset => ({ ...FONT_FACES[0], ...overrides });

const sized = (width: number, height: number) => async (): Promise<AtlasImage> => ({
	naturalWidth: width,
	naturalHeight: height,
});

describe('loadFontAtlases', () => {
	it('loads every committed face with its role', async () => {
		const requested: string[] = [];
		const loaded = await loadFontAtlases({
			loadImage: async (url) => {
				requested.push(url);
				return { naturalWidth: 1024, naturalHeight: 512 };
			},
		});
		expect(loaded.map((entry) => [entry.role, entry.face])).toEqual(
			FONT_FACES.map((entry) => [entry.role, entry.face]),
		);
		expect(requested).toHaveLength(FONT_FACES.length);
		expect(loaded[0].atlas.glyph(0x41)).toBeDefined();
	});

	it('rejects an image that does not match its metrics', async () => {
		await expect(loadFontAtlases({ faces: [face()], loadImage: sized(512, 512) }))
			.rejects.toThrow('Font atlas open-sans-regular: image is 512x512 but the metrics describe 1024x512');
	});

	it('rejects with the face named when an image fails to load', async () => {
		const loading = loadFontAtlases({
			faces: [face()],
			loadImage: async () => {
				throw new Error('404');
			},
		});
		await expect(loading).rejects.toBeInstanceOf(FontAtlasError);
		await expect(loading).rejects.toThrow('open-sans-regular: image failed to load (404)');
	});

	it('rejects invalid metrics before decoding any image', async () => {
		const loadImage = jest.fn(sized(1024, 512));
		await expect(loadFontAtlases({ faces: [face(), face({ face: 'broken', metrics: {} })], loadImage }))
			.rejects.toThrow('Font atlas broken: missing "atlas"');
		expect(loadImage).not.toHaveBeenCalled();
	});
});
