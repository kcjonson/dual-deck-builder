import { Component, ComponentOptions } from '../../../engine/components/Component';
import type { SizeMode } from '../../../engine/components/layoutTypes';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Vec2 } from '../../../engine/draw/geometry';
import type { Theme } from '../../../engine/theme/tokens';
import type { StopType } from '../../map/StopData';
import { AtlasInks, atlasInks } from '../../ui/atlas/atlasStyle';

/**
 * The stand-in for an event's plate art until the illustrations are
 * painted (Game Flow 5.2): drawn top-down in the atlas's own hand, lit from
 * the north-west like the map, so a placeholder still reads as a plate. A
 * road crosses the plate on its casing, and on it the stop's scene: a wreck
 * across the lanes, or for a distress signal a vehicle on its side off the
 * road with people by it and the signal's rings in stronghold red. Contour
 * lines fill the ground. Everything is placed from the plate's size, so it
 * fits any crop. Grease pencil stays the player's (UI Art Direction, The
 * hand), so nothing here is drawn in it.
 */

const CONTOURS = 7;
const CONTOUR_STEPS = 24;
const ROAD_CASING = 36;
const ROAD_FILL = 28;
const VEHICLE = { length: 92, width: 40 };
const RINGS = [18, 30, 42];
const PEOPLE = 3;
const INK_SLACK = 24;
/** The plate the scene's sizes are drawn for; a smaller one scales them down. */
const DESIGN_SIDE = 320;

interface Shape {
	points: Vec2[];
	closed: boolean;
	color: 'ink' | 'faint' | 'signal';
	width: number;
}

export class EventPlate extends Component {
	public readonly stopType: StopType;
	private inks: AtlasInks;
	private colors: Record<Shape['color'], RGBA>;
	private readonly box = { x: 0, y: 0, width: 0, height: 0 };
	private shapes: Shape[] = [];
	private circles: { center: Vec2; radius: number; fill: boolean }[] = [];
	/** The road's casing and fill as triangle lists, cut at the plate's sides so nothing draws past it. */
	private casing: Vec2[] = [];
	private road: Vec2[] = [];

	constructor({ stopType, ...options }: ComponentOptions & { stopType: StopType }) {
		super(options);
		this.componentType = 'EventPlate';
		this.stopType = stopType;
		this.inks = atlasInks(this.themeTokens);
		this.colors = colorsOf(this.inks);
	}

	protected defaultSizeMode(size: number | undefined): SizeMode {
		return size !== undefined && size > 0 ? 'fixed' : 'fill';
	}

	/** The scene is placed from the plate's size and kept on it, but a hand loop or ring can graze an edge; the plate's art box clips it. */
	public get inkExtent(): number {
		return INK_SLACK;
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
		this.colors = colorsOf(this.inks);
	}

	protected layoutChildren(): void {
		this.build();
	}

	public render(draw: DrawApi): void {
		const inks = this.inks;
		draw.drawRect({ id: this.id ?? undefined, rect: this.box, fill: inks.paper });
		draw.drawPolygon({ points: this.casing, fill: inks.casing });
		draw.drawPolygon({ points: this.road, fill: inks.highway });
		for (const shape of this.shapes) draw.drawPolyline({ points: shape.points, closed: shape.closed, color: this.colors[shape.color], width: shape.width, cap: 'round' });
		for (const { center, radius, fill } of this.circles) {
			draw.drawCircle({ center, radius, fill: fill ? inks.ink : CLEAR, border: { color: inks.ink, width: 1.4, position: 'center' } });
		}
	}

	private build(): void {
		const { width, height } = this;
		this.box.width = width;
		this.box.height = height;
		this.shapes = [];
		this.circles = [];
		if (width <= 0 || height <= 0) return;
		for (let line = 1; line <= CONTOURS; line += 1) {
			const base = (height * line) / (CONTOURS + 1);
			const points: Vec2[] = [];
			for (let step = 0; step <= CONTOUR_STEPS; step += 1) {
				const x = (width * step) / CONTOUR_STEPS;
				points.push({ x, y: base + Math.sin(step * 0.55 + line * 1.7) * height * 0.035 });
			}
			this.shapes.push({ points, closed: false, color: 'faint', width: 1 });
		}
		// The road, lower left to upper right, across the whole plate.
		const from = { x: 0, y: height * 0.82 };
		const to = { x: width, y: height * 0.3 };
		this.casing = band(from, to, ROAD_CASING);
		this.road = band(from, to, ROAD_FILL);
		const angle = Math.atan2(to.y - from.y, to.x - from.x);
		const middle = { x: width * 0.5, y: (from.y + to.y) / 2 };
		const scale = Math.min(1, Math.min(width, height) / DESIGN_SIDE);
		if (this.stopType === 'distress') this.distress(middle, angle, scale);
		else this.wreck(middle, angle, scale);
	}

	/** Across both lanes, turned off the road's line, with its burnt-out cross. */
	private wreck(at: Vec2, roadAngle: number, scale: number): void {
		const body = box(at, roadAngle + 1.1, VEHICLE.length * scale, VEHICLE.width * scale);
		this.shapes.push({ points: body, closed: true, color: 'ink', width: 2.4 });
		this.shapes.push({ points: [body[0], body[2]], closed: false, color: 'ink', width: 1.2 });
		this.shapes.push({ points: [body[1], body[3]], closed: false, color: 'ink', width: 1.2 });
	}

	/** On its side off the road, its people beside it, and the signal going out. */
	private distress(road: Vec2, roadAngle: number, scale: number): void {
		const normal = { x: Math.sin(roadAngle), y: -Math.cos(roadAngle) };
		const off = 70 * scale;
		const at = { x: road.x + normal.x * off, y: road.y + normal.y * off };
		const body = box(at, roadAngle + 0.4, VEHICLE.length * 0.85 * scale, VEHICLE.width * 0.85 * scale);
		this.shapes.push({ points: body, closed: true, color: 'ink', width: 2.4 });
		for (let person = 0; person < PEOPLE; person += 1) {
			this.circles.push({ center: { x: at.x + (person * 14 - 30) * scale, y: at.y + VEHICLE.width * 0.9 * scale }, radius: 4 * scale, fill: true });
		}
		for (const radius of RINGS) this.shapes.push({ points: arc(at, (radius + VEHICLE.length * 0.4) * scale, -2.4, -0.8), closed: false, color: 'signal', width: 1.8 });
	}
}

/** A band `width` wide along the line from `from` to `to`, cut square to the x axis at both ends, as two triangles. */
function band(from: Vec2, to: Vec2, width: number): Vec2[] {
	const half = width / 2 / Math.cos(Math.atan2(to.y - from.y, to.x - from.x));
	const a = { x: from.x, y: from.y - half };
	const b = { x: to.x, y: to.y - half };
	const c = { x: to.x, y: to.y + half };
	const d = { x: from.x, y: from.y + half };
	return [a, b, c, a, c, d];
}

/** A rectangle's corners about its centre, turned by `angle`. */
function box(center: Vec2, angle: number, length: number, width: number): Vec2[] {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({
		x: center.x + (u * length * cos) / 2 - (v * width * sin) / 2,
		y: center.y + (u * length * sin) / 2 + (v * width * cos) / 2,
	}));
}

function arc(center: Vec2, radius: number, start: number, end: number): Vec2[] {
	const steps = 12;
	return Array.from({ length: steps + 1 }, (_unused, step) => {
		const turn = start + ((end - start) * step) / steps;
		return { x: center.x + Math.cos(turn) * radius, y: center.y + Math.sin(turn) * radius };
	});
}

const CLEAR: RGBA = [0, 0, 0, 0];

function colorsOf(inks: AtlasInks): Record<Shape['color'], RGBA> {
	return { ink: inks.ink, faint: [inks.ink[0], inks.ink[1], inks.ink[2], 0.14], signal: inks.stronghold };
}
