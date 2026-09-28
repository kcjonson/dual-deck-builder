import { DeveloperSectionPanel } from './DeveloperSectionPanel';
import { Component, ComponentOptions } from '../../../engine/components/Component';
import { Container } from '../../../engine/components/Container';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import type { BoxShadow, DrawApi, RGBA } from '../../../engine/draw';
import { shadowInk } from '../../../engine/draw/bounds';

const TITLE_HEIGHT = 50;
/** Room below the columns for the scroller's menu, which hangs out of its clip by design. */
const FIXTURE_HEIGHT = 520;
const COLUMN_WIDTH = 420;
const COLUMN_GAP = 40;
const GROUP_GAP = 24;
const HEADING_GAP = 8;

const WHITE: RGBA = [1, 1, 1, 1];
const INK: RGBA = [0.1, 0.11, 0.13, 1];
const HEADING: RGBA = [0.75, 0.78, 0.82, 1];
const CAPTION: RGBA = [0.7, 0.72, 0.76, 1];
const PANEL: RGBA = [0.2, 0.22, 0.27, 1];
const ROW: RGBA = [0.27, 0.3, 0.36, 1];
const ROW_ALT: RGBA = [0.23, 0.25, 0.3, 1];
const FIELD: RGBA = [0.12, 0.13, 0.16, 1];
const CARD_BORDER = { color: [0, 0, 0, 0.5] as RGBA, width: 1 };
const MENU_SHADOW: BoxShadow = { color: [0, 0, 0, 0.6], blur: 12, offset: { x: 0, y: 4 } };

const LAYER_COLOURS: Record<'base' | 'modal' | 'popup' | 'toast' | 'tooltip', RGBA> = {
	base: [0.3, 0.5, 0.85, 1],
	modal: [0.45, 0.4, 0.7, 1],
	popup: [0.9, 0.55, 0.2, 1],
	toast: [0.35, 0.72, 0.4, 1],
	tooltip: [0.95, 0.9, 0.55, 1],
};

interface FixtureBoxOptions extends ComponentOptions {
	fill: RGBA;
	radius?: number;
	border?: { color: RGBA; width: number };
	shadow?: BoxShadow;
	label?: string;
	labelColor?: RGBA;
	/** `left` insets the label into the top-left corner, as a card's title; `center` fills the box. */
	labelAlign?: 'left' | 'center';
	labelSize?: number;
}

/**
 * A filled box with an optional shadow and a Text label child: the fixture's
 * one shape. Its own draw is the box, so the shadow is emitted immediately
 * before it (R3.16), and its label and any children paint after it (R3.11).
 */
class FixtureBox extends Component {
	private readonly fill: RGBA;
	private readonly radius: number | undefined;
	private readonly border: { color: RGBA; width: number } | undefined;
	private readonly shadow: BoxShadow | undefined;

	constructor({ fill, radius, border, shadow, label, labelColor = WHITE, labelAlign = 'center', labelSize = 13, ...options }: FixtureBoxOptions) {
		super(options);
		this.componentType = 'FixtureBox';
		this.fill = fill;
		this.radius = radius;
		this.border = border;
		this.shadow = shadow;
		if (label === undefined) return;
		const inset = labelAlign === 'left' ? 8 : 0;
		this.addChild(new Text(label, {
			x: inset,
			y: labelAlign === 'left' ? 4 : 0,
			width: this.width - inset * 2,
			height: labelAlign === 'left' ? 20 : this.height,
			style: { fontSize: labelSize, color: (labelColor), textAlign: labelAlign },
			verticalAlign: 'middle',
		}));
	}

	/** The draw layer's own shadow bound, so the subtree cull (R4.2a) never drops a visible shadow. */
	public get inkExtent(): number {
		const shadow = this.shadow;
		if (!shadow) return 0;
		const ink = shadowInk({ x: 0, y: 0, width: this.width, height: this.height }, shadow);
		return Math.max(0, -ink.x, -ink.y, ink.x + ink.width - this.width, ink.y + ink.height - this.height);
	}

	public render(draw: DrawApi): void {
		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: this.fill,
			radius: this.radius,
			border: this.border,
			shadow: this.shadow,
		});
	}
}

/** Stripes and dots in its own draws, so nothing under the shadow is a sibling of the panel. */
class BusyGround extends Component {
	constructor(options: ComponentOptions) {
		super(options);
		this.componentType = 'BusyGround';
	}

	public render(draw: DrawApi): void {
		draw.drawRect({ id: this.id ?? undefined, rect: { x: 0, y: 0, width: this.width, height: this.height }, fill: [0.85, 0.8, 0.7, 1] });
		for (let stripe = 0; stripe < 14; stripe++) {
			draw.drawRect({ rect: { x: stripe * 30, y: 0, width: 15, height: this.height }, fill: [0.75, 0.3, 0.25, 1] });
		}
		for (let dot = 0; dot < 8; dot++) {
			draw.drawCircle({ center: { x: 26 + dot * 52, y: dot % 2 === 0 ? 40 : 140 }, radius: 16, fill: [0.15, 0.4, 0.6, 1] });
		}
	}
}

/** A label; given a height, it is centred in it, as the fixture's row and item labels are. */
function text(content: string, color: RGBA, size: number, options: ComponentOptions = {}): Text {
	const verticalAlign = options.height !== undefined ? 'middle' : 'top';
	return new Text(content, { ...options, style: { fontSize: size, color }, verticalAlign });
}

/** A card whose colour names the layer it asks for (R3.5). */
function layerCard(layer: keyof typeof LAYER_COLOURS, options: ComponentOptions, label: string = layer): FixtureBox {
	return new FixtureBox({
		...options,
		layer,
		fill: LAYER_COLOURS[layer],
		radius: 6,
		border: CARD_BORDER,
		label,
		labelColor: INK,
		labelAlign: 'left',
	});
}

/** A heading over a fixed-size body the caller fills. */
function group(id: string, heading: string, bodyHeight: number, fill: (body: Container) => void): Stack {
	const column = new Stack({ id, gap: HEADING_GAP });
	column.addChild(text(heading, HEADING, 15));
	const body = new Container({ id: `${id}_body`, width: COLUMN_WIDTH, height: bodyHeight });
	fill(body);
	column.addChild(body);
	return column;
}

/**
 * Chapter 3's gallery fixture (3.12, R13.31), built from components so what it
 * proves is the tree's ordering: `renderTree` walks each parent's children in
 * `renderOrder`, stable-sorted by `zIndex` (R3.12, R3.13), and a component's
 * `layer` lifts its subtree to the higher of its own and its parent's (R3.6),
 * resetting the inherited clip when that raises it (R3.8, R4.8). Every
 * arrangement is inserted in an order chosen to be wrong, so only those two
 * keys can put it right on screen.
 *
 * Overlap between siblings is always declared: a different layer or a
 * different `zIndex`, which is R13.25.1's exemption, so the scene stays inside
 * the lint gate. That is also why it has no pair of overlapping siblings at
 * equal `zIndex`, the insertion-order tie-break: the lint reports exactly that
 * pair, and the tie-break is pinned by renderTree's and Component's tests.
 */
export class PaintOrderFixturesSection extends DeveloperSectionPanel {
	constructor(x: number, y: number, width: number) {
		super({ id: 'dev_section_paint_order', x, y, width });

		this.addChild(new Text('Paint Order Fixtures', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		}));

		const columns = new Stack({ id: 'dev_paint_order_columns', y: TITLE_HEIGHT, direction: 'horizontal', gap: COLUMN_GAP });
		const first = new Stack({ gap: GROUP_GAP });
		first.addChild(group('dev_paint_order_layers', 'Layer beats insertion order', 190, layerLadder));
		first.addChild(group('dev_paint_order_zindex', 'One layer: zIndex beats insertion order', 208, zIndexLadder));
		const second = new Stack({ gap: GROUP_GAP });
		second.addChild(group('dev_paint_order_shadow', 'A shadowed panel over a busy background', 180, shadowOverBusyGround));
		second.addChild(group('dev_paint_order_scroller', 'A popup declared inside a scroll container', 180, popupInScroller));
		columns.addChild(first);
		columns.addChild(second);
		columns.addChild(group('dev_paint_order_modal', 'Modal, open select menu, toast and tooltip', 440, modalStack));
		this.addChild(columns);

		this.fitContentHeight(TITLE_HEIGHT + FIXTURE_HEIGHT);
	}
}

/** The same three cards inserted top-down and bottom-up come out identical. */
function layerLadder(body: Container): void {
	const ladders: { order: ('base' | 'popup' | 'tooltip')[]; caption: string }[] = [
		{ order: ['tooltip', 'popup', 'base'], caption: 'inserted top first' },
		{ order: ['base', 'popup', 'tooltip'], caption: 'inserted base first' },
	];
	const steps = { base: 0, popup: 1, tooltip: 2 };
	ladders.forEach(({ order, caption }, index) => {
		const column = new Container({ x: index * 220, width: 200, height: 190 });
		column.addChild(text(caption, CAPTION, 12));
		for (const layer of order) {
			const step = steps[layer];
			column.addChild(layerCard(layer, { id: `dev_po_layers_${index}_${layer}`, x: step * 28, y: 24 + step * 38, width: 140, height: 90 }));
		}
		body.addChild(column);
	});
}

/**
 * Siblings at zIndex -1, 0, 1 and 2, inserted ascending and descending: the
 * sorted render view puts both columns back in the same order (R3.12).
 */
function zIndexLadder(body: Container): void {
	const ladders: { order: number[]; caption: string }[] = [
		{ order: [-1, 0, 1, 2], caption: 'inserted z -1 first' },
		{ order: [2, 1, 0, -1], caption: 'inserted z 2 first' },
	];
	ladders.forEach(({ order, caption }, index) => {
		const column = new Container({ x: index * 220, width: 200, height: 208 });
		column.addChild(text(caption, CAPTION, 12));
		for (const zIndex of order) {
			const step = zIndex + 1;
			column.addChild(new FixtureBox({
				id: `dev_po_z_${index}_${zIndex}`,
				x: step * 22,
				y: 24 + step * 34,
				width: 130,
				height: 80,
				zIndex,
				fill: LAYER_COLOURS.base,
				radius: 6,
				border: CARD_BORDER,
				label: `z ${zIndex}`,
				labelColor: WHITE,
				labelAlign: 'left',
			}));
		}
		body.addChild(column);
	});
}

/** The panel is the ground's child, so it paints after the stripes, its shadow first (R3.16). */
function shadowOverBusyGround(body: Container): void {
	const ground = new BusyGround({ id: 'dev_po_ground', width: COLUMN_WIDTH, height: 180 });
	ground.addChild(new FixtureBox({
		id: 'dev_po_shadowed',
		x: 70,
		y: 40,
		width: 280,
		height: 100,
		fill: PANEL,
		radius: 10,
		shadow: { color: [0, 0, 0, 0.7], blur: 24, offset: { x: 0, y: 10 } },
		label: 'Shadow is under its panel',
	}));
	body.addChild(ground);
}

/**
 * A select in a clipping scroll container's fourth row opens a menu declared
 * as its own child with `layer: 'popup'`. Promotion paints it above the rows
 * inserted after it and resets the scroller's clip, so it hangs out of the
 * viewport (R3.8, R4.8).
 */
function popupInScroller(body: Container): void {
	const rowHeight = 30;
	const scroller = new ScrollContainer({
		id: 'dev_paint_order_scroll',
		width: COLUMN_WIDTH,
		height: 180,
		style: { backgroundColor: (PANEL) },
	});
	const rows = new Container({ id: 'dev_paint_order_rows', width: COLUMN_WIDTH, height: rowHeight * 6 });
	for (let row = 0; row < 6; row++) {
		const rowBox = new FixtureBox({
			id: `dev_po_row_${row + 1}`,
			y: row * rowHeight,
			width: COLUMN_WIDTH,
			height: rowHeight,
			fill: row % 2 === 0 ? ROW : ROW_ALT,
		});
		rowBox.addChild(text(`Row ${row + 1}`, WHITE, 13, { x: 12, width: 120, height: rowHeight }));
		if (row === 3) {
			const select = new FixtureBox({
				id: 'dev_po_scroll_select',
				x: 180,
				y: 4,
				width: 200,
				height: rowHeight - 8,
				fill: FIELD,
				radius: 4,
				border: { color: [0.55, 0.6, 0.7, 1], width: 1 },
				label: 'Select: open',
			});
			select.addChild(menu({ id: 'dev_po_scroll_menu', y: rowHeight - 8, width: 200, height: 150 }, 'Option', 5));
			rowBox.addChild(select);
		}
		rows.addChild(rowBox);
	}
	scroller.addChild(rows);
	body.addChild(scroller);
}

/**
 * The layer ladder in one place, inserted top of the ladder first: tooltip,
 * toast, then the modal, then the screen under it all. The modal's select
 * inherits `modal`, and its menu is its child raised to popup.
 *
 * No child here asks for a layer below its ancestor's. R3.6 clamps it to the
 * ancestor's, and also makes it an authoring error a development build
 * reports, which the gallery's clean-console gate would fail; renderTree's
 * tests cover the clamp.
 */
function modalStack(body: Container): void {
	const dialog = { x: 50, y: 60, width: 320, height: 190 };
	const select = { x: 30, y: 70, width: 260, height: 30 };
	// Menus hang flush from their selects: rule 2 lets a raised child off only while it touches its parent.
	const menuTop = select.height;
	const menuHeight = 210;
	const menuLeft = dialog.x + select.x;
	const menuY = dialog.y + select.y + menuTop;

	body.addChild(layerCard('tooltip', { id: 'dev_po_tooltip', x: menuLeft + 150, y: menuY + 170, width: 150, height: 44 }));
	body.addChild(layerCard('toast', { id: 'dev_po_toast', x: 20, y: 440 - 90, width: 380, height: 70 }));

	const modal = new Container({ id: 'dev_paint_order_modal_layer', width: COLUMN_WIDTH, height: 440, layer: 'modal' });
	modal.addChild(new Rectangle({ id: 'dev_po_scrim', width: COLUMN_WIDTH, height: 440, style: { backgroundColor: [0, 0, 0, 0.55] } }));
	const dialogBox = new FixtureBox({
		...dialog,
		id: 'dev_po_dialog',
		zIndex: 1,
		fill: LAYER_COLOURS.modal,
		radius: 8,
		shadow: { color: [0, 0, 0, 0.7], blur: 24, offset: { x: 0, y: 8 } },
	});
	dialogBox.addChild(text('modal dialog', INK, 13, { x: 16, y: 10, width: 200, height: 24 }));
	const selectBox = new FixtureBox({
		...select,
		id: 'dev_po_modal_select',
		fill: FIELD,
		radius: 4,
		border: { color: [0.8, 0.8, 0.9, 1], width: 1 },
		label: 'Select: open',
	});
	selectBox.addChild(menu({ id: 'dev_po_modal_menu', y: menuTop, width: select.width, height: menuHeight }, 'Menu item', 7));
	dialogBox.addChild(selectBox);
	modal.addChild(dialogBox);
	body.addChild(modal);

	const screen = new FixtureBox({ id: 'dev_paint_order_screen', width: COLUMN_WIDTH, height: 440, fill: PANEL });
	for (let row = 0; row < 8; row++) {
		screen.addChild(new FixtureBox({
			id: `dev_po_base_${row + 1}`,
			x: 16,
			y: 16 + row * 50,
			width: COLUMN_WIDTH - 32,
			height: 40,
			fill: LAYER_COLOURS.base,
			radius: 4,
			label: `base content ${row + 1}`,
		}));
	}
	body.addChild(screen);
}

function menu(box: { id: string; y: number; width: number; height: number }, itemLabel: string, items: number): FixtureBox {
	const popup = new FixtureBox({ ...box, layer: 'popup', fill: LAYER_COLOURS.popup, radius: 4, shadow: MENU_SHADOW });
	for (let item = 0; item < items; item++) {
		popup.addChild(text(`${itemLabel} ${item + 1}`, INK, 13, { x: 10, y: item * 30, width: box.width - 20, height: 30 }));
	}
	return popup;
}
