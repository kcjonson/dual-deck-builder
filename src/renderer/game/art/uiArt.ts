import uiArtImageUrl from '../../../assets/ui-art/ui-art.png';
import { ArtAtlasImage, ArtPiece, artSize, drawArt, loadArtAtlasImage } from '../../engine/draw/artAtlas';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { RGBA, Rect } from '../../engine/draw/geometry';
import { UI_ART_MANIFEST, UiArtName } from './uiArtManifest';

export type { UiArtName };

/** The name the UI art page is resident under (`DrawApi.artAtlas`). */
export const UI_ART_ATLAS = 'ui';

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

export function uiArtPiece(name: UiArtName): ArtPiece {
	return UI_ART_MANIFEST.pieces[name];
}

/** A piece's size in logical pixels: a 2x piece is half its texels. */
export function uiArtSize(name: UiArtName): { width: number; height: number } {
	return artSize(UI_ART_MANIFEST.pieces[name]);
}

export interface DrawUiArtOptions {
	name: UiArtName;
	rect: Rect;
	/** A `surface` piece takes its paper colour, an `ink` piece its ink; a `none` piece draws as baked. */
	tint?: RGBA;
	id?: string;
}

/**
 * Draws a piece from the resident UI art page, nine-sliced when it has insets
 * (R5.19, R5.20). Returns false and draws nothing when the page did not load,
 * so a screen without its art still works.
 */
export function drawUiArt(draw: DrawApi, { name, rect, tint, id }: DrawUiArtOptions): boolean {
	const texture = draw.artAtlas(UI_ART_ATLAS);
	if (!texture) return false;
	drawArt(draw, { texture, piece: UI_ART_MANIFEST.pieces[name], rect, tint, id });
	return true;
}
