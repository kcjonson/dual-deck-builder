import uiArtImageUrl from '../../../assets/ui-art/ui-art.png';
import { ArtAtlasImage, ArtPiece, artSize, drawArt, loadArtAtlasImage } from '../../engine/draw/artAtlas';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { RGBA, Rect } from '../../engine/draw/geometry';
import { resolveColor } from '../../engine/style/styleObject';
import { UI_ART_MANIFEST, UiArtName } from './uiArtManifest';

export type { UiArtName };

/** The name the UI art page is resident under (`DrawApi.artAtlas`). */
export const UI_ART_ATLAS = 'ui';

const PIECES: Readonly<Record<string, ArtPiece>> = UI_ART_MANIFEST.pieces;
const WHITE: RGBA = [1, 1, 1, 1];

/** Each piece's 2x raster, keyed by the 1x name, for the pieces that have one. */
const DENSE = new Map<string, ArtPiece>();
/** Each baked surface piece's ground, resolved once rather than per draw. */
const GROUNDS = new Map<ArtPiece, RGBA>();
for (const [name, piece] of Object.entries(PIECES)) {
	if (name.endsWith('_2x')) DENSE.set(name.slice(0, -3), piece);
	if (piece.ground) GROUNDS.set(piece, resolveColor(piece.ground));
}

export interface LoadedUiArt<Image extends ArtAtlasImage> {
	name: string;
	image: Image;
	width: number;
	height: number;
}

/**
 * Decodes the committed page (src/assets/ui-art/ui-art.png, built by
 * scripts/build-ui-art.mjs) and checks it against the manifest, ready for
 * `createDrawApi`'s `artAtlases`.
 */
export async function loadUiArt<Image extends ArtAtlasImage>({ loadImage }: { loadImage: (url: string) => Promise<Image> }): Promise<LoadedUiArt<Image>> {
	const image = await loadArtAtlasImage({ name: UI_ART_ATLAS, manifest: UI_ART_MANIFEST, imageUrl: uiArtImageUrl, loadImage });
	return { name: UI_ART_ATLAS, image, width: UI_ART_MANIFEST.width, height: UI_ART_MANIFEST.height };
}

/** The raster to draw `name` from at a device pixel ratio: its 2x one above 1, where it has one. */
export function uiArtPiece(name: UiArtName, ratio = 1): ArtPiece {
	if (ratio > 1) {
		const dense = DENSE.get(name);
		if (dense) return dense;
	}
	return PIECES[name];
}

/** A piece's size in logical pixels: a 2x piece is half its texels. */
export function uiArtSize(name: UiArtName): { width: number; height: number } {
	return artSize(PIECES[name]);
}

export interface DrawUiArtOptions {
	/** The 1x name; the 2x raster is picked by the frame's device pixel ratio. */
	name: UiArtName;
	rect: Rect;
	/** A `surface` piece takes its paper colour, an `ink` piece its ink; a `none` piece draws as baked. */
	tint?: RGBA;
	id?: string;
}

/**
 * Draws a piece from the resident UI art page, nine-sliced when it has insets
 * (R5.19, R5.20), from its 2x raster when the ratio is above 1. When the page
 * is not resident a paper piece draws as a flat rect of its paper colour, so
 * ink laid on it still lands on paper rather than the table; marks and icons
 * draw nothing. Returns whether the art itself was drawn.
 */
export function drawUiArt(draw: DrawApi, { name, rect, tint, id }: DrawUiArtOptions): boolean {
	const piece = uiArtPiece(name, draw.devicePixelScale);
	const texture = draw.artAtlas(UI_ART_ATLAS);
	if (!texture) {
		const ground = piece.tint === 'surface' ? tint ?? WHITE : GROUNDS.get(piece);
		if (ground) draw.drawRect({ id, rect, fill: ground });
		return false;
	}
	drawArt(draw, { texture, piece, rect, tint, id });
	return true;
}
