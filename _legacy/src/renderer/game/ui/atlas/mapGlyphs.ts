import { Component, ComponentOptions } from '../../../engine/components/Component';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Rect, Vec2 } from '../../../engine/draw/geometry';
import { triangulatePolygon } from '../../../engine/draw/triangulate';
import type { Theme } from '../../../engine/theme/tokens';
import { AtlasInks, DISPLAY_BOLD, atlasInks } from './atlasStyle';

/**
 * The map's markers and counters (UI Art Direction, Components): a circled
 * number or letter for places and numbered items, the highway shield for
 * counters and the primary row, the stronghold diamond for anything hostile,
 * the star for home, and the legend's open ring and dashed line.
 */
export type MapGlyphKind = 'circled' | 'shield' | 'diamond' | 'star' | 'ring' | 'dash';

/** `highway` is the orange shield on its casing; `paper` is a paper shield in casing ink, for one set on the highway. */
export type ShieldTone = 'highway' | 'paper';

export interface GlyphPaint {
	fill: RGBA;
	stroke: RGBA;
	text: RGBA;
}

const CLEAR: RGBA = [0, 0, 0, 0];

/** The shield's outline from the canvas (`M3 7 Q23 0 43 7 L43 26 Q43 42 23 49 Q3 42 3 26 Z`), in a 40 by 49 box. */
const SHIELD_W = 40;
const SHIELD_H = 49;
const SHIELD_OUTLINE: readonly Vec2[] = (() => {
	const points: Vec2[] = [];
	const quad = (from: Vec2, control: Vec2, to: Vec2, steps: number): void => {
		for (let step = 1; step <= steps; step++) {
			const t = step / steps;
			const a = (1 - t) * (1 - t);
			const b = 2 * (1 - t) * t;
			const c = t * t;
			points.push({ x: a * from.x + b * control.x + c * to.x, y: a * from.y + b * control.y + c * to.y });
		}
	};
	const at = (x: number, y: number): Vec2 => ({ x: x - 3, y });
	points.push(at(3, 7));
	quad(at(3, 7), at(23, 0), at(43, 7), 8);
	points.push(at(43, 26));
	quad(at(43, 26), at(43, 42), at(23, 49), 8);
	quad(at(23, 49), at(3, 42), at(3, 26), 8);
	return points.map((point) => ({ x: point.x / SHIELD_W, y: point.y / SHIELD_H }));
})();

/** A five-pointed star about its centre, outer radius 1, the inner points at the map's ratio. */
const STAR_OUTLINE: readonly Vec2[] = (() => {
	const points: Vec2[] = [];
	for (let index = 0; index < 10; index++) {
		const radius = index % 2 === 0 ? 1 : 0.42;
		const angle = -Math.PI / 2 + (index * Math.PI) / 5;
		points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
	}
	return points;
})();

/** A fan from point 0, for a convex outline. */
function fanIndices(count: number): number[] {
	const indices: number[] = [];
	for (let index = 1; index < count - 1; index++) indices.push(0, index, index + 1);
	return indices;
}

const SHIELD_INDICES = fanIndices(SHIELD_OUTLINE.length);
/** The star is concave, so it is cut by the engine's triangulator (R5.17 wants one outline covered once). */
const STAR_INDICES = triangulatePolygon(STAR_OUTLINE);
const DIAMOND_INDICES = fanIndices(4);

/** A glyph's width at `size`, its height: the shield is taller than wide, the rest square. */
export function glyphWidth(kind: MapGlyphKind, size: number): number {
	return kind === 'shield' ? Math.round((size * SHIELD_W) / SHIELD_H) : size;
}

/** A glyph's box at `size` on its long side. Allocates; for construction and layout. */
export function glyphBox(kind: MapGlyphKind, size: number): { width: number; height: number } {
	return { width: glyphWidth(kind, size), height: size };
}

/** The paint a glyph takes from the inks: `faded` prints it all in faded print (a row that cannot be taken). */
export function glyphPaint(kind: MapGlyphKind, inks: AtlasInks, { tone = 'highway', faded = false }: { tone?: ShieldTone; faded?: boolean } = {}): GlyphPaint {
	if (faded) return { fill: kind === 'shield' || kind === 'circled' ? inks.freshPaper : inks.fadedPrint, stroke: inks.fadedPrint, text: inks.fadedPrint };
	switch (kind) {
		case 'circled':
			return { fill: inks.freshPaper, stroke: inks.ink, text: inks.ink };
		case 'shield':
			return tone === 'highway'
				? { fill: inks.highway, stroke: inks.casing, text: inks.highwayLabel }
				: { fill: inks.highwayLabel, stroke: inks.casing, text: inks.casing };
		case 'diamond':
			return { fill: inks.stronghold, stroke: CLEAR, text: CLEAR };
		case 'star':
			return { fill: inks.ink, stroke: inks.freshPaper, text: CLEAR };
		case 'ring':
			return { fill: CLEAR, stroke: inks.ink, text: CLEAR };
		case 'dash':
			return { fill: CLEAR, stroke: inks.fadedPrint, text: CLEAR };
	}
}

/**
 * One glyph's geometry, placed in its owner's local space at layout so a
 * frame draws it without building anything. `draw` takes the paint and the
 * label (a number or letter, drawn in display 700) or the shield's arrow.
 */
export class MapGlyphGeometry {
	public readonly kind: MapGlyphKind;
	private readonly points: Vec2[];
	private readonly indices: readonly number[];
	private readonly labelBox: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly arrowShaft: Vec2[] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
	private readonly arrowHead: Vec2[] = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
	private readonly dashes: Rect[] = [];
	private readonly centre: Vec2 = { x: 0, y: 0 };
	private radius = 0;
	private stroke = 0;
	private labelSize = 0;

	constructor(kind: MapGlyphKind) {
		this.kind = kind;
		const count = kind === 'shield' ? SHIELD_OUTLINE.length : kind === 'star' ? STAR_OUTLINE.length : kind === 'diamond' ? 4 : 0;
		this.points = Array.from({ length: count }, () => ({ x: 0, y: 0 }));
		this.indices = kind === 'shield' ? SHIELD_INDICES : kind === 'star' ? STAR_INDICES : kind === 'diamond' ? DIAMOND_INDICES : [];
		if (kind === 'dash') for (let index = 0; index < 2; index++) this.dashes.push({ x: 0, y: 0, width: 0, height: 0 });
	}

	/** The glyph in the box at (`x`, `y`) of `glyphBox(kind, size)`. */
	public place(x: number, y: number, size: number): void {
		const width = glyphWidth(this.kind, size);
		const height = size;
		const cx = x + width / 2;
		const cy = y + height / 2;
		this.centre.x = cx;
		this.centre.y = cy;
		switch (this.kind) {
			case 'circled':
				this.stroke = Math.max(1.6, size * 0.07);
				this.radius = size / 2 - this.stroke / 2;
				this.labelSize = Math.round(size * 0.6);
				break;
			case 'shield':
				this.stroke = Math.max(1.6, size * 0.06);
				for (let index = 0; index < SHIELD_OUTLINE.length; index++) {
					this.points[index].x = x + SHIELD_OUTLINE[index].x * width;
					this.points[index].y = y + SHIELD_OUTLINE[index].y * height;
				}
				this.labelSize = Math.round(size * 0.45);
				this.placeArrow(x, y, width, height);
				break;
			case 'diamond': {
				const half = size * 0.4;
				// Top, right, bottom, left.
				for (let index = 0; index < 4; index++) {
					this.points[index].x = cx + (index === 1 ? half : index === 3 ? -half : 0);
					this.points[index].y = cy + (index === 0 ? -half : index === 2 ? half : 0);
				}
				break;
			}
			case 'star': {
				const outer = size / 2 - 1;
				for (let index = 0; index < STAR_OUTLINE.length; index++) {
					this.points[index].x = cx + STAR_OUTLINE[index].x * outer;
					this.points[index].y = cy + STAR_OUTLINE[index].y * outer;
				}
				this.stroke = Math.max(1, size * 0.06);
				break;
			}
			case 'ring':
				this.stroke = 1.6;
				this.radius = size * 0.36;
				break;
			case 'dash': {
				// The canvas's `M2 7 H12` dashed 3 on 2, in a 14 px box.
				const left = x + size * 0.14;
				const dash = size * 0.22;
				for (let index = 0; index < this.dashes.length; index++) {
					const rect = this.dashes[index];
					rect.x = left + index * size * 0.36;
					rect.y = cy - 0.8;
					rect.width = dash;
					rect.height = 1.6;
				}
				break;
			}
		}
		// The label sits a little high in a shield, whose point takes the bottom third.
		const labelHeight = this.kind === 'shield' ? height * 0.8 : height;
		this.labelBox.x = x;
		this.labelBox.y = y;
		this.labelBox.width = width;
		this.labelBox.height = labelHeight;
	}

	public draw(draw: DrawApi, paint: GlyphPaint, label: string | null = null, arrow = false): void {
		switch (this.kind) {
			case 'circled':
			case 'ring':
				draw.drawCircle({ center: this.centre, radius: this.radius, fill: paint.fill, border: { color: paint.stroke, width: this.stroke, position: 'center' } });
				break;
			case 'shield':
			case 'diamond':
				draw.drawPolygon({ points: this.points, indices: this.indices, fill: paint.fill });
				if (paint.stroke[3] > 0) draw.drawPolyline({ points: this.points, closed: true, color: paint.stroke, width: this.stroke });
				break;
			case 'star':
				draw.drawPolyline({ points: this.points, closed: true, color: paint.stroke, width: this.stroke * 2, cap: 'round' });
				draw.drawPolygon({ points: this.points, indices: this.indices, fill: paint.fill });
				break;
			case 'dash':
				for (const rect of this.dashes) draw.drawRect({ rect, fill: paint.stroke });
				break;
		}
		if (arrow && this.kind === 'shield') {
			draw.drawPolyline({ points: this.arrowShaft, color: paint.text, width: this.stroke * 1.3, cap: 'round' });
			draw.drawPolyline({ points: this.arrowHead, color: paint.text, width: this.stroke * 1.3, cap: 'round' });
		} else if (label) {
			draw.drawText({ text: label, box: this.labelBox, font: DISPLAY_BOLD, size: this.labelSize, color: paint.text, align: 'center', verticalAlign: 'middle', wrap: 'none' });
		}
	}

	/** The canvas's arrow (`M10 19 H23 M18 13 L24 19 L18 25` in a 34 by 38 shield), scaled to this one. */
	private placeArrow(x: number, y: number, width: number, height: number): void {
		const px = (value: number): number => x + ((value - 2) / 30) * width;
		const py = (value: number): number => y + (value / 38) * height;
		this.arrowShaft[0].x = px(10);
		this.arrowShaft[0].y = py(19);
		this.arrowShaft[1].x = px(23);
		this.arrowShaft[1].y = py(19);
		this.arrowHead[0].x = px(18);
		this.arrowHead[0].y = py(13);
		this.arrowHead[1].x = px(24);
		this.arrowHead[1].y = py(19);
		this.arrowHead[2].x = px(18);
		this.arrowHead[2].y = py(25);
	}
}

export interface MapGlyphOptions extends Omit<ComponentOptions, 'width' | 'height'> {
	kind: MapGlyphKind;
	/** The glyph's long side. Default 32, the contents page's circled number. */
	size?: number;
	/** A number or letter in a circle or shield. */
	label?: string;
	/** An arrow in a shield, for an action that goes somewhere. */
	arrow?: boolean;
	tone?: ShieldTone;
	faded?: boolean;
}

/** One map glyph as a component, for a legend, a list, or a plate label. */
export class MapGlyph extends Component {
	private readonly geometry: MapGlyphGeometry;
	private readonly glyphSize: number;
	private glyphLabel: string | null;
	private readonly arrow: boolean;
	private readonly tone: ShieldTone;
	private isFaded: boolean;
	private paint: GlyphPaint;

	constructor({ kind, size = 32, label, arrow = false, tone = 'highway', faded = false, ...options }: MapGlyphOptions) {
		const box = glyphBox(kind, size);
		super({ ...options, width: box.width, height: box.height });
		this.componentType = 'MapGlyph';
		this.geometry = new MapGlyphGeometry(kind);
		this.glyphSize = size;
		this.glyphLabel = label ?? null;
		this.arrow = arrow;
		this.tone = tone;
		this.isFaded = faded;
		this.paint = glyphPaint(kind, atlasInks(this.themeTokens), { tone, faded });
		this.geometry.place(0, 0, size);
	}

	public get kind(): MapGlyphKind {
		return this.geometry.kind;
	}

	public get label(): string | null {
		return this.glyphLabel;
	}

	public set label(label: string | null) {
		this.glyphLabel = label;
	}

	public get faded(): boolean {
		return this.isFaded;
	}

	public set faded(faded: boolean) {
		if (faded === this.isFaded) return;
		this.isFaded = faded;
		this.paint = glyphPaint(this.kind, atlasInks(this.themeTokens), { tone: this.tone, faded });
	}

	/** The paint drawn now, for a test or the inspector. */
	public get glyphColors(): GlyphPaint {
		return this.paint;
	}

	public get drawnText(): readonly string[] | null {
		return this.glyphLabel ? [this.glyphLabel] : null;
	}

	/** The star's paper halo and the centred strokes reach past the box by half a stroke. */
	public get inkExtent(): number {
		return Math.ceil(this.glyphSize * 0.06) + 1;
	}

	protected onThemeChange(theme: Theme): void {
		this.paint = glyphPaint(this.kind, atlasInks(theme), { tone: this.tone, faded: this.isFaded });
	}

	public render(draw: DrawApi): void {
		this.geometry.draw(draw, this.paint, this.glyphLabel, this.arrow);
	}
}
