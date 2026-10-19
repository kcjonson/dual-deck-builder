import { Component, ComponentOptions } from '../../../engine/components/Component';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { Rect } from '../../../engine/draw/geometry';
import type { Theme } from '../../../engine/theme/tokens';
import { ATLAS, AtlasInks, Driver, atlasInks } from './atlasStyle';

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function setRect(rect: Rect, x: number, y: number, width: number, height: number): void {
	rect.x = x;
	rect.y = y;
	rect.width = Math.max(0, width);
	rect.height = Math.max(0, height);
}

/** `ink` fills in ink in an ink frame; `highway` fills in Highway in a Casing frame, as the splash's loader does. */
export type ScaleTone = 'ink' | 'highway';

export interface ScaleBarOptions extends ComponentOptions {
	/** Default 5. */
	segments?: number;
	/**
	 * Absent, the map's scale bar: alternating ink and paper. Given (0 to 1),
	 * a count: that share of the segments filled from the left, the rest paper.
	 */
	value?: number | null;
	tone?: ScaleTone;
	/** The frame's weight. Default the scale bar's 1.2 px; the splash's loader is 2. */
	frame?: number;
}

/**
 * The scale bar, the gauge for stores and other countable supplies (UI Art
 * Direction, Components): segments in a 1.2 px frame, alternating ink and
 * paper as a map's scale does, or filling from the left as a count.
 */
export class ScaleBar extends Component {
	private readonly segmentCount: number;
	private amount: number | null;
	private readonly tone: ScaleTone;
	private readonly frameWidth: number;
	private inks: AtlasInks;
	private readonly frame: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly cells: Rect[];
	private readonly seams: Rect[];

	constructor({ segments = 5, value = null, tone = 'ink', frame = ATLAS.scaleFrame, height = 8, width = segments * 32, ...options }: ScaleBarOptions = {}) {
		super({ ...options, width, height });
		this.componentType = 'ScaleBar';
		this.segmentCount = Math.max(1, Math.round(segments));
		this.amount = value === null ? null : clamp01(value);
		this.tone = tone;
		this.frameWidth = frame;
		this.inks = atlasInks(this.themeTokens);
		this.cells = Array.from({ length: this.segmentCount }, () => ({ x: 0, y: 0, width: 0, height: 0 }));
		this.seams = Array.from({ length: this.segmentCount - 1 }, () => ({ x: 0, y: 0, width: 0, height: 0 }));
	}

	public get segments(): number {
		return this.segmentCount;
	}

	public get value(): number | null {
		return this.amount;
	}

	public set value(value: number | null) {
		this.amount = value === null ? null : clamp01(value);
	}

	/** Segments filled: every other one for a scale, the value's share for a count. */
	public get filled(): number {
		return this.amount === null ? Math.ceil(this.segmentCount / 2) : Math.round(this.amount * this.segmentCount);
	}

	/** Whether segment `index` is drawn in the fill colour rather than paper. */
	public isFilled(index: number): boolean {
		if (this.amount === null) return index % 2 === 0;
		return index < Math.round(this.amount * this.segmentCount);
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
	}

	protected layoutChildren(): void {
		const { width, height } = this;
		const edge = this.frameWidth;
		setRect(this.frame, 0, 0, width, height);
		const inner = width - edge * 2;
		const step = inner / this.segmentCount;
		this.cells.forEach((cell, index) => setRect(cell, edge + index * step, edge, step, height - edge * 2));
		this.seams.forEach((seam, index) => setRect(seam, edge + (index + 1) * step - 0.5, edge, 1, height - edge * 2));
	}

	public render(draw: DrawApi): void {
		const inks = this.inks;
		const fill = this.tone === 'highway' ? inks.highway : inks.ink;
		const frame = this.tone === 'highway' ? inks.casing : inks.ink;
		draw.drawRect({ id: this.id ?? undefined, rect: this.frame, fill: inks.paper, border: { color: frame, width: this.frameWidth } });
		for (let index = 0; index < this.cells.length; index++) {
			if (this.isFilled(index)) draw.drawRect({ rect: this.cells[index], fill });
		}
		if (this.amount !== null) for (const seam of this.seams) draw.drawRect({ rect: seam, fill: frame });
	}
}

export interface CasedBarOptions extends ComponentOptions {
	/** 0 to 1. */
	value: number;
	driver?: Driver;
}

/** The casing's share of the bar's height on each side. */
const CASING_SHARE = 0.2;

/**
 * The cased bar, the gauge for continuous values (UI Art Direction,
 * Components): a road drawn as the map draws one, the driver's colour on its
 * casing, filled to the value over a paper track.
 */
export class CasedBar extends Component {
	public readonly driver: Driver;
	private amount: number;
	private inks: AtlasInks;
	private readonly casing: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly track: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly fill: Rect = { x: 0, y: 0, width: 0, height: 0 };

	constructor({ value, driver = 'a', height = 12, width = 160, ...options }: CasedBarOptions) {
		super({ ...options, width, height });
		this.componentType = 'CasedBar';
		this.driver = driver;
		this.amount = clamp01(value);
		this.inks = atlasInks(this.themeTokens);
	}

	public get value(): number {
		return this.amount;
	}

	public set value(value: number) {
		this.amount = clamp01(value);
		this.placeFill();
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
	}

	protected layoutChildren(): void {
		const { width, height } = this;
		const edge = Math.max(1, Math.round(height * CASING_SHARE));
		setRect(this.casing, 0, 0, width, height);
		setRect(this.track, edge, edge, width - edge * 2, height - edge * 2);
		this.placeFill();
	}

	public render(draw: DrawApi): void {
		const { fill, casing } = this.inks.drivers[this.driver];
		draw.drawRect({ id: this.id ?? undefined, rect: this.casing, fill: casing });
		draw.drawRect({ rect: this.track, fill: this.inks.paper });
		if (this.fill.width > 0) draw.drawRect({ rect: this.fill, fill });
	}

	private placeFill(): void {
		setRect(this.fill, this.track.x, this.track.y, this.track.width * this.amount, this.track.height);
	}
}
