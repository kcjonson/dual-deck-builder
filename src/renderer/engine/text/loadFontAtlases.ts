import { FontAtlas, FontAtlasError, FontAtlasWarn, parseFontAtlas } from './FontAtlas';
import { ATLAS_ASSETS, AtlasRole, FontFaceAsset } from './fontFaces';

/** The part of a decoded image the loader checks; `HTMLImageElement` satisfies it. */
export interface AtlasImage {
	readonly naturalWidth: number;
	readonly naturalHeight: number;
}

export interface LoadedFontAtlas<Image extends AtlasImage = HTMLImageElement> {
	readonly role: AtlasRole;
	readonly face: string;
	readonly atlas: FontAtlas;
	readonly image: Image;
}

interface LoadFontAtlasesOptions<Image extends AtlasImage> {
	faces?: readonly FontFaceAsset<AtlasRole>[];
	/** Decodes one atlas image. Injected so the loader is testable without a DOM (R14.1). */
	loadImage: (url: string) => Promise<Image>;
	warn?: FontAtlasWarn;
}

/**
 * Validates every face's metrics (R6.2), the icon atlas's among them, then decodes its atlas image and
 * checks the image is the size the metrics describe, which is the one mistake
 * the JSON alone cannot catch: a PNG regenerated without its JSON, or the
 * other way round, would otherwise sample the wrong texels for every glyph.
 * Rejects with `FontAtlasError` on the first face that fails.
 */
export async function loadFontAtlases<Image extends AtlasImage>({
	faces = ATLAS_ASSETS,
	loadImage,
	warn,
}: LoadFontAtlasesOptions<Image>): Promise<LoadedFontAtlas<Image>[]> {
	const parsed = faces.map((face) => ({
		face,
		atlas: parseFontAtlas({ json: face.metrics, source: face.face, warn }),
	}));

	return Promise.all(parsed.map(async ({ face, atlas }) => {
		let image: Image;
		try {
			image = await loadImage(face.imageUrl);
		} catch (error) {
			throw new FontAtlasError(face.face, `image failed to load (${describe(error)})`);
		}
		if (image.naturalWidth !== atlas.width || image.naturalHeight !== atlas.height) {
			throw new FontAtlasError(
				face.face,
				`image is ${image.naturalWidth}x${image.naturalHeight} but the metrics describe ${atlas.width}x${atlas.height}`,
			);
		}
		return { role: face.role, face: face.face, atlas, image };
	}));
}

/**
 * The browser's decoder. `decode()` resolves once the pixels are ready to
 * upload, so a caller never hands `texImage2D` a half-loaded image.
 */
export async function loadImageElement(url: string): Promise<HTMLImageElement> {
	const image = new Image();
	image.src = url;
	await image.decode();
	return image;
}

/**
 * What the page says when the atlases do not load: without them there is no
 * text to draw (R2.18), so the game does not start, and says why rather than
 * showing a blank canvas.
 */
export function fontLoadFailureMessage(error: unknown): string {
	return `The game's fonts failed to load (${describe(error)}). Reload the page to try again.`;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
