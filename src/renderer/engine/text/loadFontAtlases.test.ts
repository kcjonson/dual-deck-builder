import { FontAtlasError } from './FontAtlas';
import { FONT_FACES, FontFaceAsset } from './fontFaces';
import { AtlasImage, loadFontAtlases } from './loadFontAtlases';

const body = FONT_FACES.find((entry) => entry.face === 'open-sans-regular') as FontFaceAsset;
const face = (overrides: Partial<FontFaceAsset> = {}): FontFaceAsset => ({ ...body, ...overrides });

const sized = (width: number, height: number) => async (): Promise<AtlasImage> => ({
	naturalWidth: width,
	naturalHeight: height,
});

describe('loadFontAtlases', () => {
	it('loads every committed face with its role', async () => {
		// Jest stubs every image module to one URL, so each face gets its own
		// here and the fake decoder answers with the size its metrics give.
		const faces = FONT_FACES.map((entry) => ({ ...entry, imageUrl: entry.face }));
		const sizes = new Map(FONT_FACES.map((entry) => {
			const { width, height } = (entry.metrics as { atlas: { width: number; height: number } }).atlas;
			return [entry.face, { naturalWidth: width, naturalHeight: height }];
		}));
		const requested: string[] = [];
		const loaded = await loadFontAtlases({
			faces,
			loadImage: async (url) => {
				requested.push(url);
				const size = sizes.get(url);
				if (!size) throw new Error(`unexpected ${url}`);
				return size;
			},
		});
		expect(loaded.map((entry) => [entry.role, entry.face])).toEqual(
			FONT_FACES.map((entry) => [entry.role, entry.face]),
		);
		expect(requested).toEqual(FONT_FACES.map((entry) => entry.face));
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
