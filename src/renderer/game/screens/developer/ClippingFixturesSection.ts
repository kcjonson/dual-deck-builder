import { DeveloperSectionPanel } from './DeveloperSectionPanel';
import { Text } from '../../../engine/components/Text';
import type { DrawApi, RGBA, Rect } from '../../../engine/draw';
import { DrawFixture, fixtureHeading, fixtureLabel } from './DrawFixture';

const FIXTURE_TOP = 50;
const FIXTURE_HEIGHT = 450;

const WHITE: RGBA = [1, 1, 1, 1];
const INK: RGBA = [0.1, 0.11, 0.13, 1];
const PANEL: RGBA = [0.2, 0.22, 0.27, 1];
const OUTLINE: RGBA = [0.95, 0.8, 0.3, 1];
const CLEAR: RGBA = [0, 0, 0, 0];

/**
 * Chapter 4's gallery fixture (4.7), drawn through the draw API: nested rect
 * clips intersecting, a disjoint pair producing `empty`, a content offset
 * applied before a fixed clip, every primitive kind cut by one clip, and text
 * too long for its box.
 *
 * Four items of 4.7's list are not here, each because drawing it today would
 * make a wrong picture the golden. The rounded clip needs the per-draw SDF of
 * DDB-190 (a square clip would be baked in as correct); the snapped clip edge
 * under an animated offset needs R7.8a's clip snapping (DDB-188); the stencil
 * clip and the oriented clip for rotated containers are optional and not
 * implemented. The overflowing text field is drawn as the draw calls a field
 * makes, because the `Input` component does not clip its text yet (the
 * phase 5 TextInput, DDB-86).
 */
export class ClippingFixturesSection extends DeveloperSectionPanel {
	constructor(x: number, y: number, width: number) {
		super({ id: 'dev_section_clipping', x, y, width });

		const title = new Text('Clipping Fixtures', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		title.setPosition(0, 0);
		this.addChild(title);

		this.addChild(new DrawFixture({
			id: 'dev_fixture_clipping',
			x: 0,
			y: FIXTURE_TOP,
			width: this.innerWidth,
			height: FIXTURE_HEIGHT,
			paint: (draw) => {
				nested(draw, 0, 0);
				disjoint(draw, 0, 250);
				contentOffset(draw, 440, 0);
				everyPrimitive(draw, 880, 0);
				overflowingText(draw, 880, 250);
			},
		}));

		this.fitContentHeight(FIXTURE_TOP + FIXTURE_HEIGHT);
	}
}

function outline(draw: DrawApi, rect: Rect): void {
	draw.drawRect({ rect, fill: CLEAR, border: { color: OUTLINE, width: 1, position: 'outside' } });
}

function stripes(draw: DrawApi, area: Rect, colour: RGBA): void {
	for (let x = 0; x < area.width; x += 16) {
		draw.drawRect({ rect: { x: area.x + x, y: area.y, width: 8, height: area.height }, fill: colour });
	}
}

/** The inner clip reaches past the outer one; only their intersection shows the stripes. */
function nested(draw: DrawApi, left: number, top: number): void {
	fixtureHeading(draw, 'Nested clips intersect', left, top);
	const outer = { x: left + 20, y: top + 40, width: 240, height: 150 };
	const inner = { x: left + 150, y: top + 90, width: 230, height: 140 };
	const everything = { x: left, y: top + 24, width: 400, height: 220 };

	draw.pushClip(outer);
	draw.drawRect({ rect: everything, fill: PANEL });
	draw.pushClip(inner);
	stripes(draw, everything, [0.3, 0.75, 0.95, 1]);
	draw.popClip();
	draw.popClip();

	outline(draw, outer);
	outline(draw, inner);
	fixtureLabel(draw, { text: 'outer', box: { x: outer.x + 6, y: outer.y + 4, width: 80, height: 18 }, align: 'left' });
	fixtureLabel(draw, { text: 'inner', box: { x: inner.x + inner.width - 86, y: inner.y + inner.height - 22, width: 80, height: 18 }, align: 'right' });
}

/** Two clips that do not meet leave nothing to draw into (R4.2's `empty`). */
function disjoint(draw: DrawApi, left: number, top: number): void {
	fixtureHeading(draw, 'Disjoint clips are empty: the red fill draws nowhere', left, top);
	const first = { x: left + 20, y: top + 40, width: 160, height: 120 };
	const second = { x: left + 220, y: top + 40, width: 160, height: 120 };
	draw.pushClip(first);
	draw.pushClip(second);
	draw.drawRect({ rect: { x: left, y: top, width: 420, height: 200 }, fill: [0.9, 0.15, 0.15, 1] });
	draw.popClip();
	draw.popClip();
	outline(draw, first);
	outline(draw, second);
}

/**
 * A scroll viewport whose content is offset by -100 under a clip equal to its
 * bounds (R4.9 to R4.11): the clip stays put while a row at local y 150
 * renders 50 below the viewport's top.
 */
function contentOffset(draw: DrawApi, left: number, top: number): void {
	fixtureHeading(draw, 'Content offset -100 applied before a fixed clip', left, top);
	const viewport = { x: left, y: top + 40, width: 380, height: 180 };
	const rowHeight = 50;
	draw.drawRect({ rect: viewport, fill: PANEL });
	draw.pushClip(viewport);
	draw.pushTranslate(viewport.x, viewport.y - 100);
	for (let row = 0; row < 8; row++) {
		const rect = { x: 10, y: row * rowHeight + 2, width: viewport.width - 20, height: rowHeight - 4 };
		const highlight = row === 3;
		draw.drawRect({ rect, fill: highlight ? [0.9, 0.55, 0.2, 1] : [0.3, 0.5, 0.85, 1], radius: 4 });
		fixtureLabel(draw, { text: `local y ${row * rowHeight}`, box: rect, color: highlight ? INK : WHITE });
	}
	draw.popTransform();
	draw.popClip();
	outline(draw, viewport);
	fixtureLabel(draw, {
		text: 'local y 150 lands 50 below the top edge',
		box: { x: viewport.x, y: viewport.y + viewport.height + 8, width: viewport.width, height: 18 },
		color: [0.7, 0.72, 0.76, 1],
		align: 'left',
	});
}

/** Rects, shadows, gradients, circles, lines, polygons and text all stop at one clip edge. */
function everyPrimitive(draw: DrawApi, left: number, top: number): void {
	fixtureHeading(draw, 'Every primitive honours the clip', left, top);
	const clip = { x: left + 20, y: top + 50, width: 380, height: 150 };
	draw.drawRect({ rect: clip, fill: [0.14, 0.15, 0.18, 1] });
	draw.pushClip(clip);
	draw.drawRect({ rect: { x: left, y: top + 70, width: 90, height: 60 }, fill: [0.3, 0.5, 0.85, 1], radius: 10, shadow: { color: [0, 0, 0, 0.8], blur: 16 } });
	draw.drawRect({ rect: { x: left + 110, y: top + 30, width: 80, height: 90 }, gradient: [[0.95, 0.3, 0.2, 1], [0.95, 0.85, 0.2, 1], [0.2, 0.5, 0.95, 1], [0.25, 0.8, 0.4, 1]] });
	draw.drawCircle({ center: { x: left + 260, y: top + 50 }, radius: 44, fill: [0.9, 0.42, 0.2, 1], border: { color: WHITE, width: 3 } });
	draw.drawLine({ from: { x: left, y: top + 190 }, to: { x: left + 430, y: top + 150 }, color: WHITE, width: 3 });
	draw.drawPolygon({ points: [{ x: left + 330, y: top + 120 }, { x: left + 440, y: top + 160 }, { x: left + 350, y: top + 230 }], fill: [0.35, 0.75, 0.45, 1] });
	draw.drawText({ text: 'Text runs past the right edge of the clip', position: { x: left + 150, y: top + 180 }, font: 'body', size: 18, color: WHITE });
	draw.popClip();
	outline(draw, clip);
}

/** A field's text clipped by its box, and the same run with R6.14's clip and ellipsis. */
function overflowingText(draw: DrawApi, left: number, top: number): void {
	fixtureHeading(draw, 'Text longer than its box', left, top);
	const long = 'Scrap Hauler, Rust Runner and the Dustbowl Convoy';

	const field = { x: left + 20, y: top + 34, width: 300, height: 34 };
	draw.drawRect({ rect: field, fill: [0.12, 0.13, 0.16, 1], radius: 3, border: { color: [0.55, 0.6, 0.7, 1], width: 1 } });
	const inner = { x: field.x + 10, y: field.y, width: field.width - 20, height: field.height };
	draw.pushClip(inner);
	draw.drawText({ text: long, box: inner, font: 'body', size: 16, color: WHITE, align: 'left', verticalAlign: 'middle', wrap: 'none' });
	draw.popClip();
	fixtureLabel(draw, { text: 'field, clipped', box: { x: field.x + field.width + 10, y: field.y, width: 110, height: field.height }, color: [0.7, 0.72, 0.76, 1], align: 'left' });

	const clipped = { x: left + 30, y: top + 84, width: 280, height: 30 };
	draw.drawRect({ rect: clipped, fill: CLEAR, border: { color: [0.4, 0.42, 0.48, 1], width: 1, position: 'outside' } });
	draw.drawText({ text: long, box: clipped, font: 'body', size: 16, color: WHITE, align: 'left', verticalAlign: 'middle', wrap: 'none', overflow: 'clip' });
	fixtureLabel(draw, { text: "overflow 'clip'", box: { x: left + 330, y: clipped.y, width: 110, height: clipped.height }, color: [0.7, 0.72, 0.76, 1], align: 'left' });

	const ellipsis = { x: left + 30, y: top + 128, width: 280, height: 30 };
	draw.drawRect({ rect: ellipsis, fill: CLEAR, border: { color: [0.4, 0.42, 0.48, 1], width: 1, position: 'outside' } });
	draw.drawText({ text: long, box: ellipsis, font: 'body', size: 16, color: WHITE, align: 'left', verticalAlign: 'middle', wrap: 'none', overflow: 'ellipsis' });
	fixtureLabel(draw, { text: "overflow 'ellipsis'", box: { x: left + 330, y: ellipsis.y, width: 120, height: ellipsis.height }, color: [0.7, 0.72, 0.76, 1], align: 'left' });
}
