import { Panel } from '../../../engine/ui/Panel';
import { Text } from '../../../engine/components/Text';
import type { DrawApi, LayerName, RGBA, Rect } from '../../../engine/draw';
import { DrawFixture, fixtureHeading, fixtureLabel } from './DrawFixture';

const FIXTURE_TOP = 50;
const FIXTURE_HEIGHT = 520;

const WHITE: RGBA = [1, 1, 1, 1];
const INK: RGBA = [0.1, 0.11, 0.13, 1];
const PANEL: RGBA = [0.2, 0.22, 0.27, 1];
const ROW: RGBA = [0.27, 0.3, 0.36, 1];
const ROW_ALT: RGBA = [0.23, 0.25, 0.3, 1];

const LAYER_COLOURS: Partial<Record<LayerName, RGBA>> = {
	base: [0.3, 0.5, 0.85, 1],
	raised: [0.3, 0.7, 0.55, 1],
	modal: [0.45, 0.4, 0.7, 1],
	popup: [0.9, 0.55, 0.2, 1],
	toast: [0.35, 0.72, 0.4, 1],
	tooltip: [0.95, 0.9, 0.55, 1],
};

/**
 * Chapter 3's gallery fixture (3.12, R13.31), drawn through the draw API.
 * Every group below is submitted in an order chosen to be wrong, so the only
 * thing that can put it right on screen is the layer ordinal (R3.10, R3.14)
 * and, inside one layer, submission order.
 *
 * The spec's version of this fixture stacks components by `zIndex` and
 * declares the popup inside a real scroll container. Components have no
 * `zIndex` and no layer promotion until phase 3's component base (DDB-73), so
 * the same arrangements are written here as the tree walk will emit them:
 * sibling order inside a layer, and a promoted subtree as `pushLayer` plus
 * `pushClipReset` (R3.8, R4.8).
 */
export class PaintOrderFixturesSection extends Panel {
	constructor(x: number, y: number, width: number) {
		super({
			id: 'dev_section_paint_order',
			width,
			height: FIXTURE_TOP + FIXTURE_HEIGHT,
			style: {
				backgroundColor: 'transparent',
			},
		});
		this.setPosition(x, y);

		const title = new Text('Paint Order Fixtures', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		title.setPosition(0, 0);
		this.addChild(title);

		this.addChild(new DrawFixture({
			id: 'dev_fixture_paint_order',
			x: 0,
			y: FIXTURE_TOP,
			width,
			height: FIXTURE_HEIGHT,
			paint: (draw) => {
				ladder(draw, 0, 0);
				sameLayer(draw, 0, 250);
				shadowOverBusyGround(draw, 460, 0);
				popupInScroller(draw, 460, 240);
				modalStack(draw, 920, 0);
			},
		}));

		this.setSize(width, FIXTURE_TOP + FIXTURE_HEIGHT);
	}
}

function card(draw: DrawApi, layer: LayerName, rect: Rect, text: string): void {
	draw.pushLayer(layer);
	draw.drawRect({ rect, fill: LAYER_COLOURS[layer] ?? WHITE, radius: 6, border: { color: [0, 0, 0, 0.5], width: 1 } });
	fixtureLabel(draw, { text, box: { x: rect.x + 8, y: rect.y + 4, width: rect.width - 16, height: 20 }, color: INK, align: 'left' });
	draw.popLayer();
}

/** The same three cards submitted top-down and bottom-up come out identical. */
function ladder(draw: DrawApi, left: number, top: number): void {
	fixtureHeading(draw, 'Layer beats submission order', left, top);
	const stacks: { order: LayerName[]; caption: string }[] = [
		{ order: ['tooltip', 'popup', 'base'], caption: 'submitted top first' },
		{ order: ['base', 'popup', 'tooltip'], caption: 'submitted base first' },
	];
	const offsets: Partial<Record<LayerName, number>> = { base: 0, popup: 1, tooltip: 2 };
	stacks.forEach(({ order, caption }, index) => {
		const x = left + index * 220;
		draw.drawText({ text: caption, box: { x, y: top + 24, width: 200, height: 18 }, font: 'body', size: 12, color: [0.7, 0.72, 0.76, 1], align: 'left', verticalAlign: 'top' });
		for (const layer of order) {
			const step = offsets[layer] ?? 0;
			card(draw, layer, { x: x + step * 28, y: top + 48 + step * 38, width: 140, height: 90 }, layer);
		}
	});
}

/** Inside one layer submission order is the only key: the later sibling is on top. */
function sameLayer(draw: DrawApi, left: number, top: number): void {
	fixtureHeading(draw, 'One layer: submission order decides', left, top);
	const columns: { order: number[]; caption: string }[] = [
		{ order: [0, 1, 2, 3], caption: 'submitted 1 to 4' },
		{ order: [3, 2, 1, 0], caption: 'submitted 4 to 1' },
	];
	columns.forEach(({ order, caption }, index) => {
		const x = left + index * 220;
		draw.drawText({ text: caption, box: { x, y: top + 24, width: 200, height: 18 }, font: 'body', size: 12, color: [0.7, 0.72, 0.76, 1], align: 'left', verticalAlign: 'top' });
		for (const step of order) {
			card(draw, 'base', { x: x + step * 22, y: top + 48 + step * 34, width: 130, height: 80 }, `${step + 1}`);
		}
	});
}

function shadowOverBusyGround(draw: DrawApi, left: number, top: number): void {
	fixtureHeading(draw, 'A shadowed panel over a busy background', left, top);
	const ground = { x: left, y: top + 28, width: 420, height: 180 };
	draw.drawRect({ rect: ground, fill: [0.85, 0.8, 0.7, 1] });
	for (let stripe = 0; stripe < 14; stripe++) {
		draw.drawRect({ rect: { x: ground.x + stripe * 30, y: ground.y, width: 15, height: ground.height }, fill: [0.75, 0.3, 0.25, 1] });
	}
	for (let dot = 0; dot < 8; dot++) {
		draw.drawCircle({ center: { x: ground.x + 26 + dot * 52, y: ground.y + (dot % 2 === 0 ? 40 : 140) }, radius: 16, fill: [0.15, 0.4, 0.6, 1] });
	}
	const panel = { x: ground.x + 70, y: ground.y + 40, width: 280, height: 100 };
	draw.drawRect({ rect: panel, fill: PANEL, radius: 10, shadow: { color: [0, 0, 0, 0.7], blur: 24, offset: { x: 0, y: 10 } } });
	fixtureLabel(draw, { text: 'Shadow is under its panel', box: panel });
}

/**
 * A select inside a clipped scroll region opens a menu declared at its row;
 * promotion lifts it above the rows drawn after it and out of the clip.
 */
function popupInScroller(draw: DrawApi, left: number, top: number): void {
	fixtureHeading(draw, 'A popup declared inside a scroll container', left, top);
	const viewport = { x: left, y: top + 28, width: 420, height: 180 };
	const contentOffset = -45;
	const rowHeight = 30;
	draw.drawRect({ rect: viewport, fill: PANEL });
	draw.pushClip(viewport);
	draw.pushTranslate(viewport.x, viewport.y + contentOffset);
	for (let row = 0; row < 12; row++) {
		const rect = { x: 0, y: row * rowHeight, width: viewport.width, height: rowHeight };
		draw.drawRect({ rect, fill: row % 2 === 0 ? ROW : ROW_ALT });
		fixtureLabel(draw, { text: `Row ${row + 1}`, box: { x: 12, y: rect.y, width: 120, height: rowHeight }, align: 'left' });
		if (row === 3) {
			const select = { x: 180, y: rect.y + 4, width: 200, height: rowHeight - 8 };
			draw.drawRect({ rect: select, fill: [0.12, 0.13, 0.16, 1], radius: 4, border: { color: [0.55, 0.6, 0.7, 1], width: 1 } });
			fixtureLabel(draw, { text: 'Select: open', box: select });
			draw.pushLayer('popup');
			draw.pushClipReset();
			const menu = { x: select.x, y: select.y + select.height + 2, width: select.width, height: 150 };
			draw.drawRect({ rect: menu, fill: LAYER_COLOURS.popup ?? WHITE, radius: 4, shadow: { color: [0, 0, 0, 0.6], blur: 12, offset: { x: 0, y: 4 } } });
			for (let item = 0; item < 5; item++) {
				fixtureLabel(draw, { text: `Option ${item + 1}`, box: { x: menu.x + 10, y: menu.y + item * 30, width: menu.width - 20, height: 30 }, color: INK, align: 'left' });
			}
			draw.popClip();
			draw.popLayer();
		}
	}
	draw.popTransform();
	draw.popClip();
}

/**
 * A modal over a small screen, with a select in it whose menu is open, a
 * toast, and a tooltip over the menu. Submitted top of the ladder first.
 */
function modalStack(draw: DrawApi, left: number, top: number): void {
	fixtureHeading(draw, 'Modal, open select menu, toast and tooltip', left, top);
	const screen = { x: left, y: top + 28, width: 420, height: 440 };
	const dialog = { x: screen.x + 50, y: screen.y + 60, width: 320, height: 190 };
	const select = { x: dialog.x + 30, y: dialog.y + 70, width: 260, height: 30 };
	const menu = { x: select.x, y: select.y + select.height + 2, width: select.width, height: 210 };

	card(draw, 'tooltip', { x: menu.x + 150, y: menu.y + 170, width: 150, height: 44 }, 'tooltip');
	card(draw, 'toast', { x: screen.x + 20, y: screen.y + screen.height - 90, width: screen.width - 40, height: 70 }, 'toast');

	draw.pushLayer('popup');
	draw.drawRect({ rect: menu, fill: LAYER_COLOURS.popup ?? WHITE, radius: 4, shadow: { color: [0, 0, 0, 0.6], blur: 12, offset: { x: 0, y: 4 } } });
	for (let item = 0; item < 7; item++) {
		fixtureLabel(draw, { text: `Menu item ${item + 1}`, box: { x: menu.x + 10, y: menu.y + item * 30, width: menu.width - 20, height: 30 }, color: INK, align: 'left' });
	}
	draw.popLayer();

	draw.pushLayer('modal');
	draw.drawRect({ rect: screen, fill: [0, 0, 0, 0.55] });
	draw.drawRect({ rect: dialog, fill: LAYER_COLOURS.modal ?? WHITE, radius: 8, shadow: { color: [0, 0, 0, 0.7], blur: 24, offset: { x: 0, y: 8 } } });
	fixtureLabel(draw, { text: 'modal dialog', box: { x: dialog.x + 16, y: dialog.y + 10, width: 200, height: 24 }, color: INK, align: 'left' });
	draw.drawRect({ rect: select, fill: [0.12, 0.13, 0.16, 1], radius: 4, border: { color: [0.8, 0.8, 0.9, 1], width: 1 } });
	fixtureLabel(draw, { text: 'Select: open', box: select });
	draw.popLayer();

	// The screen under it all, submitted last.
	draw.drawRect({ rect: screen, fill: PANEL });
	for (let row = 0; row < 8; row++) {
		const rect = { x: screen.x + 16, y: screen.y + 16 + row * 50, width: screen.width - 32, height: 40 };
		draw.drawRect({ rect, fill: LAYER_COLOURS.base ?? WHITE, radius: 4 });
		fixtureLabel(draw, { text: `base content ${row + 1}`, box: rect });
	}
}
