import { DeveloperSectionPanel, DeveloperSectionOptions } from './DeveloperSectionPanel';
import { FlowWrap } from '../../ui/FlowWrap';
import type { BlendMode, BorderPosition, BoxShadow, CornerRadii, DrawApi, RGBA, Rect, TextureHandle } from '../../../engine/draw';
import type { MountContext } from '../../../engine/components/MountContext';
import { DrawFixture, fixtureHeading, fixtureLabel } from './DrawFixture';

const BLUE: RGBA = [0.24, 0.44, 0.85, 1];
const SLATE: RGBA = [0.18, 0.2, 0.24, 1];
const AMBER: RGBA = [0.96, 0.78, 0.3, 1];
const WHITE: RGBA = [1, 1, 1, 1];
const INK: RGBA = [0.1, 0.11, 0.13, 1];

const PHOTO_WIDTH = 160;
const PHOTO_HEIGHT = 100;
/** A blend tile's photograph, and the pitch between them. */
const BLEND_WIDTH = PHOTO_WIDTH * 1.5;
const BLEND_HEIGHT = PHOTO_HEIGHT * 1.25;
const BLEND_PITCH = BLEND_WIDTH + 20;
const BLENDS_FIRST: readonly BlendMode[] = ['over', 'additive'];
const BLENDS_SECOND: readonly BlendMode[] = ['multiply', 'screen'];

const FRAME_SIZE = 24;
const FRAME_INSET = 8;
const FRAME_BAND: RGBA = [0.12, 0.13, 0.16, 1];
const FRAME_CENTRE: RGBA = [0.27, 0.3, 0.36, 1];

/** A border case's pitch; three positions to a tile. */
const BORDER_PITCH = 128;
const BORDER_POSITIONS: readonly BorderPosition[] = ['inside', 'center', 'outside'];

type Paint = (draw: DrawApi) => void;

interface Tile {
	name: string;
	/** The tile's pitch: its drawing and the room before the next tile. */
	width: number;
	paint: Paint;
}

interface Row {
	/** The row's pitch down to the next one. */
	height: number;
	tiles: Tile[];
}

/**
 * Chapter 5's visual fixture (5.10): corner radii, border widths in each
 * position, gradients including to transparent, shadows at blur 0, 8 and 24
 * with both spreads, a glow, bordered circles, 1 and 3 px lines, text over
 * every one of them, the four blend modes over a photograph, and a
 * nine-sliced image. The pixel tests in `tests/visual/web/uberShader.spec.ts`
 * check the same rules as numbers; this is the picture a person reviews.
 *
 * Each group is a fixture tile carrying its own pitch, five rows of them,
 * each row wrapping at the section's width. In the gallery every row fits on
 * one line, and the tiles land where the single drawing they replace put
 * them; at a narrow window the wide groups (borders, shadows, blends) break
 * between their cases.
 */
export class ShadingFixturesSection extends DeveloperSectionPanel {
	private photo: TextureHandle | null = null;
	private frame: TextureHandle | null = null;

	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_shading', title: 'Shading Fixtures', ...options });

		const rows: Row[] = [
			{ height: 120, tiles: [
				{ name: 'radii', width: 700, paint: radii },
				{ name: 'circles', width: 380, paint: circles },
			] },
			{ height: 120, tiles: [1, 2, 6].map((width, index) => ({
				name: `borders_${width}`,
				width: BORDER_PITCH * BORDER_POSITIONS.length,
				paint: (draw: DrawApi) => borders(draw, width, index === 0),
			})) },
			{ height: 132, tiles: [
				{ name: 'gradients', width: 720, paint: gradients },
				{ name: 'lines', width: 380, paint: lines },
			] },
			{ height: 144, tiles: [
				{ name: 'shadows', width: 840, paint: shadows },
				{ name: 'glows', width: 420, paint: glows },
			] },
			{ height: 164, tiles: [
				{ name: 'blends_over', width: BLEND_PITCH * 2, paint: (draw) => blends(draw, BLENDS_FIRST, true, this.photo) },
				{ name: 'blends_multiply', width: BLEND_PITCH * 2, paint: (draw) => blends(draw, BLENDS_SECOND, false, this.photo) },
				{ name: 'nine_slice', width: 260, paint: (draw) => nineSlices(draw, this.frame) },
			] },
		];
		rows.forEach(({ height, tiles }, index) => {
			const row = new FlowWrap({ id: `dev_fixture_shading_row_${index}`, widthMode: 'fill' });
			for (const { name, width, paint } of tiles) {
				row.addChild(new DrawFixture({ id: `dev_fixture_shading_${name}`, width, height, paint }));
			}
			this.addChild(row);
		});
	}

	/**
	 * The photo is a GPU resource, so it is made on mount and never in the
	 * constructor (R8.14). Mount runs outside any frame (R2.17); the texture
	 * uploads through the metered queue at the next beginFrame, and the photo
	 * row draws a placeholder until then.
	 */
	protected onMount(context: MountContext): void {
		super.onMount(context);
		this.photo = context.draw.createTexture({ width: PHOTO_WIDTH, height: PHOTO_HEIGHT, label: 'shading fixture photo', source: photograph() });
		this.frame = context.draw.createTexture({ width: FRAME_SIZE, height: FRAME_SIZE, label: 'shading fixture frame', source: panelFrame() });
	}

	protected onUnmount(): void {
		if (this.photo) this.context?.draw.destroyTexture(this.photo);
		if (this.frame) this.context?.draw.destroyTexture(this.frame);
		this.photo = null;
		this.frame = null;
		super.onUnmount();
	}
}

function radii(draw: DrawApi): void {
	fixtureHeading(draw, 'Corner radius 0, 4, 12, over half the height, per corner', 0, 0);
	const cases: { radius: CornerRadii; label: string }[] = [
		{ radius: 0, label: '0' },
		{ radius: 4, label: '4' },
		{ radius: 12, label: '12' },
		{ radius: 60, label: '60, clamped' },
		{ radius: [0, 28, 8, 36], label: '0 28 8 36' },
	];
	cases.forEach(({ radius, label }, index) => {
		const box = { x: index * 134, y: 26, width: 120, height: 72 };
		draw.drawRect({ rect: box, fill: BLUE, radius });
		fixtureLabel(draw, { text: label, box });
	});
}

function circles(draw: DrawApi): void {
	fixtureHeading(draw, 'Circles with inside, center and outside borders', 0, 0);
	BORDER_POSITIONS.forEach((position, index) => {
		const center = { x: 40 + index * 100, y: 62 };
		draw.drawCircle({ center, radius: 32, fill: [0.9, 0.42, 0.2, 1], border: { color: WHITE, width: 4, position } });
		fixtureLabel(draw, { text: position, box: { x: center.x - 32, y: center.y - 10, width: 64, height: 20 } });
	});
}

/** One border width in each position; the first tile carries the group's heading. */
function borders(draw: DrawApi, width: number, heading: boolean): void {
	if (heading) fixtureHeading(draw, 'Borders 1, 2 and 6 px, inside, center and outside', 0, 0);
	BORDER_POSITIONS.forEach((position, index) => {
		const box = { x: 6 + index * BORDER_PITCH, y: 32, width: 110, height: 62 };
		draw.drawRect({ rect: box, fill: SLATE, border: { color: AMBER, width, position } });
		fixtureLabel(draw, { text: `${width} ${position}`, box });
	});
}

function checker(draw: DrawApi, x: number, y: number, width: number, height: number): void {
	const cell = 8;
	draw.drawRect({ rect: { x, y, width, height }, fill: [0.55, 0.55, 0.55, 1] });
	for (let row = 0; row * cell < height; row++) {
		for (let column = row % 2; column * cell < width; column += 2) {
			draw.drawRect({
				rect: { x: x + column * cell, y: y + row * cell, width: Math.min(cell, width - column * cell), height: Math.min(cell, height - row * cell) },
				fill: [0.85, 0.85, 0.85, 1],
			});
		}
	}
}

function gradients(draw: DrawApi): void {
	fixtureHeading(draw, 'Gradients: to transparent over a checker, four corners, radius', 0, 0);
	const red: RGBA = [0.9, 0.1, 0.1, 1];
	const clearRed: RGBA = [0.9, 0.1, 0.1, 0];
	const white: RGBA = [1, 1, 1, 1];
	const clearWhite: RGBA = [1, 1, 1, 0];
	const y = 26;

	const first = { x: 0, y, width: 150, height: 90 };
	checker(draw, first.x, first.y, first.width, first.height);
	draw.drawRect({ rect: first, gradient: [red, red, clearRed, clearRed] });
	fixtureLabel(draw, { text: 'red to clear', box: first, color: INK });

	const second = { x: 166, y, width: 150, height: 90 };
	checker(draw, second.x, second.y, second.width, second.height);
	draw.drawRect({ rect: second, gradient: [white, clearWhite, clearWhite, white] });
	fixtureLabel(draw, { text: 'white to clear', box: second, color: INK });

	const third = { x: 332, y, width: 150, height: 90 };
	draw.drawRect({ rect: third, gradient: [[0.95, 0.3, 0.2, 1], [0.95, 0.85, 0.2, 1], [0.2, 0.5, 0.95, 1], [0.25, 0.8, 0.4, 1]] });
	fixtureLabel(draw, { text: 'four corners', box: third, color: INK });

	const fourth = { x: 498, y, width: 150, height: 90 };
	draw.drawRect({
		rect: fourth,
		radius: 20,
		gradient: [[0.35, 0.2, 0.6, 1], [0.35, 0.2, 0.6, 1], [0.1, 0.1, 0.25, 1], [0.1, 0.1, 0.25, 1]],
		border: { color: [0.7, 0.6, 0.95, 1], width: 2 },
	});
	fixtureLabel(draw, { text: 'rounded, bordered', box: fourth });
}

function lines(draw: DrawApi): void {
	fixtureHeading(draw, 'Lines 1 and 3 px, butt and round caps', 0, 0);
	const y = 36;
	draw.drawLine({ from: { x: 0, y }, to: { x: 200, y }, color: WHITE, width: 1 });
	draw.drawLine({ from: { x: 0, y: y + 20 }, to: { x: 200, y: y + 20 }, color: WHITE, width: 3 });
	draw.drawLine({ from: { x: 6, y: y + 42 }, to: { x: 194, y: y + 42 }, color: AMBER, width: 3, cap: 'round' });
	draw.drawLine({ from: { x: 230, y }, to: { x: 330, y: y + 70 }, color: WHITE, width: 1 });
	draw.drawLine({ from: { x: 260, y }, to: { x: 360, y: y + 70 }, color: WHITE, width: 3 });
	fixtureLabel(draw, { text: 'text over lines', box: { x: 220, y: y + 20, width: 160, height: 20 } });
}

function shadows(draw: DrawApi): void {
	fixtureHeading(draw, 'Shadows: blur 0, 8, 24; spread 8 and -8; glows', 0, 0);
	const y = 26;
	// A light strip, so a dark shadow has something to fall on.
	draw.drawRect({ rect: { x: 0, y, width: 820, height: 110 }, fill: [0.82, 0.84, 0.86, 1] });
	const cases: { shadow: BoxShadow; label: string }[] = [
		{ shadow: { color: [0, 0, 0, 0.6], blur: 0, offset: { x: 6, y: 6 } }, label: 'blur 0' },
		{ shadow: { color: [0, 0, 0, 0.6], blur: 8, offset: { x: 0, y: 4 } }, label: 'blur 8' },
		{ shadow: { color: [0, 0, 0, 0.6], blur: 24, offset: { x: 0, y: 8 } }, label: 'blur 24' },
		{ shadow: { color: [0, 0, 0, 0.5], blur: 8, spread: 8 }, label: 'spread 8' },
		{ shadow: { color: [0, 0, 0, 0.7], blur: 24, spread: -8, offset: { x: 0, y: 14 } }, label: 'spread -8' },
	];
	cases.forEach(({ shadow, label }, index) => {
		const box = { x: 30 + index * 158, y: y + 24, width: 110, height: 60 };
		draw.drawRect({ rect: box, fill: [0.98, 0.98, 0.98, 1], radius: 6, shadow });
		fixtureLabel(draw, { text: label, box, color: INK });
	});
}

/**
 * Glows on a dark ground: a coloured shadow with no offset, and the same one
 * added rather than composited. Under the shadows' heading, which names them.
 */
function glows(draw: DrawApi): void {
	const y = 26;
	draw.drawRect({ rect: { x: 0, y, width: 420, height: 110 }, fill: [0.06, 0.07, 0.09, 1] });
	const cases: { blend: BlendMode; label: string }[] = [
		{ blend: 'over', label: 'glow' },
		{ blend: 'additive', label: 'additive glow' },
	];
	cases.forEach(({ blend, label }, index) => {
		const box = { x: 40 + index * 200, y: y + 30, width: 140, height: 50 };
		draw.drawRect({ rect: box, fill: [0.12, 0.14, 0.18, 1], radius: 10, shadow: { color: [0.25, 0.85, 1, 0.9], blur: 18, spread: 3 }, blend });
		fixtureLabel(draw, { text: label, box });
	});
}

/** Two of the blend modes; the first tile carries the group's heading. */
function blends(draw: DrawApi, modes: readonly BlendMode[], heading: boolean, photo: TextureHandle | null): void {
	if (heading) fixtureHeading(draw, 'Blend modes over a photograph: over, additive, multiply, screen', 0, 0);
	modes.forEach((blend, index) => {
		const rect = { x: index * BLEND_PITCH, y: 26, width: BLEND_WIDTH, height: BLEND_HEIGHT };
		if (photo && draw.isTextureResident(photo)) {
			draw.drawImage({ rect, texture: photo });
		} else {
			draw.drawRect({ rect, fill: SLATE });
		}
		// The swatch covers the right half, so each tile shows the photo with
		// and without it.
		const swatch = { x: rect.x + BLEND_WIDTH / 2, y: rect.y, width: BLEND_WIDTH / 2, height: BLEND_HEIGHT };
		draw.drawRect({ rect: swatch, fill: [0.95, 0.45, 0.2, 0.75], blend });
		draw.drawText({
			text: blend,
			box: { x: rect.x + 8, y: rect.y + 6, width: BLEND_WIDTH - 16, height: 20 },
			font: 'body',
			size: 14,
			color: WHITE,
			shadow: { color: [0, 0, 0, 0.8], offset: { x: 0, y: 1 }, blur: 2 },
			align: 'left',
			verticalAlign: 'top',
		});
	});
}

function nineSlices(draw: DrawApi, frame: TextureHandle | null): void {
	fixtureHeading(draw, 'Nine-slice: 24 px frame, 8 px insets', 0, 0);
	const slice = { top: FRAME_INSET, right: FRAME_INSET, bottom: FRAME_INSET, left: FRAME_INSET };
	const cases: { rect: Rect; label?: string; sliced: boolean }[] = [
		// The source at one to one, for reference.
		{ rect: { x: 0, y: 30, width: FRAME_SIZE, height: FRAME_SIZE }, sliced: false },
		{ rect: { x: 36, y: 26, width: 180, height: 52 }, label: 'sliced', sliced: true },
		// The same frame stretched without a slice: its corners go oval.
		{ rect: { x: 0, y: 88, width: 100, height: 40 }, label: 'stretched', sliced: false },
		// Shorter than two corners, so every corner scales by 12 / 16.
		{ rect: { x: 116, y: 102, width: 100, height: 12 }, sliced: true },
	];
	for (const { rect, label, sliced } of cases) {
		if (frame && draw.isTextureResident(frame)) {
			draw.drawImage({ rect, texture: frame, slice: sliced ? slice : undefined });
		} else {
			draw.drawRect({ rect, fill: SLATE });
		}
		if (label) fixtureLabel(draw, { text: label, box: rect });
	}
}


/**
 * Panel art for the nine-slice row, premultiplied: a rounded amber rim with a
 * dark keyline, a rivet in each corner, a dark band out to the inset line and
 * a lighter centre inside it. The rounded outline and the round rivets are
 * what a stretched corner visibly squashes; the colour step at the inset line
 * is what filtering across a cell edge would smear into a ramp.
 * Generated, like the photograph, so the golden cannot drift with a codec.
 */
function panelFrame(): Uint8Array {
	const texels = new Uint8Array(FRAME_SIZE * FRAME_SIZE * 4);
	const half = FRAME_SIZE / 2;
	const outerRadius = 7;
	const rivets = [5.5, FRAME_SIZE - 5.5];
	for (let y = 0; y < FRAME_SIZE; y++) {
		for (let x = 0; x < FRAME_SIZE; x++) {
			const px = x + 0.5;
			const py = y + 0.5;
			// Signed distance to the rounded outline, negative inside.
			const qx = Math.abs(px - half) - (half - outerRadius);
			const qy = Math.abs(py - half) - (half - outerRadius);
			const distance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - outerRadius;
			const coverage = Math.min(1, Math.max(0, 0.5 - distance));
			const centre = x >= FRAME_INSET && x < FRAME_SIZE - FRAME_INSET && y >= FRAME_INSET && y < FRAME_SIZE - FRAME_INSET;
			let color: RGBA = distance > -3 ? AMBER : distance > -4 ? INK : centre ? FRAME_CENTRE : FRAME_BAND;
			for (const rx of rivets) {
				for (const ry of rivets) {
					if (Math.hypot(px - rx, py - ry) < 1.8) color = [0.86, 0.88, 0.92, 1];
				}
			}
			const offset = (y * FRAME_SIZE + x) * 4;
			texels[offset] = Math.round(color[0] * coverage * 255);
			texels[offset + 1] = Math.round(color[1] * coverage * 255);
			texels[offset + 2] = Math.round(color[2] * coverage * 255);
			texels[offset + 3] = Math.round(coverage * 255);
		}
	}
	return texels;
}

/**
 * A synthetic landscape standing in for a photograph: continuous tone, bright
 * and dark regions and saturated colour, so each blend mode reads differently
 * across it. Generated rather than committed, and deterministic, so the golden
 * cannot drift with an image codec.
 */
function photograph(): Uint8Array {
	const texels = new Uint8Array(PHOTO_WIDTH * PHOTO_HEIGHT * 4);
	const sun = { x: 112, y: 34, radius: 14 };
	for (let y = 0; y < PHOTO_HEIGHT; y++) {
		for (let x = 0; x < PHOTO_WIDTH; x++) {
			const t = y / PHOTO_HEIGHT;
			// Sky: deep blue at the top warming to orange at the horizon.
			let r = 0.1 + 0.85 * t;
			let g = 0.2 + 0.4 * t;
			let b = 0.55 - 0.35 * t;
			const sunDistance = Math.hypot(x - sun.x, y - sun.y);
			if (sunDistance < sun.radius) {
				r = 1;
				g = 0.93;
				b = 0.7;
			} else {
				const halo = Math.max(0, 1 - (sunDistance - sun.radius) / 30) * 0.35;
				r += halo;
				g += halo * 0.8;
			}
			const far = 62 + 10 * Math.sin(x * 0.07) + 4 * Math.sin(x * 0.23);
			const near = 78 + 8 * Math.sin(x * 0.045 + 1.3) + 3 * Math.sin(x * 0.31);
			if (y > near) {
				const shade = 0.6 + 0.4 * ((x * 7 + y * 13) % 17) / 17;
				r = 0.12 * shade;
				g = 0.35 * shade;
				b = 0.12 * shade;
			} else if (y > far) {
				r = 0.28;
				g = 0.3;
				b = 0.42;
			}
			const offset = (y * PHOTO_WIDTH + x) * 4;
			texels[offset] = Math.round(Math.min(1, r) * 255);
			texels[offset + 1] = Math.round(Math.min(1, g) * 255);
			texels[offset + 2] = Math.round(Math.min(1, b) * 255);
			texels[offset + 3] = 255;
		}
	}
	return texels;
}
