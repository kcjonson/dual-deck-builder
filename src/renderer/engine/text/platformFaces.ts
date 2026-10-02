import { FONT_FACES, FontFaceAsset } from './fontFaces';

/** Loads one font file under a family name the 2D text API can then select. */
export type PlatformFaceLoader = (family: string, url: string) => Promise<void>;

export interface PlatformFacesOptions {
	faces?: readonly FontFaceAsset[];
	load: PlatformFaceLoader;
	/** A face that failed to load; its role keeps drawing small text from the distance field. */
	onError?: (face: string, error: unknown) => void;
}

/**
 * The font files behind the distance-field atlases, registered with the
 * platform for R6.4a's raster fallback. Each role's family is private to the
 * engine (`ddb-<face>`), so a page font of the same name can never stand in
 * for it and draw different outlines than the atlas measures.
 *
 * Loading starts on construction and is not awaited by anything: until a
 * role's face is ready `familyOf` is null and its small text stays on the
 * distance field, soft but measured the same, so nothing waits on a file the
 * game can run without.
 */
export class PlatformFaces {
	private readonly ready = new Map<string, string>();
	private readonly fieldInk = new Map<string, number>();

	constructor({ faces = FONT_FACES, load, onError = () => undefined }: PlatformFacesOptions) {
		for (const face of faces) {
			if (!face.fontUrl) continue;
			if (face.fieldInk !== undefined) this.fieldInk.set(face.role, face.fieldInk);
			const family = `ddb-${face.face}`;
			load(family, face.fontUrl).then(
				() => this.ready.set(face.role, family),
				(error: unknown) => onError(face.face, error),
			);
		}
	}

	/** The family to rasterise a font role with, once its face has loaded; null before, or without one. */
	familyOf(role: string): string | null {
		return this.ready.get(role) ?? null;
	}

	/** The distance field's ink a role's raster glyphs are matched to (`FontFaceAsset.fieldInk`); null without one. */
	fieldInkOf(role: string): number | null {
		return this.fieldInk.get(role) ?? null;
	}
}

/**
 * The browser's loader: a `FontFace` added to `document.fonts` before it
 * loads, so `document.fonts.ready` (which the screenshot harness waits on)
 * covers it.
 */
export function documentFaceLoader(fonts: FontFaceSet = document.fonts): PlatformFaceLoader {
	return async (family, url) => {
		const face = new FontFace(family, `url(${JSON.stringify(url)})`);
		fonts.add(face);
		await face.load();
	};
}
