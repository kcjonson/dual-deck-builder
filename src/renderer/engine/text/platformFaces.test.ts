import { FONT_FACES, ICON_ATLAS } from './fontFaces';
import { PlatformFaces } from './platformFaces';

describe('PlatformFaces (R6.4a)', () => {
	it('names each role a private family once its face loads, and not before', async () => {
		const loads: { family: string; url: string; resolve: () => void }[] = [];
		const faces = new PlatformFaces({
			load: (family, url) => new Promise<void>((resolve) => loads.push({ family, url, resolve })),
		});
		expect(loads.map((load) => load.family)).toEqual(FONT_FACES.map((face) => `ddb-${face.face}`));
		expect(faces.familyOf('body')).toBeNull();

		loads.find((load) => load.family === 'ddb-open-sans-regular')?.resolve();
		await Promise.resolve();
		expect(faces.familyOf('body')).toBe('ddb-open-sans-regular');
		expect(faces.familyOf('display')).toBeNull();
	});

	it('loads nothing for a face without a font file, such as the icons', () => {
		const families: string[] = [];
		const faces = new PlatformFaces({
			faces: [ICON_ATLAS as never],
			load: async (family) => {
				families.push(family);
			},
		});
		expect(families).toEqual([]);
		expect(faces.familyOf('icons')).toBeNull();
	});

	it('reports a face that fails and leaves its role on the distance field', async () => {
		const errors: string[] = [];
		const faces = new PlatformFaces({
			faces: FONT_FACES.filter((face) => face.role === 'mono'),
			load: () => Promise.reject(new Error('404')),
			onError: (face, error) => errors.push(`${face}: ${(error as Error).message}`),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(errors).toEqual(['jetbrains-mono-regular: 404']);
		expect(faces.familyOf('mono')).toBeNull();
	});
});
