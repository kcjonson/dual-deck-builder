import { DeveloperSectionPanel, DeveloperSectionOptions } from './DeveloperSectionPanel';
import { FlowWrap } from '../../ui/FlowWrap';
import type { DrawApi, Mat2D, RGBA } from '../../../engine/draw';
import { resolveColor } from '../../../engine/style/styleObject';
import { DrawFixture, fixtureLabel } from './DrawFixture';
import { UiArtName, drawUiArt, uiArtSize } from '../../art/uiArt';

/** The spec's palette (UI Art Direction, Palette); the atlas theme's tokens are not built yet. */
const TABLE = resolveColor('#24211C');
const SHEET = resolveColor('#EEE7D2');
const PAPER = resolveColor('#F4EEDD');
const INK = resolveColor('#23221F');
const STRONGHOLD = resolveColor('#A3221B');
const CAPTION: RGBA = [0.85, 0.81, 0.72, 1];

const CAPTION_HEIGHT = 22;

type Paint = (draw: DrawApi) => void;

interface Tile {
	name: string;
	width: number;
	height: number;
	paint: Paint;
}

function caption(draw: DrawApi, text: string, x: number, y: number, width: number): void {
	fixtureLabel(draw, { text, box: { x, y, width, height: CAPTION_HEIGHT }, color: CAPTION, size: 12 });
}

/** A tile's ground: the table the sheet lies on. */
function table(draw: DrawApi, width: number, height: number): void {
	draw.drawRect({ rect: { x: 0, y: 0, width, height }, fill: TABLE });
}

function art(draw: DrawApi, name: UiArtName, x: number, y: number, width?: number, height?: number, tint?: RGBA): void {
	const size = uiArtSize(name);
	drawUiArt(draw, { name, rect: { x, y, width: width ?? size.width, height: height ?? size.height }, tint });
}

function rotated(draw: DrawApi, x: number, y: number, degrees: number, paint: Paint): void {
	const radians = (degrees * Math.PI) / 180;
	const matrix: Mat2D = [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), x, y];
	draw.pushTransform(matrix);
	paint(draw);
	draw.popTransform();
}

/** A row of pieces, each over its caption. */
function row(draw: DrawApi, names: readonly UiArtName[], { x, y, width, height, pitch, tint }: { x: number; y: number; width: number; height: number; pitch: number; tint?: RGBA }): void {
	names.forEach((name, index) => {
		art(draw, name, x + index * pitch, y, width, height, tint);
		caption(draw, name, x + index * pitch, y + height + 2, width);
	});
}

function buildTiles(section: DeveloperSectionPanel, prefix: string, rows: Tile[][]): void {
	rows.forEach((tiles, index) => {
		const flow = new FlowWrap({ id: `dev_fixture_${prefix}_row_${index}`, widthMode: 'fill', gap: 8 });
		for (const { name, width, height, paint } of tiles) {
			flow.addChild(new DrawFixture({
				id: `dev_fixture_${prefix}_${name}`,
				width,
				height,
				paint: (draw) => {
					table(draw, width, height);
					paint(draw);
				},
			}));
		}
		section.addChild(flow);
	});
}

/**
 * The UI art atlas's paper (DDB-504), drawn through the engine from the
 * resident page: W2 tinted Sheet and W1 tinted Paper, and W3 with its hero
 * marks. Each surface is at least as large as its piece, so the edge slices
 * stretch rather than squeeze, as they do on the screens W2 and W3 are for.
 */
export class UiArtPaperSection extends DeveloperSectionPanel {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_ui_art_paper', title: 'UI Art: Paper', ...options });
		buildTiles(this, 'ui_art_paper', [
			[
				...(['paper_w2_a', 'paper_w2_b', 'paper_w2_c'] as const).map((name) => paperTile(name, 300, SHEET)),
				{ name: 'w1', width: 336, height: 334, paint: (draw) => row(draw, ['paper_w1_a', 'paper_w1_b', 'paper_w1_c'], { x: 10, y: 10, width: 100, height: 300, pitch: 108, tint: PAPER }) },
			],
			[
				...(['paper_w3_a', 'paper_w3_b', 'paper_w3_c'] as const).map((name) => paperTile(name, 360, SHEET)),
			],
		]);
	}
}

/** One square paper piece a tile, so the row wraps on a narrow window rather than overflowing it. */
function paperTile(name: UiArtName, size: number, tint: RGBA): Tile {
	return { name, width: size + 20, height: size + 34, paint: (draw) => row(draw, [name], { x: 10, y: 10, width: size, height: size, pitch: 0, tint }) };
}

function paintSheet(draw: DrawApi): void {
	art(draw, 'paper_w2_a', 20, 16, 410, 290, SHEET);
	art(draw, 'paper_fold', 260, 16, 22, 290);
	draw.drawText({ text: 'Water plant, north', box: { x: 100, y: 150, width: 200, height: 22 }, font: 'display', size: 18, color: INK, align: 'left', verticalAlign: 'middle' });
	rotated(draw, 24, 20, -35, (inner) => art(inner, 'tape_a', -44, -14));
	rotated(draw, 426, 302, -35, (inner) => art(inner, 'tape_b', -52, -14));
	caption(draw, 'paper_w2_a, paper_fold, tape_a, tape_b', 10, 314, 360);
}

/**
 * The splash's pieces (DDB-504): the closed-atlas cover, each deck as a stack
 * of card edges under its back, the 2x backs, the resource strip's icons
 * tinted ink with the deck glyph beside them, and a W2 sheet with a fold, a
 * label, and tape pinned at two corners.
 */
export class UiArtCoverSection extends DeveloperSectionPanel {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_ui_art_cover', title: 'UI Art: Cover and Cards', ...options });
		buildTiles(this, 'ui_art_cover', [
			[
				{ name: 'cover', width: 540, height: 376, paint: paintCover },
				{ name: 'cards', width: 500, height: 376, paint: paintCards },
			],
			[
				{ name: 'sheet', width: 450, height: 340, paint: paintSheet },
			],
		]);
	}
}

function paintCover(draw: DrawApi): void {
	art(draw, 'atlas_cover', 10, 10, 520, 340);
	draw.drawText({ text: 'A ROAD ATLAS OF THE HALCYON REGION', box: { x: 60, y: 44, width: 420, height: 16 }, font: 'mono', size: 11, color: INK, align: 'center', verticalAlign: 'middle' });
	art(draw, 'logo', 81, 82, 385, 189);
	caption(draw, 'atlas_cover, logo at 0.55', 10, 352, 520);
}

function paintCards(draw: DrawApi): void {
	const deck = (x: number, y: number, top: UiArtName) => {
		for (let edge = 4; edge >= 1; edge--) art(draw, 'card_edge', x + edge * 2, y + edge * 2, 100, 140);
		art(draw, top, x, y, 100, 140);
	};
	deck(10, 10, 'card_back_a');
	deck(130, 10, 'card_back_b');
	art(draw, 'card_back_a_2x', 250, 10, 100, 140);
	art(draw, 'card_back_b_2x', 370, 10, 100, 140);
	caption(draw, 'card_back_a on edges', 0, 162, 125);
	caption(draw, 'card_back_b', 130, 162, 110);
	caption(draw, 'card_back_a_2x', 250, 162, 100);
	caption(draw, 'card_back_b_2x', 370, 162, 100);
	art(draw, 'paper_w1_a', 10, 200, 470, 120, PAPER);
	const icons: UiArtName[] = ['icon_food', 'icon_water', 'icon_fuel', 'icon_scrap', 'icon_meds', 'icon_people'];
	icons.forEach((name, index) => art(draw, name, 30 + index * 30, 222, 18, 18, name === 'icon_water' ? STRONGHOLD : INK));
	art(draw, 'icon_deck', 210, 222, 20, 18);
	icons.forEach((name, index) => art(draw, `${name}_2x` as UiArtName, 30 + index * 30, 262, 18, 18, INK));
	art(draw, 'icon_deck_2x', 210, 262, 20, 18);
	draw.drawText({ text: '1x', box: { x: 250, y: 222, width: 200, height: 18 }, font: 'mono', size: 11, color: INK, align: 'left', verticalAlign: 'middle' });
	draw.drawText({ text: '2x rasters drawn at 1x size', box: { x: 250, y: 262, width: 200, height: 18 }, font: 'mono', size: 11, color: INK, align: 'left', verticalAlign: 'middle' });
	caption(draw, 'icon_* tinted ink (water as a shortfall), icon_deck baked', 10, 322, 470);
	art(draw, 'tape_c', 10, 344);
	caption(draw, 'tape_c', 140, 347, 60);
}

/**
 * The atlas's hand and print marks (DDB-504): the logo and the small mark,
 * highlighter swipes stretched under a label (drawn before it, normal blend),
 * grease-pencil loops around a target, and the four stamps.
 */
export class UiArtMarksSection extends DeveloperSectionPanel {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_ui_art_marks', title: 'UI Art: Marks', ...options });
		buildTiles(this, 'ui_art_marks', [
			[
				{ name: 'logo', width: 740, height: 390, paint: paintLogo },
				{ name: 'marks', width: 250, height: 390, paint: paintMarks },
				{ name: 'highlights', width: 300, height: 390, paint: paintHighlights },
			],
			[
				{ name: 'loops', width: 500, height: 220, paint: paintLoops },
				{ name: 'stamps', width: 810, height: 220, paint: paintStamps },
			],
		]);
	}
}

function paintLogo(draw: DrawApi): void {
	art(draw, 'paper_w2_b', 10, 10, 720, 350, SHEET);
	art(draw, 'logo', 20, 14);
	caption(draw, 'logo on paper_w2_b', 10, 362, 720);
}

function paintMarks(draw: DrawApi): void {
	art(draw, 'paper_w1_b', 10, 10, 230, 350, PAPER);
	art(draw, 'mark', 34, 40);
	art(draw, 'mark_2x', 110, 40);
	art(draw, 'mark_2x', 34, 170, 48, 54);
	draw.drawText({ text: '2x at 1x size', box: { x: 94, y: 185, width: 140, height: 24 }, font: 'body', size: 12, color: INK, align: 'left', verticalAlign: 'middle' });
	caption(draw, 'mark, mark_2x', 10, 362, 230);
}

function paintHighlights(draw: DrawApi): void {
	art(draw, 'paper_w1_c', 10, 10, 280, 350, PAPER);
	const names: UiArtName[] = ['highlight_a', 'highlight_b', 'highlight_c', 'highlight_d'];
	const labels = ['Water plant, north', 'Clinic, west', 'The old depot on Route 9', 'Bunkhouse'];
	names.forEach((name, index) => {
		const y = 40 + index * 70;
		const width = 130 + labels[index].length * 5;
		art(draw, name, 26, y - 4, width, 30);
		draw.drawText({ text: labels[index], box: { x: 36, y, width: 240, height: 22 }, font: 'display', size: 18, color: INK, align: 'left', verticalAlign: 'middle' });
		draw.drawText({ text: name, box: { x: 36, y: y + 28, width: 240, height: 16 }, font: 'mono', size: 10, color: INK, align: 'left', verticalAlign: 'middle' });
	});
}

function paintLoops(draw: DrawApi): void {
	art(draw, 'paper_w2_c', 10, 10, 480, 200, SHEET);
	const names: UiArtName[] = ['loop_a', 'loop_b', 'loop_c', 'loop_d'];
	names.forEach((name, index) => {
		const x = 22 + index * 118;
		draw.drawCircle({ center: { x: x + 52, y: 100 }, radius: 14, fill: INK });
		art(draw, name, x, 62, 105, 76);
		draw.drawText({ text: name, box: { x, y: 146, width: 105, height: 16 }, font: 'mono', size: 10, color: INK, align: 'center', verticalAlign: 'middle' });
	});
}

function paintStamps(draw: DrawApi): void {
	art(draw, 'paper_w3_a', 10, 10, 790, 200, SHEET);
	const names: UiArtName[] = ['stamp_looted', 'stamp_depleted', 'stamp_recon', 'stamp_hostile'];
	// At 0.8 so all four share the tile; a screen strikes one at full size.
	let x = 24;
	for (const name of names) {
		const width = uiArtSize(name).width * 0.8;
		const height = uiArtSize(name).height * 0.8;
		art(draw, name, x, 100 - height / 2, width, height);
		draw.drawText({ text: name, box: { x, y: 152, width, height: 16 }, font: 'mono', size: 10, color: INK, align: 'center', verticalAlign: 'middle' });
		x += width + 12;
	}
}
