import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Rect } from '../../../engine/draw/geometry';

/**
 * The baked pieces the atlas parts draw, by the names the UI art atlas
 * gives them (DDB-504). Surfaces are paper by wear level; the rest are
 * marks, icons, and card stock.
 */
export type AtlasSurface = 'paper_w1_a' | 'paper_w1_b' | 'paper_w1_c' | 'paper_w2_a' | 'paper_w2_b' | 'paper_w2_c';
export type AtlasPiece =
	| AtlasSurface
	| 'tape_a' | 'tape_b' | 'tape_c'
	| 'highlight_a' | 'highlight_b' | 'highlight_c' | 'highlight_d'
	| 'loop_a' | 'loop_b' | 'loop_c' | 'loop_d'
	| 'card_back_a' | 'card_back_b' | 'card_edge'
	| 'icon_deck' | 'icon_food' | 'icon_water' | 'icon_fuel' | 'icon_scrap' | 'icon_meds' | 'icon_people';

export interface DrawAtlasArtOptions {
	name: AtlasPiece;
	rect: Rect;
	/** A surface's paper colour, or an ink piece's ink. */
	tint?: RGBA;
	id?: string;
}

const SURFACES: ReadonlySet<AtlasPiece> = new Set<AtlasPiece>(['paper_w1_a', 'paper_w1_b', 'paper_w1_c', 'paper_w2_a', 'paper_w2_b', 'paper_w2_c']);

/**
 * Every atlas part draws its baked art through here and nowhere else, so the
 * switch to the UI art atlas is this one body: `return drawUiArt(draw, options)`.
 *
 * Until then it does what `drawUiArt` does with no page resident: a surface
 * is a flat rect of its tint, and anything else draws nothing. Returns
 * whether the art itself was drawn, so a part draws its own flat stand-in
 * for a mark, an icon, or card stock when it was not.
 */
export function drawAtlasArt(draw: DrawApi, { name, rect, tint, id }: DrawAtlasArtOptions): boolean {
	if (SURFACES.has(name) && tint) draw.drawRect({ id, rect, fill: tint });
	return false;
}
