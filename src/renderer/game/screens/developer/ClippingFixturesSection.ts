import { DeveloperSectionPanel, DeveloperSectionOptions } from './DeveloperSectionPanel';
import { FlowWrap } from '../../ui/FlowWrap';
import { TextInput } from '../../../engine/ui/TextInput';
import type { DrawApi, RGBA, Rect } from '../../../engine/draw';
import { DrawFixture, fixtureHeading, fixtureLabel } from './DrawFixture';

/**
 * A cell's pitch; each draws in the first 400 by 250 or so of it, so the
 * cells sit edge to edge, three to a row in the gallery.
 */
const CELL_WIDTH = 440;
const CELL_HEIGHT = 250;

const WHITE: RGBA = [1, 1, 1, 1];
const INK: RGBA = [0.1, 0.11, 0.13, 1];
const PANEL: RGBA = [0.2, 0.22, 0.27, 1];
const OUTLINE: RGBA = [0.95, 0.8, 0.3, 1];
const CLEAR: RGBA = [0, 0, 0, 0];
const LONG_TEXT = 'Scrap Hauler, Rust Runner and the Dustbowl Convoy';
/** Where the overflowing field sits in its fixture cell. */
const FIELD = { x: 20, y: 34, width: 300, height: 34 };

type Cell = (draw: DrawApi, left: number, top: number) => void;

/**
 * Chapter 4's gallery fixture (4.7), drawn through the draw API: nested rect
 * clips intersecting, a disjoint pair producing `empty`, a content offset
 * applied before a fixed clip, a clip edge that agrees with its content as a
 * viewport slides by fractions of a pixel (R7.8a), every primitive kind cut
 * by one clip, text too long for its box, and R4.14's rounded clip: every
 * primitive cut at its corners, a square scroll clip inside a rounded one,
 * and a circular avatar mask.
 *
 * Each case is a fixture cell of its own, and the cells wrap at the section's
 * width: three to a row in the gallery, two in the developer screen at a
 * narrow window.
 *
 * Nested rounded clips are not here: the draw API's once-a-frame warning for
 * them is a console error in the gallery, and the pixel half of that case is
 * in `tests/visual/web/uberShader.spec.ts`. The stencil clip and the oriented
 * clip for rotated containers are optional and not implemented.
 * The overflowing text field is the real TextInput (R12.10), laid over its
 * cell where the drawing leaves room for it: its value is scrolled to the
 * caret at the end and clipped to the padded box on both sides.
 */
export class ClippingFixturesSection extends DeveloperSectionPanel {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_clipping', title: 'Clipping Fixtures', ...options });

		const cells = new FlowWrap({ id: 'dev_fixture_clipping', widthMode: 'fill' });
		for (const { name, paint } of CELLS) {
			const cell = new DrawFixture({
				id: `dev_fixture_clipping_${name}`,
				width: CELL_WIDTH,
				height: CELL_HEIGHT,
				paint: (draw) => paint(draw, 0, 0),
			});
			// Inside the cell it draws in, so it is part of the picture rather than a sibling over it.
			if (paint === overflowingText) {
				cell.addChild(new TextInput({ id: 'dev_fixture_clipping_field', value: LONG_TEXT, ...FIELD }));
			}
			cells.addChild(cell);
		}
		this.addChild(cells);
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

/**
 * 4.7's animated content offset with a snapped clip edge, as four frames of a
 * viewport sliding by a quarter pixel a frame while its content scrolls. Each
 * frame outlines the viewport with a hairline, which R7.8 puts on the device
 * grid, and fills it with content cut by the viewport's clip.
 *
 * What the golden proves is that the clip and the content agree on where the
 * edge is in every frame, including the one at x.5. R4.4 keeps a pixel by its
 * centre, which breaks the x.5 tie the other way from `round`: unsnapped, that
 * frame's clip would keep the column left of the outline's inner edge (over
 * the outline) and drop the last column inside it (a dark gap), and the frames
 * either side would not. Snapped at push (R7.8a), the content meets the
 * outline on all four sides in all four frames.
 */
function snappedClipEdge(draw: DrawApi, left: number, top: number): void {
	fixtureHeading(draw, 'Clip and content edges agree as a viewport slides', left, top);
	const frames = [0, 0.25, 0.5, 0.75];
	for (let index = 0; index < frames.length; index++) {
		const slide = frames[index];
		const scroll = index * 7.3;
		const viewport = { x: left + index * 96 + slide, y: top + 40 + slide, width: 80, height: 120 };
		draw.drawRect({ rect: viewport, fill: CLEAR, border: { color: OUTLINE, width: 1, position: 'outside' } });
		draw.pushClip(viewport);
		draw.pushTranslate(viewport.x, viewport.y - scroll);
		for (let row = 0; row < 8; row++) {
			const colour: RGBA = row % 2 === 0 ? [0.3, 0.5, 0.85, 1] : [0.9, 0.55, 0.2, 1];
			draw.drawRect({ rect: { x: -10, y: row * 20, width: 100, height: 20 }, fill: colour });
		}
		draw.popTransform();
		draw.popClip();
		fixtureLabel(draw, {
			text: `x +${slide}, scroll ${scroll.toFixed(1)}`,
			box: { x: viewport.x, y: viewport.y + viewport.height + 6, width: viewport.width, height: 18 },
			color: [0.7, 0.72, 0.76, 1],
		});
	}
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

/**
 * A field's text clipped by its box (the TextInput the section lays over
 * `FIELD`), and the same run with R6.14's clip and ellipsis.
 */
function overflowingText(draw: DrawApi, left: number, top: number): void {
	fixtureHeading(draw, 'Text longer than its box', left, top);
	const long = LONG_TEXT;

	const field = { x: left + FIELD.x, y: top + FIELD.y, width: FIELD.width, height: FIELD.height };
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

/** R4.14: every primitive kind cut at a rounded clip's corners, and only there. */
function roundedClip(draw: DrawApi, left: number, top: number): void {
	fixtureHeading(draw, 'A rounded clip cuts every primitive at its corners', left, top);
	const clip = { x: left + 20, y: top + 34, width: 360, height: 150 };
	const radius = 28;
	draw.pushClipRounded(clip, radius);
	draw.drawRect({ rect: { x: left, y: top + 20, width: 400, height: 180 }, fill: PANEL });
	stripes(draw, { x: left, y: top + 20, width: 120, height: 180 }, [0.3, 0.75, 0.95, 1]);
	draw.drawCircle({ center: { x: clip.x + clip.width - 10, y: clip.y + 10 }, radius: 48, fill: [0.9, 0.42, 0.2, 1], border: { color: WHITE, width: 3 } });
	draw.drawRect({
		rect: { x: clip.x + 150, y: clip.y + clip.height - 50, width: 240, height: 70 },
		gradient: [[0.95, 0.85, 0.2, 1], [0.95, 0.3, 0.2, 1], [0.25, 0.8, 0.4, 1], [0.2, 0.5, 0.95, 1]],
	});
	draw.drawLine({ from: { x: left, y: top + 200 }, to: { x: left + 400, y: top + 20 }, color: WHITE, width: 3 });
	draw.drawText({ text: 'Text runs into the corner', position: { x: clip.x - 30, y: clip.y + clip.height - 6 }, font: 'body', size: 18, color: WHITE });
	draw.popClip();
	draw.drawRect({ rect: clip, fill: CLEAR, radius, border: { color: OUTLINE, width: 1, position: 'outside' } });
}

/**
 * A rounded panel with a square scroll clip inside it, the shape of a
 * scrolling list in a rounded container: the inner clip keeps the outer
 * radius (R4.14 carries the innermost rounded clip through plain ones), so
 * rows scrolled into the corners are cut round.
 */
function squareInsideRounded(draw: DrawApi, left: number, top: number): void {
	fixtureHeading(draw, 'A square scroll clip inside a rounded one keeps its corners', left, top);
	const panel = { x: left, y: top + 34, width: 380, height: 150 };
	const viewport = { x: panel.x, y: panel.y + 30, width: panel.width, height: panel.height - 30 };
	const rowHeight = 40;
	draw.pushClipRounded(panel, 20);
	draw.drawRect({ rect: panel, fill: PANEL });
	fixtureLabel(draw, { text: 'header, outside the scroll clip', box: { x: panel.x + 16, y: panel.y, width: panel.width - 32, height: 30 }, color: [0.7, 0.72, 0.76, 1], align: 'left' });
	draw.pushClip(viewport);
	draw.pushTranslate(viewport.x, viewport.y - 25);
	for (let row = 0; row < 5; row++) {
		const colour: RGBA = row % 2 === 0 ? [0.3, 0.5, 0.85, 1] : [0.9, 0.55, 0.2, 1];
		const rect = { x: 0, y: row * rowHeight, width: viewport.width, height: rowHeight };
		draw.drawRect({ rect, fill: colour });
		fixtureLabel(draw, { text: `row ${row}`, box: rect, color: row % 2 === 0 ? WHITE : INK });
	}
	draw.popTransform();
	draw.popClip();
	draw.popClip();
	draw.drawRect({ rect: panel, fill: CLEAR, radius: 20, border: { color: OUTLINE, width: 1, position: 'outside' } });
}

/**
 * A radius of half the size makes the clip a circle, the avatar mask R4.14
 * names; a radius past half the height clamps to a capsule (R5.5).
 */
function avatarMask(draw: DrawApi, left: number, top: number): void {
	fixtureHeading(draw, 'A circular mask and a clamped capsule', left, top);
	const avatar = { x: left + 20, y: top + 40, width: 140, height: 140 };
	draw.pushClipRounded(avatar, 70);
	draw.drawRect({ rect: avatar, gradient: [[0.95, 0.3, 0.2, 1], [0.95, 0.85, 0.2, 1], [0.2, 0.5, 0.95, 1], [0.25, 0.8, 0.4, 1]] });
	stripes(draw, { x: avatar.x, y: avatar.y + 90, width: avatar.width, height: 50 }, [0.1, 0.11, 0.13, 0.7]);
	fixtureLabel(draw, { text: 'avatar', box: { x: avatar.x, y: avatar.y + 20, width: avatar.width, height: 30 }, color: INK, size: 18 });
	draw.popClip();

	const capsule = { x: left + 190, y: top + 80, width: 200, height: 60 };
	draw.pushClipRounded(capsule, 100);
	draw.drawRect({ rect: capsule, fill: PANEL });
	stripes(draw, capsule, [0.3, 0.75, 0.95, 0.35]);
	fixtureLabel(draw, { text: 'radius 100, clamped to 30', box: capsule, color: WHITE });
	draw.popClip();
	fixtureLabel(draw, {
		text: 'no outline: the edge is the clip',
		box: { x: capsule.x, y: capsule.y + capsule.height + 8, width: capsule.width, height: 18 },
		color: [0.7, 0.72, 0.76, 1],
	});
}

/** In reading order. */
const CELLS: readonly { name: string; paint: Cell }[] = [
	{ name: 'nested', paint: nested },
	{ name: 'content_offset', paint: contentOffset },
	{ name: 'every_primitive', paint: everyPrimitive },
	{ name: 'disjoint', paint: disjoint },
	{ name: 'snapped_edge', paint: snappedClipEdge },
	{ name: 'overflowing_text', paint: overflowingText },
	{ name: 'rounded', paint: roundedClip },
	{ name: 'square_in_rounded', paint: squareInsideRounded },
	{ name: 'avatar_mask', paint: avatarMask },
];
