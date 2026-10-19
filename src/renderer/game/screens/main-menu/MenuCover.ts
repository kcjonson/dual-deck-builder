import { Component, ComponentOptions } from '../../../engine/components/Component';
import { Text } from '../../../engine/components/Text';
import type { BoxShadow } from '../../../engine/draw/commands';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { Mat2D, RGBA, Rect, Vec2 } from '../../../engine/draw/geometry';
import { triangulatePolygon } from '../../../engine/draw/triangulate';
import type { Theme } from '../../../engine/theme/tokens';
import { Rng } from '../../core/Rng';
import { uiArtSize } from '../../art/uiArt';
import { drawAtlasArt } from '../../ui/atlas/atlasArt';
import { ATLAS, AtlasInks, atlasInks } from '../../ui/atlas/atlasStyle';
import { GlyphPaint, MapGlyphGeometry, glyphPaint } from '../../ui/atlas/mapGlyphs';
import { LAND_COLOURS, ROAD_STYLES, Rgb8 } from '../../ui/areaMap/areaMapStyle';

/**
 * The cover's own space, the menu canvas's (FinalMenu.dc.html: the cover's
 * 640 by 840 view box, its top moved to 0). Every shape is built here once
 * and mapped onto the cover's rect at layout, so the map stretches with the
 * window and a frame draws it as is.
 */
const W = 640;
const H = 840;
/** The canvas's y runs from -24; shapes below are given in its numbers and moved down by this. */
const Y0 = 24;

/**
 * How far the torn sheet runs past the cover's box: nearly the sheet's full
 * height, a few pixels inside its top and bottom edges, so it lies over the
 * neatline the way the canvas's does. The box is the page's left column,
 * which sits `SLOT_INSET` inside the sheet.
 */
const SLOT_INSET = ATLAS.neatlineInset + ATLAS.neatlineGap + ATLAS.sheetPadding;
const BLEED = { top: SLOT_INSET - 4, bottom: SLOT_INSET - 8, left: 6, right: 12 } as const;

/** The canvas's -0.8 degree turn. */
const TILT = (-0.8 * Math.PI) / 180;

/** The torn edge: segments per side, how deep its small bites go, and the grime band inside it (W2: 6% of the short side). */
const TEAR = { across: 40, down: 56, bite: 5, wobble: 3 } as const;
const BAND = 0.06 * W;
/** How far off its neighbours' line, as a share of the outline's doubled area, a torn vertex must sit: four times `isSingleOutline`'s tolerance. */
const STRAIGHT = 4e-6;
/** The bigger tears, in the canvas's places: a corner gone at the top right and the bottom left, and two nicks. Edge, where along it (0 to 1), how wide, how deep. */
const NOTCHES: readonly { edge: 0 | 1 | 2 | 3; at: number; width: number; depth: number }[] = [
	{ edge: 0, at: 0.97, width: 0.08, depth: 24 },
	{ edge: 1, at: 0.03, width: 0.06, depth: 22 },
	{ edge: 1, at: 0.53, width: 0.03, depth: 12 },
	{ edge: 2, at: 0.6, width: 0.03, depth: 14 },
	{ edge: 2, at: 0.96, width: 0.08, depth: 26 },
	{ edge: 3, at: 0.08, width: 0.1, depth: 22 },
];

const CLEAR: RGBA = [0, 0, 0, 0];

function rgba(rgb: Rgb8, alpha = 1): RGBA {
	return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, alpha];
}

const PAPER = rgba(LAND_COLOURS.dry);
/** The age the canvas's `mapAge` and grime put on the edge: a brown multiplied in, here laid over at normal blend. */
const GRIME: RGBA = [107 / 255, 74 / 255, 34 / 255, 0.38];
const GRIME_CLEAR: RGBA = [GRIME[0], GRIME[1], GRIME[2], 0];
/** The torn edge's fibres, paler than the face. */
const FIBRE: RGBA = [250 / 255, 247 / 255, 236 / 255, 0.85];
const LOWLAND = rgba(LAND_COLOURS.wet, 0.85);
const UPLAND = rgba(LAND_COLOURS.high.colour, 0.9);
const BACK_ROAD_EDGE = ROAD_STYLES.backRoad.casing?.color ?? PAPER;

// -- the shapes, in cover space ---------------------------------------------

/**
 * The torn outline clockwise from the top left, and under each point the
 * band's inner edge. Every point is pulled in toward the middle along its own
 * ray, so the outline stays star-shaped and never crosses itself, however a
 * corner's tears meet, and the band's inner point sits further in on the
 * same ray.
 */
const TORN = buildOutline();
const OUTLINE: readonly Vec2[] = TORN.outer;
/** Per side, where it starts in the outline and how many points it takes (its last is the next side's first), and the band's inner points. */
const SIDES = sideRanges();

function buildOutline(): { outer: Vec2[]; inner: Vec2[] } {
	const rng = new Rng({ seed: 0x0c0e5 });
	const edges: Vec2[] = [];
	const depths: number[] = [];
	const counts = [TEAR.across, TEAR.down, TEAR.across, TEAR.down];
	const phase = [rng.float() * 6, rng.float() * 6, rng.float() * 6, rng.float() * 6];
	for (let edge = 0; edge < 4; edge++) {
		const count = counts[edge];
		for (let step = 0; step < count; step++) {
			const t = step / count;
			let depth = rng.float() * TEAR.bite + (Math.sin(t * 9 + phase[edge]) + 1) * 0.5 * TEAR.wobble;
			for (const notch of NOTCHES) {
				if (notch.edge !== edge) continue;
				const d = (t - notch.at) / notch.width;
				if (Math.abs(d) < 1) depth += notch.depth * (1 - d * d) * (0.75 + rng.float() * 0.25);
			}
			edges.push(edgePoint(edge, t));
			depths.push(depth);
		}
	}
	const outer = edges.map((point, index) => towardMiddle(point, depths[index]));
	// A vertex all but on the line through its neighbours reads as collinear
	// to the outline check (R5.17) but not to the triangulator, and the two
	// then disagree about the polygon, so each is nudged off the line. The
	// test is a share of the area, so it holds at any scale the cover is drawn.
	const area = Math.abs(doubleArea(outer));
	for (let index = 0; index < outer.length; index++) {
		const before = outer[(index + outer.length - 1) % outer.length];
		const after = outer[(index + 1) % outer.length];
		while (Math.abs(cross(before, outer[index], after)) <= area * STRAIGHT) {
			depths[index] += 0.5;
			outer[index] = towardMiddle(edges[index], depths[index]);
		}
	}
	const inner = edges.map((point, index) => towardMiddle(point, depths[index] + BAND));
	return { outer, inner };
}

function cross(a: Vec2, b: Vec2, c: Vec2): number {
	return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function doubleArea(points: readonly Vec2[]): number {
	let sum = 0;
	for (let index = 0; index < points.length; index++) {
		const from = points[index];
		const to = points[(index + 1) % points.length];
		sum += from.x * to.y - to.x * from.y;
	}
	return sum;
}

/** Side `edge`'s point `t` along it (0 top, 1 right, 2 bottom, 3 left, clockwise). */
function edgePoint(edge: number, t: number): Vec2 {
	switch (edge) {
		case 0: return { x: t * W, y: 0 };
		case 1: return { x: W, y: t * H };
		case 2: return { x: W - t * W, y: H };
		default: return { x: 0, y: H - t * H };
	}
}

/** `point` moved `distance` toward the cover's middle. */
function towardMiddle(point: Vec2, distance: number): Vec2 {
	const dx = point.x - W / 2;
	const dy = point.y - H / 2;
	const keep = 1 - distance / Math.hypot(dx, dy);
	return { x: W / 2 + dx * keep, y: H / 2 + dy * keep };
}

interface Side {
	start: number;
	count: number;
	inner: Vec2[];
}

function sideRanges(): Side[] {
	const sides: Side[] = [];
	let start = 0;
	const counts = [TEAR.across, TEAR.down, TEAR.across, TEAR.down];
	for (let edge = 0; edge < 4; edge++) {
		const count = counts[edge] + 1;
		const inner: Vec2[] = [];
		for (let step = 0; step < count; step++) inner.push(TORN.inner[(start + step) % TORN.inner.length]);
		sides.push({ start, count, inner });
		start += counts[edge];
	}
	return sides;
}

/**
 * A side's strip as one outline (R5.17's feather wants one): its outer
 * points along the torn edge, then the inner points back the other way, and
 * the quads between them. Outer point `i` faces inner point `i`, which sits
 * at `2 count - 1 - i`.
 */
function stripIndices(count: number): number[] {
	const indices: number[] = [];
	const inner = (index: number): number => 2 * count - 1 - index;
	for (let index = 0; index < count - 1; index++) {
		indices.push(index, index + 1, inner(index + 1), index, inner(index + 1), inner(index));
	}
	return indices;
}

/** An ellipse's ring, turned by `turn` radians, its points kept inside the cover by `keep`. */
function ellipse(cx: number, cy: number, rx: number, ry: number, { turn = 0, steps = 32, keep = BAND / 2, wobble = 0 } = {}): Vec2[] {
	const points: Vec2[] = [];
	const cos = Math.cos(turn);
	const sin = Math.sin(turn);
	for (let step = 0; step < steps; step++) {
		const angle = (step / steps) * Math.PI * 2;
		const swell = 1 + wobble * Math.sin(angle * 3 + cx * 0.01);
		const x = Math.cos(angle) * rx * swell;
		const y = Math.sin(angle) * ry * swell;
		points.push({ x: clamp(cx + x * cos - y * sin, keep, W - keep), y: clamp(cy + x * sin + y * cos, keep, H - keep) });
	}
	return points;
}

/** A tint laid down as a ring and its triangles. */
interface Patch {
	ring: Vec2[];
	indices: number[];
	fill: RGBA;
}

/**
 * A soft patch of tint, standing in for the canvas's blurred relief: nested
 * ellipses, each a share of the tint, so it builds to full strength at the
 * middle and fades out toward the rim.
 */
function softPatch(cx: number, cy: number, rx: number, ry: number, color: RGBA): Patch[] {
	const layers = [1, 0.78, 0.56, 0.34];
	const fill: RGBA = [color[0], color[1], color[2], color[3] / layers.length];
	return layers.map((share) => {
		const ring = ellipse(cx, cy, rx * share, ry * share, { steps: 28 });
		return { ring, indices: triangulatePolygon(ring), fill };
	});
}

/** A cubic run through `points` (start, then control, control, end per segment), sampled `steps` to a segment. */
function cubicPath(points: readonly (readonly [number, number])[], steps = 16): Vec2[] {
	const out: Vec2[] = [{ x: points[0][0], y: points[0][1] + Y0 }];
	for (let index = 1; index + 2 < points.length; index += 3) {
		const [p0, p1, p2, p3] = [points[index - 1], points[index], points[index + 1], points[index + 2]];
		for (let step = 1; step <= steps; step++) {
			const t = step / steps;
			const u = 1 - t;
			const a = u * u * u;
			const b = 3 * u * u * t;
			const c = 3 * u * t * t;
			const d = t * t * t;
			out.push({ x: a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], y: a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1] + Y0 });
		}
	}
	return out;
}

/** The canvas's paths, their ends pulled in off the torn edge; an `S` segment's first control is the last one reflected. */
const RIVER = cubicPath([[8, 298], [120, 280], [220, 340], [320, 360], [420, 380], [520, 420], [632, 401]]);
const HIGHWAY_WEST = cubicPath([[8, 519], [120, 500], [240, 450], [320, 420], [400, 390], [520, 300], [632, 257]]);
const HIGHWAY_SOUTH = cubicPath([[320, 420], [310, 540], [330, 660], [358, 782]]);
const BACK_ROADS = [
	cubicPath([[320, 420], [400, 470], [460, 520], [520, 600]]),
	cubicPath([[320, 420], [260, 470], [200, 520], [120, 560]]),
	cubicPath([[320, 420], [330, 340], [360, 280], [420, 220]]),
];
const HOME = { x: 320, y: 420 + Y0, built: 32, star: 26 } as const;
const LAKE = ellipse(140, 730 + Y0, 84, 34, { turn: 0.06, wobble: 0.05 });
/** The contaminated ground under its hatch, the canvas's blob as a turned ellipse. */
const TOXIC = { cx: 470, cy: 527 + Y0, rx: 100, ry: 58, turn: 0.42, spacing: 10 } as const;
const TOXIC_RING = ellipse(TOXIC.cx, TOXIC.cy, TOXIC.rx, TOXIC.ry, { turn: TOXIC.turn, wobble: 0.04 });
const HATCH = hatchChords();
const RELIEF: Patch[] = [
	...softPatch(140, 620 + Y0, 230, 160, LOWLAND),
	...softPatch(500, 180 + Y0, 230, 150, UPLAND),
];
/** A rise west of home, in contour lines, since the relief is otherwise flat tint. */
const CONTOURS = [74, 50, 28].map((radius) => ellipse(128, 446 + Y0, radius, radius * 0.62, { turn: -0.3, wobble: 0.08, steps: 40 }));
const CARTOUCHE = { x: 40, y: -136 + 168 + Y0, width: 560, height: 338, rule: 7 } as const;
/** Inside the cartouche's rule: the caption's gap under it, the edition line's gap over it, and the logo's width and clearance between the two. */
const CARTOUCHE_TEXT = { captionGap: 10, editionGap: 8, logoWidth: 500, logoGap: 6 } as const;
const SCALE = { x: 26, y: 744 + Y0, segment: 34, height: 6 } as const;
/** The fold down the middle (the canvas's `amFold`), inside the torn edge. */
const FOLD = { x: 312, width: 22, inset: 30 } as const;

/** Diagonal chords across the contaminated ellipse, `spacing` apart, at 45 degrees on the page. */
function hatchChords(): [Vec2, Vec2][] {
	const chords: [Vec2, Vec2][] = [];
	const { cx, cy, rx, ry, turn, spacing } = TOXIC;
	const cos = Math.cos(turn);
	const sin = Math.sin(turn);
	// The hatch's direction in the ellipse's own frame.
	const along = Math.PI / 4 - turn;
	const dx = Math.cos(along);
	const dy = Math.sin(along);
	const nx = -dy;
	const ny = dx;
	const reach = Math.max(rx, ry);
	for (let offset = -reach; offset <= reach; offset += spacing) {
		const ox = nx * offset;
		const oy = ny * offset;
		// (ox + t dx)^2 / rx^2 + (oy + t dy)^2 / ry^2 = 1
		const a = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
		const b = 2 * ((ox * dx) / (rx * rx) + (oy * dy) / (ry * ry));
		const c = (ox * ox) / (rx * rx) + (oy * oy) / (ry * ry) - 1;
		const disc = b * b - 4 * a * c;
		if (disc <= 0) continue;
		const root = Math.sqrt(disc);
		const ends = [(-b - root) / (2 * a), (-b + root) / (2 * a)].map((t): Vec2 => {
			const lx = ox + t * dx;
			const ly = oy + t * dy;
			return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
		});
		chords.push([ends[0], ends[1]]);
	}
	return chords;
}

/** Triangulated once: the torn outline is concave, and an affine map leaves triangles valid. */
const OUTLINE_TRIANGLES = triangulatePolygon(OUTLINE);
const SIDE_STRIPS = SIDES.map((side) => stripIndices(side.count));
const TOXIC_TRIANGLES = triangulatePolygon(TOXIC_RING);
const LAKE_TRIANGLES = triangulatePolygon(LAKE);

function clamp(value: number, min: number, max: number): number {
	return value < min ? min : value > max ? max : value;
}

function blank(count: number): Vec2[] {
	return Array.from({ length: count }, () => ({ x: 0, y: 0 }));
}

// -- the component ------------------------------------------------------------

interface CoverInks {
	paper: RGBA;
	ink: RGBA;
	contour: RGBA;
	river: RGBA;
	lake: RGBA;
	toxicFill: RGBA;
	toxicHatch: RGBA;
	builtUp: RGBA;
	backRoad: RGBA;
	cartouche: RGBA;
	shadow: BoxShadow;
}

const inksByTheme = new Map<Theme, CoverInks>();

function coverInks(theme: Theme, atlas: AtlasInks): CoverInks {
	let inks = inksByTheme.get(theme);
	if (inks) return inks;
	const { color } = theme;
	const rust = color.hatch_rust;
	inks = {
		paper: PAPER,
		ink: atlas.ink,
		contour: [atlas.inkDim[0], atlas.inkDim[1], atlas.inkDim[2], 0.22],
		river: color.data_bright,
		lake: color.data_dim,
		toxicFill: [rust[0], rust[1], rust[2], 0.1],
		toxicHatch: [rust[0], rust[1], rust[2], 0.5],
		builtUp: color.built_up,
		backRoad: atlas.backRoad,
		cartouche: atlas.paper,
		shadow: { color: atlas.shadow, blur: 14, offset: { x: 0, y: 12 } },
	};
	inksByTheme.set(theme, inks);
	return inks;
}

/**
 * The atlas cover on the main menu (UI Art Direction, Screens: Main menu):
 * a worn relief map torn from the atlas, lying on the page at nearly its
 * full height with a slight turn and a drop shadow, under the logo in its
 * cartouche ("A road atlas of the Halcyon region"). The map is a few cheap
 * primitives in the area map's own palette, a highway, back roads, a river
 * and a lake, home's star, and a hatched patch of contaminated ground, not a
 * generated map; the logo is the UI art atlas's.
 *
 * Its box is the page's left column, and the torn sheet runs past it to the
 * sheet's edges (`BLEED`), which `inkExtent` declares. Every shape is built
 * once in the canvas's space and mapped onto the box at layout.
 */
export class MenuCover extends Component {
	private atlasInks: AtlasInks;
	private inks: CoverInks;
	private readonly caption: Text;
	private readonly edition: Text;
	private readonly scaleLabel: Text;
	private readonly sheet: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly shadowRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
	/** The torn outline: the face's polygon and its fibre line. */
	private readonly rim: Vec2[] = blank(OUTLINE.length);
	private readonly sides: { points: Vec2[]; colors: RGBA[] }[] = SIDES.map((side) => ({
		points: blank(side.count * 2),
		colors: [...Array.from({ length: side.count }, () => GRIME), ...Array.from({ length: side.count }, () => GRIME_CLEAR)],
	}));
	private readonly relief: Vec2[][] = RELIEF.map((patch) => blank(patch.ring.length));
	private readonly contours: Vec2[][] = CONTOURS.map((ring) => blank(ring.length));
	private readonly toxic: Vec2[] = blank(TOXIC_RING.length);
	private readonly hatch: [Vec2, Vec2][] = HATCH.map(() => [{ x: 0, y: 0 }, { x: 0, y: 0 }]);
	private readonly lake: Vec2[] = blank(LAKE.length);
	private readonly river: Vec2[] = blank(RIVER.length);
	private readonly highways: Vec2[][] = [blank(HIGHWAY_WEST.length), blank(HIGHWAY_SOUTH.length)];
	private readonly backRoads: Vec2[][] = BACK_ROADS.map((road) => blank(road.length));
	private readonly home: Vec2 = { x: 0, y: 0 };
	private homeRadius = 0;
	private readonly star = new MapGlyphGeometry('star');
	private starPaint: GlyphPaint;
	private readonly fold: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly cartouche: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly cartoucheRule: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly logo: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly scale: Rect[] = [0, 1, 2].map(() => ({ x: 0, y: 0, width: 0, height: 0 }));
	private readonly tapeRect: Rect;
	private tape: Mat2D = [1, 0, 0, 1, 0, 0];
	private lineScale = 1;

	constructor(options: Omit<ComponentOptions, 'transform'> = {}) {
		super({ ...options, transform: { rotate: TILT } });
		this.componentType = 'MenuCover';
		this.atlasInks = atlasInks(this.themeTokens);
		this.inks = coverInks(this.themeTokens, this.atlasInks);
		this.starPaint = glyphPaint('star', this.atlasInks);
		const tape = uiArtSize('tape_a');
		this.tapeRect = { x: -tape.width / 2, y: -tape.height / 2, width: tape.width, height: tape.height };
		this.caption = new Text({
			text: 'A road atlas of the Halcyon region',
			style: { fontRole: 'mono', fontSize: 11, letterSpacing: 0.26, textTransform: 'uppercase', color: 'text_dim' },
			wrap: 'none',
		});
		// The serif italic of the canvas once that role exists (UI Art Direction, Type); body until then.
		this.edition = new Text({ text: 'fourth edition, revised after', style: { fontSize: 15, color: 'text_dim' }, wrap: 'none' });
		this.scaleLabel = new Text({ text: '0 · 20 mi', style: { fontRole: 'mono', fontSize: ATLAS.captionSize, color: 'text' }, wrap: 'none' });
		this.addPart(this.caption);
		this.addPart(this.edition);
		this.addPart(this.scaleLabel);
	}

	/** The torn sheet on the page, in this box's space: past the box on every side. */
	public get sheetRect(): Readonly<Rect> {
		return this.sheet;
	}

	/** The bleed past the box, and the drop shadow under it. */
	public get inkExtent(): number {
		return BLEED.top + 40;
	}

	protected onThemeChange(theme: Theme): void {
		this.atlasInks = atlasInks(theme);
		this.inks = coverInks(theme, this.atlasInks);
		this.starPaint = glyphPaint('star', this.atlasInks);
	}

	protected layoutChildren(): void {
		const sheet = this.sheet;
		sheet.x = -BLEED.left;
		sheet.y = -BLEED.top;
		sheet.width = Math.max(0, this.width + BLEED.left + BLEED.right);
		sheet.height = Math.max(0, this.height + BLEED.top + BLEED.bottom);
		const sx = sheet.width / W;
		const sy = sheet.height / H;
		this.lineScale = (sx + sy) / 2;
		const map = (from: readonly Vec2[], to: Vec2[], offset = 0): void => {
			for (let index = 0; index < from.length; index++) {
				to[index + offset].x = sheet.x + from[index].x * sx;
				to[index + offset].y = sheet.y + from[index].y * sy;
			}
		};
		const place = (point: Vec2, x: number, y: number): void => {
			point.x = sheet.x + x * sx;
			point.y = sheet.y + y * sy;
		};
		const box = (rect: Rect, x: number, y: number, width: number, height: number): void => {
			rect.x = sheet.x + x * sx;
			rect.y = sheet.y + y * sy;
			rect.width = width * sx;
			rect.height = height * sy;
		};

		map(OUTLINE, this.rim);
		const inset = 6;
		this.shadowRect.x = sheet.x + inset;
		this.shadowRect.y = sheet.y + inset;
		this.shadowRect.width = Math.max(0, sheet.width - inset * 2);
		this.shadowRect.height = Math.max(0, sheet.height - inset * 2);
		SIDES.forEach((side, index) => {
			const strip = this.sides[index].points;
			for (let step = 0; step < side.count; step++) {
				const outer = OUTLINE[(side.start + step) % OUTLINE.length];
				place(strip[step], outer.x, outer.y);
				place(strip[2 * side.count - 1 - step], side.inner[step].x, side.inner[step].y);
			}
		});
		RELIEF.forEach((patch, index) => map(patch.ring, this.relief[index]));
		CONTOURS.forEach((ring, index) => map(ring, this.contours[index]));
		map(TOXIC_RING, this.toxic);
		HATCH.forEach(([from, to], index) => {
			place(this.hatch[index][0], from.x, from.y);
			place(this.hatch[index][1], to.x, to.y);
		});
		map(LAKE, this.lake);
		map(RIVER, this.river);
		map(HIGHWAY_WEST, this.highways[0]);
		map(HIGHWAY_SOUTH, this.highways[1]);
		BACK_ROADS.forEach((road, index) => map(road, this.backRoads[index]));
		place(this.home, HOME.x, HOME.y);
		this.homeRadius = HOME.built * this.lineScale;
		const starSize = HOME.star * this.lineScale;
		this.star.place(this.home.x - starSize / 2, this.home.y - starSize / 2, starSize);
		box(this.fold, FOLD.x, FOLD.inset, FOLD.width, H - FOLD.inset * 2);
		box(this.cartouche, CARTOUCHE.x, CARTOUCHE.y, CARTOUCHE.width, CARTOUCHE.height);
		const rule = CARTOUCHE.rule;
		this.cartoucheRule.x = this.cartouche.x + rule;
		this.cartoucheRule.y = this.cartouche.y + rule;
		this.cartoucheRule.width = Math.max(0, this.cartouche.width - rule * 2);
		this.cartoucheRule.height = Math.max(0, this.cartouche.height - rule * 2);
		this.scale.forEach((segment, index) => box(segment, SCALE.x + index * SCALE.segment, SCALE.y, SCALE.segment, SCALE.height));

		const turn = (-34 * Math.PI) / 180;
		this.tape = [Math.cos(turn), Math.sin(turn), -Math.sin(turn), Math.cos(turn), sheet.x + 22, sheet.y + 16];

		this.placeCartoucheText(sx);
		const scaleRight = this.scale[2];
		const label = this.scaleLabel;
		const labelWidth = Math.ceil(label.measured?.width ?? 0);
		const labelHeight = Math.ceil(label.measured?.height ?? ATLAS.captionSize);
		label.setPosition(Math.round(scaleRight.x + scaleRight.width + 6), Math.round(scaleRight.y + scaleRight.height / 2 - labelHeight / 2));
		label.setSize(labelWidth, labelHeight);
	}

	/** The logo fitted to its box in the cartouche, centred, at its own aspect. */
	/**
	 * The caption under the cartouche's top rule and the edition line over its
	 * bottom one, at their own sizes, and the logo fitted between them at its
	 * own aspect, so a short window shrinks the logo rather than crowd the type.
	 */
	private placeCartoucheText(sx: number): void {
		const box = this.cartoucheRule;
		const middle = box.x + box.width / 2;
		const captionTop = box.y + CARTOUCHE_TEXT.captionGap;
		this.placeText(this.caption, middle, captionTop);
		const editionHeight = Math.ceil(this.edition.measured?.height ?? this.edition.fontSize);
		const editionTop = box.y + box.height - CARTOUCHE_TEXT.editionGap - editionHeight;
		this.placeText(this.edition, middle, editionTop);
		const art = uiArtSize('logo');
		const top = captionTop + this.caption.height + CARTOUCHE_TEXT.logoGap;
		const width = Math.min(CARTOUCHE_TEXT.logoWidth * sx, box.width);
		const height = Math.max(0, editionTop - CARTOUCHE_TEXT.logoGap - top);
		const fit = Math.min(width / art.width, height / art.height);
		this.logo.width = art.width * fit;
		this.logo.height = art.height * fit;
		this.logo.x = middle - this.logo.width / 2;
		this.logo.y = top + (height - this.logo.height) / 2;
	}

	/** A line centred on `x`, its top at `y`. */
	private placeText(text: Text, x: number, y: number): void {
		const width = Math.ceil(text.measured?.width ?? 0);
		const height = Math.ceil(text.measured?.height ?? text.fontSize);
		text.setPosition(Math.round(x - width / 2), Math.round(y));
		text.setSize(width, height);
	}

	public render(draw: DrawApi): void {
		const inks = this.inks;
		const atlas = this.atlasInks;
		const line = this.lineScale;
		// The shadow goes down on its own, under the torn face, as the deck stacks' does.
		draw.drawRect({ id: this.id ?? undefined, rect: this.shadowRect, fill: CLEAR, shadow: inks.shadow });
		draw.drawPolygon({ points: this.rim, indices: OUTLINE_TRIANGLES, fill: inks.paper });
		for (let index = 0; index < this.relief.length; index++) draw.drawPolygon({ points: this.relief[index], indices: RELIEF[index].indices, fill: RELIEF[index].fill });
		for (let index = 0; index < this.contours.length; index++) draw.drawPolyline({ points: this.contours[index], closed: true, color: inks.contour, width: Math.max(0.8, line) });
		draw.drawPolygon({ points: this.toxic, indices: TOXIC_TRIANGLES, fill: inks.toxicFill });
		for (let index = 0; index < this.hatch.length; index++) draw.drawLine({ from: this.hatch[index][0], to: this.hatch[index][1], color: inks.toxicHatch, width: 1.4 });
		draw.drawPolygon({ points: this.lake, indices: LAKE_TRIANGLES, fill: inks.lake });
		draw.drawPolyline({ points: this.lake, closed: true, color: inks.river, width: 1.5 });
		draw.drawPolyline({ points: this.river, color: inks.river, width: Math.max(2, 3 * line), cap: 'round' });
		const roads = this.backRoads;
		for (let index = 0; index < roads.length; index++) draw.drawPolyline({ points: roads[index], color: BACK_ROAD_EDGE, width: Math.max(2.4, 3.4 * line), cap: 'round' });
		for (let index = 0; index < roads.length; index++) draw.drawPolyline({ points: roads[index], color: inks.backRoad, width: Math.max(1, 1.2 * line), cap: 'round' });
		const highways = this.highways;
		for (let index = 0; index < highways.length; index++) draw.drawPolyline({ points: highways[index], color: atlas.casing, width: Math.max(5, 7.5 * line), cap: 'round' });
		for (let index = 0; index < highways.length; index++) draw.drawPolyline({ points: highways[index], color: atlas.highway, width: Math.max(2.8, 4.2 * line), cap: 'round' });
		draw.drawCircle({ center: this.home, radius: this.homeRadius, fill: inks.builtUp, border: { color: atlas.hairline, width: 1 } });
		this.star.draw(draw, this.starPaint);
		drawAtlasArt(draw, { name: 'paper_fold', rect: this.fold });
		for (let index = 0; index < this.sides.length; index++) draw.drawPolygon({ points: this.sides[index].points, indices: SIDE_STRIPS[index], colors: this.sides[index].colors });
		draw.drawPolyline({ points: this.rim, closed: true, color: FIBRE, width: 1.2 });

		draw.drawRect({ rect: this.cartouche, fill: inks.cartouche, border: { color: inks.ink, width: ATLAS.plateRule } });
		draw.drawRect({ rect: this.cartoucheRule, fill: CLEAR, border: { color: inks.ink, width: ATLAS.plateOuterRule } });
		drawAtlasArt(draw, { name: 'logo', rect: this.logo });
		draw.drawRect({ rect: this.scale[0], fill: inks.ink });
		draw.drawRect({ rect: this.scale[1], fill: inks.paper, border: { color: inks.ink, width: 1 } });
		draw.drawRect({ rect: this.scale[2], fill: inks.ink });
		draw.pushTransform(this.tape);
		if (!drawAtlasArt(draw, { name: 'tape_a', rect: this.tapeRect })) draw.drawRect({ rect: this.tapeRect, fill: atlas.tape });
		draw.popTransform();
	}
}
