import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Rect } from '../../../engine/draw/geometry';
import { UiArtName, drawUiArt } from '../../art/uiArt';

export type { UiArtName };

/** The wear levels a surface can be printed at (UI Art Direction, Wear); W0 is flat paper and never art. */
export type AtlasWear = 1 | 2 | 3;
export type AtlasPaperVariant = 'a' | 'b' | 'c';

const PAPER: Readonly<Record<AtlasWear, Readonly<Record<AtlasPaperVariant, UiArtName>>>> = {
	1: { a: 'paper_w1_a', b: 'paper_w1_b', c: 'paper_w1_c' },
	2: { a: 'paper_w2_a', b: 'paper_w2_b', c: 'paper_w2_c' },
	3: { a: 'paper_w3_a', b: 'paper_w3_b', c: 'paper_w3_c' },
};

/**
 * The short side a surface needs before it takes W2 or W3: room for two of
 * the piece's corners and its edge between (96 px and 128 px insets, and
 * the spec's rule that small surfaces get no texture to speak of).
 */
export const WEAR_MIN_SIDE: Readonly<Record<2 | 3, number>> = { 2: 288, 3: 352 };

/** The paper piece for a surface of `wear` at the size of `rect`, dropping to W1 when it is too small for its level. */
export function paperPiece(wear: AtlasWear, rect: Rect, variant: AtlasPaperVariant = 'a'): UiArtName {
	const side = Math.min(rect.width, rect.height);
	const level: AtlasWear = wear === 3 && side >= WEAR_MIN_SIDE[3] ? 3 : wear >= 2 && side >= WEAR_MIN_SIDE[2] ? 2 : 1;
	return PAPER[level][variant];
}

export interface DrawAtlasArtOptions {
	name: UiArtName;
	rect: Rect;
	/** A surface's paper colour, or an ink piece's ink; baked pieces ignore it. */
	tint?: RGBA;
	id?: string;
}

/**
 * Every atlas part draws its baked art through here: the UI art atlas's
 * `drawUiArt`, which picks the 2x raster by the frame's device pixel ratio
 * and nine-slices what has insets. With the page not resident a surface is a
 * flat rect of its tint and anything else draws nothing; the return says
 * whether the art itself was drawn, so a part draws its own flat stand-in
 * for a mark, an icon, or card stock when it was not.
 */
export function drawAtlasArt(draw: DrawApi, options: DrawAtlasArtOptions): boolean {
	return drawUiArt(draw, options);
}
