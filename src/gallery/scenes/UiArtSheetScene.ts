import { Screen } from '../../renderer/game/core/Screen';
import { Text } from '../../renderer/engine/components/Text';
import type { DrawApi, Mat2D, RGBA, Rect } from '../../renderer/engine/draw';
import { resolveColor } from '../../renderer/engine/style/styleObject';
import { DrawFixture } from '../../renderer/game/screens/developer/DrawFixture';
import { drawUiArt, uiArtSize } from '../../renderer/game/art/uiArt';

const TABLE = resolveColor('#24211C');
const SHEET = resolveColor('#EEE7D2');
const PAPER = resolveColor('#F4EEDD');
const INK = resolveColor('#23221F');
const INK_DIM = resolveColor('#5D5A52');
const CLEAR: RGBA = [0, 0, 0, 0];
/** The spec's 14 px of table around the sheet (Palette, `sheet_margin`). */
const MARGIN = 14;
const GUTTER = 72;
const BOX_WIDTH = 380;
const BOX_TOP = 150;
const BOX_HEIGHT = 240;
const BOX_PADDING = 18;

function tape(draw: DrawApi, x: number, y: number, name: 'tape_a' | 'tape_b'): void {
	const radians = (-38 * Math.PI) / 180;
	const matrix: Mat2D = [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), x, y];
	const { width, height } = uiArtSize(name);
	draw.pushTransform(matrix);
	drawUiArt(draw, { name, rect: { x: -width / 2, y: -height / 2, width, height } });
	draw.popTransform();
}

function outline(draw: DrawApi, rect: Rect, width: number): void {
	draw.drawRect({ rect, fill: CLEAR, border: { color: INK, width } });
}

/**
 * The screen sheet whole (spec, Components; DDB-504): one W2 sheet on the
 * table with the 14 px margin, the double neatline, a fold, tape at two
 * opposite corners, and a W1 legend box with its labels. It is the main use
 * of the paper pieces and the one that stretches an edge slice furthest,
 * about ten times at 1440x900, and at a ratio of 2 it draws the 2x rasters.
 */
export class UiArtSheetScreen extends Screen {
	private sheet: DrawFixture | null = null;
	private box: DrawFixture | null = null;

	constructor() {
		super('uiArtSheetScene');
	}

	protected onMount(): void {
		// Nested rather than siblings: the labels sit on the box, the box and
		// the title on the sheet, the way the lint reads a page.
		this.sheet = new DrawFixture({ id: 'ui_art_sheet', width: 1, height: 1, paint: (draw) => this.paintSheet(draw) });
		this.box = new DrawFixture({ id: 'ui_art_sheet_needs', width: BOX_WIDTH, height: BOX_HEIGHT, paint: paintBox });
		this.box.addChild(new Text({ id: 'ui_art_sheet_needs_head', text: 'NEEDS', x: BOX_PADDING, y: 16, style: { fontRole: 'display', fontSize: 20, color: INK }, wrap: 'none' }));
		this.box.addChild(new Text({
			id: 'ui_art_sheet_needs_body',
			text: 'Water and food run out in 2 days. The bunkhouse sleeps three; the radio mast is staked out but unbuilt.',
			x: BOX_PADDING,
			y: 52,
			width: BOX_WIDTH - BOX_PADDING * 2,
			style: { fontRole: 'body', fontSize: 15, color: INK },
		}));
		this.sheet.addChild(new Text({ id: 'ui_art_sheet_title', text: 'THE COMPOUND', x: GUTTER, y: 64, style: { fontRole: 'display', fontSize: 34, color: INK }, wrap: 'none' }));
		this.sheet.addChild(new Text({ id: 'ui_art_sheet_subtitle', text: 'day 9, dawn', x: GUTTER, y: 106, style: { fontRole: 'body', fontSize: 15, color: INK_DIM }, wrap: 'none' }));
		this.sheet.addChild(this.box);
		this.root.addChild(this.sheet);
		this.place();
	}

	protected onResized(): void {
		this.place();
	}

	private place(): void {
		const { width, height } = this.root;
		this.sheet?.setSize(width, height);
		this.box?.setPosition(width - GUTTER - BOX_WIDTH, BOX_TOP);
	}

	private paintSheet(draw: DrawApi): void {
		const { width, height } = this.root;
		draw.drawRect({ rect: { x: 0, y: 0, width, height }, fill: TABLE });
		drawUiArt(draw, { name: 'paper_w2_a', rect: { x: MARGIN, y: MARGIN, width: width - MARGIN * 2, height: height - MARGIN * 2 }, tint: SHEET });
		drawUiArt(draw, { name: 'paper_fold', rect: { x: Math.round(width * 0.62), y: MARGIN, width: 22, height: height - MARGIN * 2 } });
		for (const [inset, line] of [[22, 0.6], [30, 1.6]]) {
			const edge = MARGIN + inset;
			outline(draw, { x: edge, y: edge, width: width - edge * 2, height: height - edge * 2 }, line);
		}
		tape(draw, MARGIN + 18, MARGIN + 14, 'tape_a');
		tape(draw, width - MARGIN - 18, height - MARGIN - 14, 'tape_b');
	}
}

function paintBox(draw: DrawApi): void {
	const rect = { x: 0, y: 0, width: BOX_WIDTH, height: BOX_HEIGHT };
	drawUiArt(draw, { name: 'paper_w1_a', rect, tint: PAPER });
	outline(draw, rect, 1.4);
}
