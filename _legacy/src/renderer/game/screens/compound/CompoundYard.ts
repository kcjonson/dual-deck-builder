import { Component, ComponentOptions } from '../../../engine/components/Component';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import type { TextShadow } from '../../../engine/draw/commands';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { Mat2D, RGBA, Rect, Vec2 } from '../../../engine/draw/geometry';
import { triangulatePolygon } from '../../../engine/draw/triangulate';
import type { UiActionEvent, UiPointerEvent } from '../../../engine/input/events';
import type { Theme } from '../../../engine/theme/tokens';
import { Pressable } from '../../../engine/ui/Pressable';
import { BUILDING_IDS, BuildingId } from '../../campaign/Buildings';
import { HandMark, HandMarkLayer, HandMarkVariant } from '../../ui/atlas/HandMarkLayer';
import { AtlasInks, DISPLAY_BOLD, atlasInks } from '../../ui/atlas/atlasStyle';
import { GlyphPaint, MapGlyphGeometry, glyphPaint } from '../../ui/atlas/mapGlyphs';
import { dashedOutlineTriangles, hatchTriangles } from '../../ui/stripes';

/**
 * The compound plate's art (UI Art Direction, Components, Plates; the
 * canvas's FinalCompound), drawn in engine from flat shapes so a building
 * appears on it the day it's built (the spec's open question 2). Geometry
 * is authored in the canvas's 920 by 760 plate and drawn through one
 * uniform scale, lit from the north-west with shadows to the south-east.
 */
const PLATE = { width: 920, height: 760 } as const;

/** Each building's plot on the plate, numbered in `BUILDING_IDS` order. */
const PLOTS: Readonly<Record<BuildingId, Rect>> = {
	bunkhouse: { x: 120, y: 126, width: 270, height: 140 },
	radio_mast: { x: 480, y: 120, width: 110, height: 110 },
	infirmary: { x: 470, y: 280, width: 190, height: 110 },
	map_room: { x: 120, y: 320, width: 160, height: 110 },
	garage: { x: 110, y: 480, width: 250, height: 150 },
	stores: { x: 430, y: 560, width: 200, height: 110 },
};

function hex(value: string, alpha = 1): RGBA {
	const n = parseInt(value.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
}

/** The plate's own colours: dirt, scrap, and tin are art, not print, so they live here rather than in the theme (as the area map's do). */
const ART = {
	dirt: hex('#C2AE88'),
	dirtDark: hex('#7A6244', 0.09),
	dirtLight: hex('#E8DCBC', 0.13),
	ruts: hex('#8C7655', 0.5),
	fenceUnder: hex('#2A2521'),
	scrap: [hex('#6E6A61'), hex('#8E5B3A'), hex('#5C6B5E'), hex('#7D7A70')],
	post: hex('#1F1B18'),
	gateLeaf: hex('#4A4540'),
	asphalt: hex('#7A766F'),
	tin: { base: hex('#9EA19B'), light: hex('#B8BAB3'), dark: hex('#80837E') },
	rust: { base: hex('#8E5B3A'), light: hex('#A66C45'), dark: hex('#734630') },
	roofEdge: hex('#4A4C48'),
	ridge: hex('#6E716C'),
	shadow: hex('#000000', 0.35),
	softShadow: hex('#000000', 0.22),
	glass: hex('#5E7F8C', 0.8),
	crate: hex('#5B4A36'),
	crateEdge: hex('#3A3024'),
	tyre: hex('#2D2B29'),
	tyreRim: hex('#4A4743'),
	wreck: hex('#6E6A61'),
	wreckEdge: hex('#3A3530'),
	stake: hex('#3A3024'),
	tank: hex('#6C8A93'),
	tankRim: hex('#45585E'),
	rig: { body: hex('#7A4A2E'), edge: hex('#3A2418'), cab: hex('#4A2D1E'), bed: hex('#5E3A26') },
	bike: { body: hex('#2E5E5B'), edge: hex('#183634') },
} as const;

const CLEAR: RGBA = [0, 0, 0, 0];
const SHADOW_OFFSET = { x: 12, y: 12 };
/** A corrugated roof's ribs: a light and a dark stripe in every 8 px. */
const RIB = { period: 8, light: 3, darkAt: 6, dark: 2 };
/** The rust hatch over an unbuilt plot: 2 px lines 11 px apart at 45 degrees, measured along x + y. */
const HATCH = { period: 11 * Math.SQRT2, stripe: 2 * Math.SQRT2, alpha: 0.55 };
const STRING = { width: 1.6, dash: 6, gap: 4 };
/** Labels read at the plate's scale down to this, then stay put, so names never shrink past reading at 1024 by 600. */
const LABEL_SCALE_MIN = 0.75;
const LABEL = { glyph: 30, name: 22, builtName: 26, state: 13, gap: 6, halo: 2.2 };
/** Mono labels never print under this, scale or no scale. */
const MONO_MIN = 11;
/** JetBrains Mono's advance, for sizing a mono label's paper tag without measuring it. */
const MONO_ADVANCE = 0.6;
/** A paper tag round a mono label on the plate, so it holds 4.5:1 whatever the dirt or hatch under it. */
const TAG_PAD = 3;
/** Barlow Condensed bold's mean advance, for the loop's reach round a name without measuring it. */
const DISPLAY_ADVANCE = 0.5;
/**
 * The loop round a chosen building passes through the corners of the box
 * round its roof and its label: an ellipse through a box's corners is the
 * box scaled by root 2, less the reach the hand layer adds itself.
 */
const LOOP_SPREAD = Math.SQRT2;
/** How far outside its target the hand layer draws the loop, and the room left past the corners for the pencil's wobble. */
const LOOP_REACH = 12;
const LOOP_MARGIN = 6;

interface Corrugation {
	base: Rect;
	light: Vec2[];
	dark: Vec2[];
	palette: { base: RGBA; light: RGBA; dark: RGBA };
}

function quad(out: Vec2[], x: number, y: number, width: number, height: number): void {
	out.push({ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y }, { x: x + width, y: y + height }, { x, y: y + height });
}

function corrugation(rect: Rect, palette: Corrugation['palette']): Corrugation {
	const light: Vec2[] = [];
	const dark: Vec2[] = [];
	const right = rect.x + rect.width;
	for (let x = rect.x; x < right; x += RIB.period) {
		quad(light, x, rect.y, Math.min(RIB.light, right - x), rect.height);
		if (x + RIB.darkAt < right) quad(dark, x + RIB.darkAt, rect.y, Math.min(RIB.dark, right - x - RIB.darkAt), rect.height);
	}
	return { base: rect, light, dark, palette };
}

function drawCorrugation(draw: DrawApi, roof: Corrugation): void {
	draw.drawRect({ rect: roof.base, fill: roof.palette.base });
	draw.drawPolygon({ points: roof.light, fill: roof.palette.light });
	draw.drawPolygon({ points: roof.dark, fill: roof.palette.dark });
}

function inset(rect: Rect, by: number): Rect {
	return { x: rect.x + by, y: rect.y + by, width: rect.width - by * 2, height: rect.height - by * 2 };
}

/** A cubic from the canvas's paths, as points. */
function cubic(from: Vec2, c1: Vec2, c2: Vec2, to: Vec2, steps: number, out: Vec2[] = []): Vec2[] {
	for (let step = out.length === 0 ? 0 : 1; step <= steps; step++) {
		const t = step / steps;
		const u = 1 - t;
		out.push({
			x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
			y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
		});
	}
	return out;
}

const p = (x: number, y: number): Vec2 => ({ x, y });

/** What a built building looks like from above: its roof, and what's on it. */
interface BuiltArt {
	roof: Corrugation;
	ridge: Rect;
	patches: Corrugation[];
	glass: Rect[];
	/** Small dark rects on the roof (a mast's footing, a door's shadow). */
	marks: Rect[];
	/** Lines on the roof (a mast's guy wires), from and to. */
	wires: [Vec2, Vec2][];
	/** A painted cross (the infirmary's). */
	cross: Rect[];
}

/** What an unbuilt plot looks like: the hatch, the string, its stakes, and the scrap lying on it. */
interface PlotArt {
	hatch: Vec2[];
	string: Vec2[];
	stakes: Rect[];
	wreck: { points: Vec2[]; indices: number[] } | null;
	tyres: Vec2[];
	crates: Rect[];
}

function builtArt(id: BuildingId): BuiltArt {
	const plot = PLOTS[id];
	// The bunkhouse fills its plot, as the canvas draws it; the rest stand a little in from the string.
	const footprint = id === 'bunkhouse' ? plot : inset(plot, 8);
	const palette = id === 'stores' ? ART.rust : ART.tin;
	const art: BuiltArt = {
		roof: corrugation(footprint, palette),
		ridge: { x: footprint.x, y: footprint.y + footprint.height / 2 - 1.5, width: footprint.width, height: 3 },
		patches: [],
		glass: [],
		marks: [],
		wires: [],
		cross: [],
	};
	const { x, y, width, height } = footprint;
	switch (id) {
		case 'bunkhouse':
			art.patches.push(corrugation({ x: 300, y: 140, width: 56, height: 40 }, ART.rust));
			art.glass.push({ x: 160, y: 210, width: 34, height: 34 });
			break;
		case 'radio_mast': {
			const cx = x + width / 2;
			const cy = y + height / 2;
			for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) art.wires.push([p(cx, cy), p(cx + (dx * width) / 2 - dx * 6, cy + (dy * height) / 2 - dy * 6)]);
			art.marks.push({ x: cx - 7, y: cy - 7, width: 14, height: 14 });
			break;
		}
		case 'infirmary':
			art.cross.push({ x: x + width / 2 - 18, y: y + height / 2 - 6, width: 36, height: 12 }, { x: x + width / 2 - 6, y: y + height / 2 - 18, width: 12, height: 36 });
			break;
		case 'map_room':
			art.glass.push({ x: x + 16, y: y + height - 44, width: 30, height: 30 });
			break;
		case 'garage':
			art.patches.push(corrugation({ x: x + width - 70, y: y + 12, width: 52, height: 36 }, ART.rust));
			art.marks.push({ x: x + 30, y: y + height - 10, width: width - 60, height: 10 });
			break;
		case 'stores':
			art.marks.push({ x: x + width / 2 - 20, y: y + height - 8, width: 40, height: 8 });
			break;
	}
	return art;
}

function plotArt(id: BuildingId): PlotArt {
	const plot = PLOTS[id];
	const string: Vec2[] = [];
	dashedOutlineTriangles(plot, STRING, string);
	const size = 5;
	const art: PlotArt = {
		hatch: hatchTriangles(plot, HATCH),
		string,
		stakes: [
			{ x: plot.x - size / 2, y: plot.y - size / 2, width: size, height: size },
			{ x: plot.x + plot.width - size / 2, y: plot.y - size / 2, width: size, height: size },
			{ x: plot.x + plot.width - size / 2, y: plot.y + plot.height - size / 2, width: size, height: size },
			{ x: plot.x - size / 2, y: plot.y + plot.height - size / 2, width: size, height: size },
		],
		wreck: null,
		tyres: [],
		crates: [],
	};
	// The scrap left lying where nothing's built yet, from the canvas.
	if (id === 'radio_mast') {
		const points = [p(520, 190), p(534, 200), p(544, 194), p(556, 206), p(538, 216), p(522, 208)];
		art.wreck = { points, indices: triangulatePolygon(points) };
	}
	if (id === 'garage') art.tyres.push(p(180, 560), p(200, 575));
	if (id === 'stores') art.crates.push({ x: 560, y: 600, width: 26, height: 26 }, { x: 590, y: 612, width: 22, height: 22 });
	return art;
}

/** The fence's runs, each in the scrap it was patched from, round the yard with the gate in the east side. */
const FENCE_UNDER: readonly (readonly Vec2[])[] = [
	[p(60, 70), p(700, 70), p(700, 360)],
	[p(700, 460), p(700, 700), p(60, 700)],
	[p(60, 70), p(60, 700)],
];
const FENCE_RUNS: readonly { from: Vec2; to: Vec2; scrap: number }[] = [
	{ from: p(60, 70), to: p(240, 70), scrap: 0 }, { from: p(240, 70), to: p(380, 70), scrap: 1 }, { from: p(380, 70), to: p(560, 70), scrap: 2 }, { from: p(560, 70), to: p(700, 70), scrap: 3 },
	{ from: p(700, 70), to: p(700, 200), scrap: 1 }, { from: p(700, 200), to: p(700, 360), scrap: 0 },
	{ from: p(700, 460), to: p(700, 600), scrap: 2 }, { from: p(700, 600), to: p(700, 700), scrap: 1 },
	{ from: p(60, 700), to: p(260, 700), scrap: 3 }, { from: p(260, 700), to: p(480, 700), scrap: 1 }, { from: p(480, 700), to: p(700, 700), scrap: 0 },
	{ from: p(60, 70), to: p(60, 300), scrap: 2 }, { from: p(60, 300), to: p(60, 520), scrap: 3 }, { from: p(60, 520), to: p(60, 700), scrap: 1 },
];
const FENCE_POSTS: readonly Rect[] = (() => {
	const posts: Rect[] = [];
	const at = (x: number, y: number) => posts.push({ x: x - 4, y: y - 4, width: 8, height: 8 });
	for (let x = 60; x <= 700; x += 80) { at(x, 70); at(x, 700); }
	for (let y = 150; y < 700; y += 80) { at(60, y); if (y < 350 || y > 470) at(700, y); }
	return posts;
})();
const GATE_POSTS: readonly Rect[] = [{ x: 694, y: 350, width: 14, height: 14 }, { x: 694, y: 456, width: 14, height: 14 }];
const GATE_LEAF: readonly Vec2[] = [p(701, 364), p(742, 380)];

/** The road out of the gate to the plate's east edge, sampled from the canvas's curve, the last point moved to the edge at layout. */
const ROAD_CURVE: readonly Vec2[] = cubic(p(700, 410), p(780, 404), p(860, 396), p(930, 390), 12);
/** Wheel ruts from the gate round to the garage. */
const RUTS: readonly (readonly Vec2[])[] = [
	cubic(p(470, 470), p(430, 510), p(380, 520), p(300, 520), 10, cubic(p(690, 400), p(600, 400), p(520, 420), p(470, 470), 10)),
	cubic(p(486, 484), p(446, 524), p(390, 540), p(300, 540), 10, cubic(p(690, 422), p(600, 422), p(530, 440), p(486, 484), 10)),
];
/** The road's centre dashes along the curve: 18 on, 16 off, from x 720. */
const ROAD_DASH = { on: 18, off: 16, width: 3, alpha: 0.8 };
/** The road's casing, the widest thing it draws. */
const ROAD_CASING = 46;
const MAX_DASHES = 96;

/**
 * Packed dirt's mottling: many small irregular patches, darker and lighter,
 * scattered once by a fixed seed, each a fan of triangles round a ragged
 * outline. Each shade is one bare triangle list, so the ground is two draws.
 */
const DIRT_PATCHES: Readonly<{ dark: readonly Vec2[]; light: readonly Vec2[] }> = (() => {
	let seed = 0x2f6b1d;
	const next = (): number => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 0x100000000;
	};
	const dark: Vec2[] = [];
	const light: Vec2[] = [];
	for (let index = 0; index < 260; index++) {
		const centre = p(next() * PLATE.width, next() * PLATE.height);
		// Mostly grit, a few broader scuffs.
		const radius = next() < 0.85 ? 3 + next() * 9 : 12 + next() * 14;
		const stretch = 0.55 + next() * 0.9;
		const turn = next() * Math.PI;
		const sides = 6 + Math.floor(next() * 4);
		const outline: Vec2[] = [];
		for (let side = 0; side < sides; side++) {
			const angle = (side / sides) * Math.PI * 2;
			const reach = radius * (0.55 + next() * 0.6);
			const along = Math.cos(angle) * reach * stretch;
			const across = Math.sin(angle) * reach;
			// Held to the plate, so the patches stay inside the yard's own box and cull ink.
			const x = centre.x + along * Math.cos(turn) - across * Math.sin(turn);
			const y = centre.y + along * Math.sin(turn) + across * Math.cos(turn);
			outline.push(p(Math.min(PLATE.width, Math.max(0, x)), Math.min(PLATE.height, Math.max(0, y))));
		}
		const into = next() < 0.45 ? light : dark;
		for (let side = 0; side < sides; side++) into.push(centre, outline[side], outline[(side + 1) % sides]);
	}
	return { dark, light };
})();

const TANK = { at: p(364, 432), radius: 40, rim: 5, hub: 10 };
/** The rig and the bike parked inside the gate: each a turn and a place, from the canvas. */
const RIG = { at: p(618, 452), turn: (-8 * Math.PI) / 180 };
const BIKE = { at: p(626, 500), turn: (-4 * Math.PI) / 180 };
const NORTH: readonly Vec2[] = [p(0, -24), p(8, 6), p(0, 0), p(-8, 6)];
const NORTH_INDICES = triangulatePolygon(NORTH);

function rotation(at: Vec2, turn: number): Mat2D {
	const cos = Math.cos(turn);
	const sin = Math.sin(turn);
	return [cos, sin, -sin, cos, at.x, at.y];
}

const RIG_MATRIX = rotation(RIG.at, RIG.turn);
const BIKE_MATRIX = rotation(BIKE.at, BIKE.turn);

export interface BuildingSpotOptions extends Omit<ComponentOptions, 'width' | 'height'> {
	building: BuildingId;
	number: string;
	name: string;
	onChoose: (building: BuildingId) => void;
}

/**
 * One building on the plate as a hit target over its plot: the circled
 * number and the name in a paper halo, as the map labels its places, and
 * the state in mono beneath on a paper tag (UI Art Direction, Components,
 * Plates), set in the plot's corner as the canvas sets them. A
 * press or keyboard focus chooses it. Hover adds an ink outline; focus
 * visible is the walk's ink ring; the selection is the yard's grease-pencil
 * loop and the screen's building box, so the mark is never the only signal.
 */
export class BuildingSpot extends Pressable {
	public readonly building: BuildingId;
	public readonly number: string;
	public readonly name: string;
	private isBuilt = false;
	private stateText: string;
	private labelScale = 1;
	private inks: AtlasInks;
	private halo: TextShadow;
	private glyphPaint: GlyphPaint;
	private readonly glyph = new MapGlyphGeometry('circled');
	private readonly outline: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly namePosition: Vec2 = { x: 0, y: 0 };
	private readonly statePosition: Vec2 = { x: 0, y: 0 };
	private readonly stateTag: Rect = { x: 0, y: 0, width: 0, height: 0 };
	/** The label's box in this spot's space, for the loop to take in. */
	private readonly label: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly onChoose: (building: BuildingId) => void;
	private texts: readonly string[];

	constructor({ building, number, name, onChoose, ...options }: BuildingSpotOptions) {
		super({ focusable: true, ...options });
		this.componentType = 'BuildingSpot';
		this.building = building;
		this.number = number;
		this.name = name;
		this.onChoose = onChoose;
		this.stateText = '';
		this.texts = [number, name];
		this.inks = atlasInks(this.themeTokens);
		this.halo = paperHalo(this.inks);
		this.glyphPaint = glyphPaint('circled', this.inks);
		this.onFocus = () => this.onChoose(this.building);
	}

	public get built(): boolean {
		return this.isBuilt;
	}

	/** The state line under the name: built or not, as the caller words it. */
	public setState({ built, text }: { built: boolean; text: string }): void {
		this.isBuilt = built;
		this.stateText = text;
		this.texts = [this.number, this.name, text];
		this.invalidateLayout();
	}

	public get state(): string {
		return this.stateText;
	}

	public get drawnText(): readonly string[] {
		return this.texts;
	}

	/** The label sits above the plot and runs past it to the right, as a map label runs past its symbol. */
	public get inkExtent(): number {
		return 180;
	}

	/** The yard's scale for its labels, set as it lays the spot out. */
	public set scale(scale: number) {
		this.labelScale = Math.max(LABEL_SCALE_MIN, Math.min(1, scale));
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
		this.halo = paperHalo(this.inks);
		this.glyphPaint = glyphPaint('circled', this.inks);
	}

	protected onPressed(_event: UiPointerEvent | UiActionEvent): void {
		this.onChoose(this.building);
	}

	protected layoutChildren(): void {
		super.layoutChildren();
		const scale = this.labelScale;
		const size = Math.round(LABEL.glyph * scale);
		const nameSize = this.nameSize;
		const stateSize = this.stateSize;
		const corner = Math.round(Math.min(20, this.width / 4, this.height / 4));
		this.glyph.place(corner - size / 2, corner - size / 2, size);
		this.namePosition.x = corner + size / 2 + LABEL.gap;
		this.namePosition.y = corner + nameSize * 0.36;
		this.statePosition.x = this.namePosition.x;
		this.statePosition.y = corner + size / 2 + stateSize;
		const tagWidth = this.stateText.length * MONO_ADVANCE * stateSize;
		setRect(this.stateTag, this.statePosition.x - TAG_PAD, this.statePosition.y - stateSize * 0.82 - TAG_PAD / 2, tagWidth + TAG_PAD * 2, stateSize + TAG_PAD);
		const right = this.namePosition.x + Math.max(this.name.length * DISPLAY_ADVANCE * nameSize, tagWidth);
		setRect(this.label, corner - size / 2, corner - size / 2, right - (corner - size / 2), this.stateTag.y + this.stateTag.height - (corner - size / 2));
		setRect(this.outline, 0, 0, this.width, this.height);
	}

	/** The label's box, in this spot's space. */
	public get labelBox(): Readonly<Rect> {
		return this.label;
	}

	private get nameSize(): number {
		return (this.isBuilt ? LABEL.builtName : LABEL.name) * this.labelScale;
	}

	private get stateSize(): number {
		return Math.max(MONO_MIN, LABEL.state * this.labelScale);
	}

	public render(draw: DrawApi): void {
		const inks = this.inks;
		if (this.hovered && this.effectivelyEnabled) draw.drawRect({ rect: this.outline, fill: CLEAR, border: { color: inks.ink, width: 1.6, position: 'inside' } });
		this.glyph.draw(draw, this.glyphPaint, this.number);
		const halo = this.halo;
		draw.drawText({ id: this.id ?? undefined, text: this.name, position: this.namePosition, font: DISPLAY_BOLD, size: this.nameSize, color: inks.ink, shadow: halo, wrap: 'none' });
		if (this.stateText) {
			draw.drawRect({ rect: this.stateTag, fill: inks.paper });
			draw.drawText({ text: this.stateText, position: this.statePosition, font: 'mono', size: this.stateSize, color: inks.ink, shadow: halo, wrap: 'none' });
		}
	}
}

/**
 * What the grease loop goes round: the chosen building's roof and its
 * label together, spread so the loop clears both instead of crossing the
 * label in the corner. It draws nothing and takes no hits.
 */
class LoopFrame extends Component {
	constructor() {
		super({ id: 'compound_yard_loop', positioned: 'absolute', pointerEvents: 'none', zIndex: -1 });
		this.componentType = 'LoopFrame';
	}
}

export interface CompoundYardOptions extends Omit<StackOptions, 'style' | 'padding' | 'direction'> {
	/** A building chosen by press, or by focus moving onto it. */
	onChoose: (building: BuildingId) => void;
	/** Each building's name, in `BUILDING_IDS` order. */
	names: Readonly<Record<BuildingId, string>>;
	/** Each building's number on the plate. */
	numbers: Readonly<Record<BuildingId, string>>;
	/** The gate's label and the road's, on the plate. */
	gate: { name: string; road: string };
}

/**
 * The yard from above, inside the plate's rules: packed dirt, the scrap
 * fence with its posts and the gate on the east, the road leaving east in
 * the highway's casing and dashes, the water tank, the rig and the bike
 * parked inside the gate, and each building, drawn when it stands (a
 * corrugated roof, its shadow to the south-east) and staked out with
 * string over the rust hatch when it doesn't.
 *
 * The yard's 920 by 760 plate is fitted whole and centred; the dirt fills
 * the rest of the box and the road runs on to its east edge. The buildings
 * are `BuildingSpot` hit targets over their plots, one focus group whose
 * Left and Right step through them by number and whose Up and Down go to
 * directional focus (R9.26), and the chosen one carries a grease-pencil
 * loop from the hand layer. All geometry is built at construction, and
 * layout only moves the fit, so a frame allocates nothing.
 */
export class CompoundYard extends Stack {
	private readonly spots: BuildingSpot[] = [];
	private readonly hand: HandMarkLayer;
	private loopMark: HandMark | null = null;
	private readonly loopFrame = new LoopFrame();
	private loops = 0;
	private chosen: BuildingId | null = null;
	private inks: AtlasInks;
	private halo: TextShadow;
	private hatchInk: RGBA;
	private dashInk: RGBA;
	private readonly built = new Set<BuildingId>();
	private readonly builtArt: Readonly<Record<BuildingId, BuiltArt>>;
	private readonly plotArt: Readonly<Record<BuildingId, PlotArt>>;
	private readonly rigParts = {
		shadow: { x: 4, y: 6, width: 70, height: 34 },
		body: { x: 0, y: 0, width: 70, height: 34 },
		cab: { x: 46, y: 4, width: 20, height: 26 },
		bed: { x: 8, y: 6, width: 32, height: 22 },
		lights: [[p(70, 4), p(76, 4)], [p(70, 30), p(76, 30)]] as [Vec2, Vec2][],
	};
	private readonly bikeParts = {
		shadow: { x: 2, y: 4, width: 38, height: 12 },
		body: { x: 0, y: 2, width: 38, height: 10 },
		bars: [[p(38, 2), p(44, 0)], [p(38, 12), p(44, 14)]] as [Vec2, Vec2][],
	};
	private readonly gateText: { name: string; road: string };
	/** Plate to box: the fit's scale and offset. */
	private readonly fit: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
	private fitScale = 1;
	/** The dirt, in plate units: the whole box. */
	private readonly ground: Rect = { x: 0, y: 0, width: PLATE.width, height: PLATE.height };
	/** The box, run on east as far as the road's casing goes past it; the plate's clip trims what shows. */
	private readonly drawnInk: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly road: Vec2[] = [...ROAD_CURVE.map((point) => ({ ...point })), { x: 0, y: 0 }];
	private readonly dashes: Vec2[];
	private dashCount = 0;
	private readonly dashPoints: Vec2[] = [];
	private readonly north: Vec2[] = NORTH.map(() => ({ x: 0, y: 0 }));
	private readonly scaleBar: Rect[] = [0, 1, 2].map(() => ({ x: 0, y: 0, width: 0, height: 0 }));
	private readonly gateName: Vec2 = { x: 0, y: 0 };
	/** The road's label under the road, pulled in from the plate's edge on a narrow plate, on its paper tag. */
	private readonly roadName: Vec2 = { x: 0, y: 0 };
	private readonly roadTag: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private vehiclesHome = true;
	private labelScale = 1;

	constructor({ onChoose, names, numbers, gate, ...options }: CompoundYardOptions) {
		super({ ...options, focusGroup: { orientation: 'horizontal', wrap: true } });
		this.componentType = 'CompoundYard';
		this.inks = atlasInks(this.themeTokens);
		this.halo = paperHalo(this.inks);
		this.hatchInk = hatchInk(this.themeTokens);
		this.dashInk = withAlpha(this.inks.highway, ROAD_DASH.alpha);
		this.gateText = gate;
		const built = {} as Record<BuildingId, BuiltArt>;
		const plots = {} as Record<BuildingId, PlotArt>;
		for (const id of BUILDING_IDS) {
			built[id] = builtArt(id);
			plots[id] = plotArt(id);
			const spot = new BuildingSpot({ id: `compound_building_${id}`, building: id, number: numbers[id], name: names[id], onChoose });
			this.spots.push(spot);
			this.addChild(spot);
		}
		this.builtArt = built;
		this.plotArt = plots;
		this.dashes = Array.from({ length: MAX_DASHES * 6 }, () => ({ x: 0, y: 0 }));
		this.addChild(this.loopFrame);
		this.hand = new HandMarkLayer({ id: 'compound_yard_marks', place: 'over' });
		this.addChild(this.hand);
	}

	public spot(id: BuildingId): BuildingSpot {
		const spot = this.spots.find((each) => each.building === id);
		if (!spot) throw new Error(`CompoundYard: no ${id}`);
		return spot;
	}

	/** The building the grease-pencil loop is round, or null. */
	public get chosenBuilding(): BuildingId | null {
		return this.chosen;
	}

	/** Loops the building chosen, in the next of the four hands, so no two selections match. */
	public set chosenBuilding(id: BuildingId | null) {
		if (id === this.chosen) return;
		this.chosen = id;
		if (this.loopMark) this.hand.remove(this.loopMark);
		this.loopMark = null;
		for (const spot of this.spots) spot.selected = spot.building === id;
		if (id === null) return;
		this.loopMark = this.hand.loop(this.loopFrame, { variant: (this.loops % 4) as HandMarkVariant });
		this.invalidateLayout();
		this.loops += 1;
	}

	public get loop(): HandMark | null {
		return this.loopMark;
	}

	public get handLayer(): HandMarkLayer {
		return this.hand;
	}

	/** Whether a building stands, which draws its roof or its staked-out plot, and the state line under its name. */
	public setBuilt({ building, built, state }: { building: BuildingId; built: boolean; state: string }): void {
		if (built) this.built.add(building);
		else this.built.delete(building);
		this.spot(building).setState({ built, text: state });
		this.invalidateLayout();
	}

	/** Whether the rig and the bike are parked inside the gate: not while they're out on a run. */
	public get parked(): boolean {
		return this.vehiclesHome;
	}

	public set parked(parked: boolean) {
		this.vehiclesHome = parked;
	}

	public isBuilt(building: BuildingId): boolean {
		return this.built.has(building);
	}

	public get drawnText(): readonly string[] {
		return [this.gateText.name, this.gateText.road];
	}

	/** What the loop goes round, for a test or the inspector. */
	public get loopBounds(): Readonly<Rect> {
		return this.loopFrame.screenBounds;
	}

	public flows(child: Component): boolean {
		return !this.placesItself(child) && super.flows(child);
	}

	protected anchorsChild(child: Component): boolean {
		return super.anchorsChild(child) && !this.placesItself(child);
	}

	private placesItself(child: Component): boolean {
		return child === this.loopFrame || this.spots.includes(child as BuildingSpot);
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
		this.halo = paperHalo(this.inks);
		this.hatchInk = hatchInk(theme);
		this.dashInk = withAlpha(this.inks.highway, ROAD_DASH.alpha);
	}

	protected get cullInk(): Rect | null {
		return this.drawnInk;
	}

	protected layoutChildren(): void {
		super.layoutChildren();
		const { width, height } = this;
		const scale = Math.max(0.01, Math.min(width / PLATE.width, height / PLATE.height));
		const ox = (width - PLATE.width * scale) / 2;
		const oy = (height - PLATE.height * scale) / 2;
		this.fitScale = scale;
		this.fit[0] = scale;
		this.fit[3] = scale;
		this.fit[4] = ox;
		this.fit[5] = oy;
		this.labelScale = Math.max(LABEL_SCALE_MIN, Math.min(1, scale));
		setRect(this.ground, -ox / scale, -oy / scale, width / scale, height / scale);
		const east = this.ground.x + this.ground.width;
		const end = this.road[this.road.length - 1];
		end.x = Math.max(east, PLATE.width) + 30;
		end.y = 388;
		setRect(this.drawnInk, 0, 0, Math.max(width, ox + (end.x + ROAD_CASING / 2) * scale), height);
		this.placeDashes();
		for (const spot of this.spots) {
			const plot = PLOTS[spot.building];
			spot.scale = scale;
			spot.assignSize(Math.round(plot.width * scale), Math.round(plot.height * scale));
			spot.setPosition(Math.round(ox + plot.x * scale), Math.round(oy + plot.y * scale));
		}
		this.placeMarks(ox, oy, scale);
		this.placeLoop();
	}

	/** The loop frame round the chosen building's roof and label, spread to clear both. */
	private placeLoop(): void {
		const id = this.chosen;
		if (id === null) return;
		const spot = this.spot(id);
		const label = spot.labelBox;
		const left = spot.x + Math.min(0, label.x);
		const top = spot.y + Math.min(0, label.y);
		const right = spot.x + Math.max(spot.width, label.x + label.width);
		const bottom = spot.y + Math.max(spot.height, label.y + label.height);
		const width = Math.max(0, (right - left) * LOOP_SPREAD - (LOOP_REACH - LOOP_MARGIN) * 2);
		const height = Math.max(0, (bottom - top) * LOOP_SPREAD - (LOOP_REACH - LOOP_MARGIN) * 2);
		this.loopFrame.assignSize(width, height);
		this.loopFrame.setPosition((left + right - width) / 2, (top + bottom - height) / 2);
	}

	public render(draw: DrawApi): void {
		draw.pushTransform(this.fit);
		this.drawGround(draw);
		this.drawFence(draw);
		for (const id of BUILDING_IDS) {
			if (this.built.has(id)) this.drawBuilt(draw, this.builtArt[id]);
			else this.drawPlot(draw, this.plotArt[id]);
		}
		this.drawBunkhouseYard(draw);
		this.drawTank(draw);
		if (this.vehiclesHome) this.drawVehicles(draw);
		draw.popTransform();
		this.drawMarks(draw);
	}

	private drawGround(draw: DrawApi): void {
		const inks = this.inks;
		draw.drawRect({ id: this.id ?? undefined, rect: this.ground, fill: ART.dirt });
		draw.drawPolygon({ points: DIRT_PATCHES.dark, fill: ART.dirtDark });
		draw.drawPolygon({ points: DIRT_PATCHES.light, fill: ART.dirtLight });
		for (const rut of RUTS) draw.drawPolyline({ points: rut, color: ART.ruts, width: 7, cap: 'round' });
		draw.drawPolyline({ points: this.road, color: inks.casing, width: ROAD_CASING });
		draw.drawPolyline({ points: this.road, color: ART.asphalt, width: 38 });
		if (this.dashCount > 0) draw.drawPolygon({ points: this.dashPoints, fill: this.dashInk });
	}

	private drawFence(draw: DrawApi): void {
		for (const run of FENCE_UNDER) draw.drawPolyline({ points: run, color: ART.fenceUnder, width: 12 });
		for (const run of FENCE_RUNS) draw.drawLine({ from: run.from, to: run.to, color: ART.scrap[run.scrap], width: 8 });
		for (const post of FENCE_POSTS) draw.drawRect({ rect: post, fill: ART.post });
		for (const post of GATE_POSTS) draw.drawRect({ rect: post, fill: ART.post });
		draw.drawLine({ from: GATE_LEAF[0], to: GATE_LEAF[1], color: ART.gateLeaf, width: 5 });
	}

	private drawBuilt(draw: DrawApi, art: BuiltArt): void {
		draw.drawRect({ rect: art.roof.base, fill: ART.tin.base, shadow: { color: ART.shadow, blur: 8, offset: SHADOW_OFFSET } });
		drawCorrugation(draw, art.roof);
		draw.drawRect({ rect: art.ridge, fill: ART.ridge });
		for (const patch of art.patches) drawCorrugation(draw, patch);
		for (const glass of art.glass) draw.drawRect({ rect: glass, fill: ART.glass });
		for (const mark of art.marks) draw.drawRect({ rect: mark, fill: ART.tyre });
		for (const [from, to] of art.wires) draw.drawLine({ from, to, color: ART.tyre, width: 1.5 });
		for (const bar of art.cross) draw.drawRect({ rect: bar, fill: this.inks.paper });
		draw.drawRect({ rect: art.roof.base, fill: CLEAR, border: { color: ART.roofEdge, width: 2, position: 'center' } });
	}

	private drawPlot(draw: DrawApi, art: PlotArt): void {
		draw.drawPolygon({ points: art.hatch, fill: this.hatchInk });
		if (art.wreck) {
			draw.drawPolygon({ points: art.wreck.points, indices: art.wreck.indices, fill: ART.wreck });
			draw.drawPolyline({ points: art.wreck.points, closed: true, color: ART.wreckEdge, width: 1.5 });
		}
		for (const tyre of art.tyres) draw.drawCircle({ center: tyre, radius: 12, fill: ART.tyre, border: { color: ART.tyreRim, width: 5, position: 'center' } });
		for (const crate of art.crates) draw.drawRect({ rect: crate, fill: ART.crate, border: { color: ART.crateEdge, width: 1.5, position: 'center' } });
		draw.drawPolygon({ points: art.string, fill: this.inks.paper });
		for (const stake of art.stakes) draw.drawRect({ rect: stake, fill: ART.stake });
	}

	/** The crates and the barrel by the bunkhouse's east wall, there whether or not it stands. */
	private drawBunkhouseYard(draw: DrawApi): void {
		draw.drawRect({ rect: BUNKHOUSE_CRATES[0], fill: ART.crate });
		draw.drawRect({ rect: BUNKHOUSE_CRATES[1], fill: ART.crate });
		draw.drawCircle({ center: BARREL, radius: 11, fill: ART.tyre, border: { color: ART.tyreRim, width: 5, position: 'center' } });
	}

	private drawTank(draw: DrawApi): void {
		draw.drawCircle({ center: TANK_SHADOW, radius: TANK.radius, fill: ART.softShadow });
		draw.drawCircle({ center: TANK.at, radius: TANK.radius, fill: ART.tank, border: { color: ART.tankRim, width: TANK.rim, position: 'center' } });
		draw.drawCircle({ center: TANK.at, radius: TANK.hub, fill: ART.tankRim });
	}

	private drawVehicles(draw: DrawApi): void {
		const inks = this.inks;
		const rig = this.rigParts;
		draw.pushTransform(RIG_MATRIX);
		draw.drawRect({ rect: rig.shadow, fill: ART.shadow });
		draw.drawRect({ rect: rig.body, fill: ART.rig.body, radius: RIG_RADIUS, border: { color: ART.rig.edge, width: 2, position: 'center' } });
		draw.drawRect({ rect: rig.cab, fill: ART.rig.cab, radius: CAB_RADIUS });
		draw.drawRect({ rect: rig.bed, fill: ART.rig.bed });
		for (const [from, to] of rig.lights) draw.drawLine({ from, to, color: inks.drivers.a.fill, width: 3 });
		draw.popTransform();
		const bike = this.bikeParts;
		draw.pushTransform(BIKE_MATRIX);
		draw.drawRect({ rect: bike.shadow, fill: ART.softShadow });
		draw.drawRect({ rect: bike.body, fill: ART.bike.body, radius: BIKE_RADIUS, border: { color: ART.bike.edge, width: 2, position: 'center' } });
		for (const [from, to] of bike.bars) draw.drawLine({ from, to, color: inks.drivers.b.fill, width: 2 });
		draw.popTransform();
	}

	/** The north arrow at the top right, the scale bar at the bottom left, and the gate's labels, at the labels' scale. */
	private drawMarks(draw: DrawApi): void {
		const inks = this.inks;
		draw.drawPolygon({ points: this.north, indices: NORTH_INDICES, fill: inks.ink });
		draw.drawPolyline({ points: this.north, closed: true, color: inks.paper, width: 1.4 });
		draw.drawRect({ rect: this.scaleBar[0], fill: inks.ink });
		draw.drawRect({ rect: this.scaleBar[1], fill: inks.paper, border: { color: inks.ink, width: 1, position: 'inside' } });
		draw.drawRect({ rect: this.scaleBar[2], fill: inks.ink });
		const halo = this.halo;
		const scale = this.labelScale;
		draw.drawText({ text: this.gateText.name, position: this.gateName, font: DISPLAY_BOLD, size: 20 * scale, color: inks.ink, shadow: halo, wrap: 'none' });
		draw.drawRect({ rect: this.roadTag, fill: inks.paper });
		draw.drawText({ text: this.gateText.road, position: this.roadName, font: 'mono', size: this.roadSize, color: inks.ink, wrap: 'none' });
	}

	/** The centre dashes along the road, 18 on and 16 off from x 720, each a quad across its stretch of the line. */
	private placeDashes(): void {
		const road = this.road;
		let along = 0;
		let count = 0;
		let start = Number.NaN;
		const period = ROAD_DASH.on + ROAD_DASH.off;
		const half = ROAD_DASH.width / 2;
		for (let index = 1; index < road.length && count < MAX_DASHES; index++) {
			const from = road[index - 1];
			const to = road[index];
			const length = Math.hypot(to.x - from.x, to.y - from.y);
			if (length === 0) continue;
			const ux = (to.x - from.x) / length;
			const uy = (to.y - from.y) / length;
			for (let t = 0; t < length && count < MAX_DASHES; t += 1) {
				const x = from.x + ux * t;
				const phase = (along + t) % period;
				if (x < 720) continue;
				if (phase < ROAD_DASH.on && Number.isNaN(start)) start = t;
				const ending = phase >= ROAD_DASH.on - 1 || t + 1 >= length;
				if (!Number.isNaN(start) && ending) {
					const base = count * 6;
					const ax = from.x + ux * start;
					const ay = from.y + uy * start;
					const bx = from.x + ux * (t + 1);
					const by = from.y + uy * (t + 1);
					const nx = -uy * half;
					const ny = ux * half;
					set(this.dashes[base], ax + nx, ay + ny);
					set(this.dashes[base + 1], bx + nx, by + ny);
					set(this.dashes[base + 2], bx - nx, by - ny);
					set(this.dashes[base + 3], ax + nx, ay + ny);
					set(this.dashes[base + 4], bx - nx, by - ny);
					set(this.dashes[base + 5], ax - nx, ay - ny);
					count += 1;
					start = Number.NaN;
				}
			}
			along += length;
		}
		this.dashCount = count;
		this.dashPoints.length = 0;
		for (let index = 0; index < count * 6; index++) this.dashPoints.push(this.dashes[index]);
	}

	private get roadSize(): number {
		return Math.max(MONO_MIN, 13 * this.labelScale);
	}

	private placeMarks(ox: number, oy: number, scale: number): void {
		const label = this.labelScale;
		const { width, height } = this;
		const nx = width - 40 * label;
		const ny = Math.max(oy, 0) + 50 * label;
		NORTH.forEach((point, index) => set(this.north[index], nx + point.x * label, ny + point.y * label));
		const bx = Math.max(ox, 0) + 30 * label;
		const by = height - 16 * label;
		this.scaleBar.forEach((segment, index) => setRect(segment, bx + index * 36 * label, by, 36 * label, 7 * label));
		set(this.gateName, ox + 752 * scale, oy + 352 * scale);
		const roadSize = this.roadSize;
		const roadWidth = this.gateText.road.length * MONO_ADVANCE * roadSize;
		set(this.roadName, Math.min(ox + 752 * scale, width - 8 - TAG_PAD - roadWidth), oy + 428 * scale + roadSize);
		setRect(this.roadTag, this.roadName.x - TAG_PAD, this.roadName.y - roadSize * 0.82 - TAG_PAD / 2, roadWidth + TAG_PAD * 2, roadSize + TAG_PAD);
	}
}

const BUNKHOUSE_CRATES: readonly Rect[] = [{ x: 400, y: 190, width: 18, height: 18 }, { x: 402, y: 214, width: 18, height: 18 }];
const BARREL = p(432, 140);
const TANK_SHADOW = p(TANK.at.x + 8, TANK.at.y + 8);
const RIG_RADIUS = 4;
const CAB_RADIUS = 3;
const BIKE_RADIUS = 5;

/** Labels on art take a paper halo: the shadow run in paper at no offset (UI Art Direction, Type; R6.6). */
function paperHalo(inks: AtlasInks): TextShadow {
	return { color: inks.paper, blur: LABEL.halo };
}

function withAlpha([r, g, b]: RGBA, alpha: number): RGBA {
	return [r, g, b, alpha];
}

function hatchInk(theme: Theme): RGBA {
	const [r, g, b] = theme.color.hatch_rust;
	return [r, g, b, HATCH.alpha];
}

function set(point: Vec2, x: number, y: number): void {
	point.x = x;
	point.y = y;
}

function setRect(rect: Rect, x: number, y: number, width: number, height: number): void {
	rect.x = x;
	rect.y = y;
	rect.width = Math.max(0, width);
	rect.height = Math.max(0, height);
}
