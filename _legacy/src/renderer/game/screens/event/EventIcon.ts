import { Component, ComponentOptions } from '../../../engine/components/Component';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Rect, Vec2 } from '../../../engine/draw/geometry';
import type { Theme } from '../../../engine/theme/tokens';
import type { EventReward } from '../../campaign/Events';
import { RESOURCE_ICON_SIZE, ResourceKind, drawResourceIcon } from '../../ui/atlas/ResourceStrip';

/**
 * The event screen's risk and reward icons (Game Flow 5.2): the stores'
 * own icons, and stroke icons on the same 18 px grid for the rest, drawn
 * flat until the UI art atlas holds them. Crossed swords for a fight,
 * skulls for danger, a clock for hours, two cards, a truck for an escort,
 * a steering wheel for a driver, a wrench for repairs, a heart for HP.
 */
export type EventIconKind = ResourceKind | 'skull' | 'swords' | 'clock' | 'cards' | 'escort' | 'driver' | 'repair' | 'heal';

/** How an icon reads: ink, a cost or a danger (stronghold red), or a gain (sage ink). */
export type EventIconTone = 'ink' | 'cost' | 'gain';

export const EVENT_ICON_SIZE = RESOURCE_ICON_SIZE;
const STROKE = 1.6;
const CLEAR: RGBA = [0, 0, 0, 0];

interface Strokes {
	lines: ReadonlyArray<{ points: readonly Vec2[]; closed?: boolean }>;
	circles: ReadonlyArray<{ x: number; y: number; r: number }>;
}

const p = (x: number, y: number): Vec2 => ({ x, y });

const STROKES: Readonly<Record<Exclude<EventIconKind, ResourceKind>, Strokes>> = {
	skull: {
		lines: [
			{ points: [p(4, 9.5), p(3.8, 6.2), p(5.8, 3.2), p(9, 2.2), p(12.2, 3.2), p(14.2, 6.2), p(14, 9.5), p(12.4, 11.4), p(12.4, 14.6), p(5.6, 14.6), p(5.6, 11.4)], closed: true },
			{ points: [p(7.6, 14.6), p(7.6, 16.6)] },
			{ points: [p(10.4, 14.6), p(10.4, 16.6)] },
		],
		circles: [{ x: 6.9, y: 8.4, r: 1.5 }, { x: 11.1, y: 8.4, r: 1.5 }],
	},
	swords: {
		lines: [
			{ points: [p(3, 3), p(12, 12)] }, { points: [p(10, 14), p(14, 10)] }, { points: [p(12, 12), p(15.5, 15.5)] },
			{ points: [p(15, 3), p(6, 12)] }, { points: [p(4, 10), p(8, 14)] }, { points: [p(6, 12), p(2.5, 15.5)] },
		],
		circles: [],
	},
	clock: { lines: [{ points: [p(9, 9), p(9, 4.5)] }, { points: [p(9, 9), p(12.2, 10.6)] }], circles: [{ x: 9, y: 9, r: 7 }] },
	cards: {
		lines: [
			{ points: [p(2.5, 5.5), p(10, 5.5), p(10, 16), p(2.5, 16)], closed: true },
			{ points: [p(7, 2), p(15.5, 2), p(15.5, 12.5), p(12.5, 12.5)] },
			{ points: [p(7, 2), p(7, 4)] },
		],
		circles: [],
	},
	escort: {
		lines: [
			{ points: [p(1.5, 5.5), p(10.5, 5.5), p(10.5, 13), p(1.5, 13)], closed: true },
			{ points: [p(10.5, 8), p(14, 8), p(16.5, 10.5), p(16.5, 13), p(10.5, 13)] },
		],
		circles: [{ x: 5, y: 14.5, r: 1.7 }, { x: 13.5, y: 14.5, r: 1.7 }],
	},
	driver: {
		lines: [{ points: [p(2, 9), p(7.2, 9)] }, { points: [p(10.8, 9), p(16, 9)] }, { points: [p(9, 10.8), p(9, 16)] }],
		circles: [{ x: 9, y: 9, r: 7 }, { x: 9, y: 9, r: 1.8 }],
	},
	repair: { lines: [{ points: [p(3, 15), p(10.2, 7.8)] }, { points: [p(11.2, 3.4), p(14.6, 6.8)] }], circles: [{ x: 12.2, y: 5.8, r: 3.2 }] },
	heal: {
		lines: [{ points: [p(9, 15.5), p(3.4, 9.8), p(2.8, 6.6), p(4.4, 3.9), p(7, 3.4), p(9, 5.4), p(11, 3.4), p(13.6, 3.9), p(15.2, 6.6), p(14.6, 9.8)], closed: true }],
		circles: [],
	},
};

const RESOURCE_KINDS: readonly string[] = ['food', 'water', 'fuel', 'scrap', 'meds', 'people'];

function isResource(kind: EventIconKind): kind is ResourceKind {
	return RESOURCE_KINDS.includes(kind);
}

/** The icon a reward shows as. */
export function rewardIcon(reward: EventReward): EventIconKind {
	switch (reward) {
		case 'settlers': return 'people';
		case 'drivers': return 'driver';
		default: return reward;
	}
}

/** The tint for a tone, from the theme's tokens. */
export function toneInk(theme: Theme, tone: EventIconTone): RGBA {
	const { color } = theme;
	return tone === 'cost' ? color.status_crit : tone === 'gain' ? color.status_ok : color.text;
}

/** An icon at `rect`'s corner, 18 px square, in `tint`. */
export function drawEventIcon(draw: DrawApi, { kind, rect, tint }: { kind: EventIconKind; rect: Rect; tint: RGBA }): void {
	if (isResource(kind)) {
		drawResourceIcon(draw, { kind, rect, tint });
		return;
	}
	const strokes = STROKES[kind];
	draw.pushTranslate(rect.x, rect.y);
	for (const line of strokes.lines) draw.drawPolyline({ points: line.points, closed: line.closed, color: tint, width: STROKE, cap: 'round' });
	for (const circle of strokes.circles) draw.drawCircle({ center: circle, radius: circle.r, fill: CLEAR, border: { color: tint, width: STROKE, position: 'center' } });
	draw.popTransform();
}

/** One icon as a component, for a row that flows. */
export class EventIcon extends Component {
	public readonly kind: EventIconKind;
	public readonly tone: EventIconTone;
	private tint: RGBA;
	private readonly rect: Rect = { x: 0, y: 0, width: EVENT_ICON_SIZE, height: EVENT_ICON_SIZE };

	constructor({ kind, tone = 'ink', ...options }: Omit<ComponentOptions, 'width' | 'height'> & { kind: EventIconKind; tone?: EventIconTone }) {
		super({ ...options, width: EVENT_ICON_SIZE, height: EVENT_ICON_SIZE });
		this.componentType = 'EventIcon';
		this.kind = kind;
		this.tone = tone;
		this.tint = toneInk(this.themeTokens, tone);
	}

	public get inkExtent(): number {
		return 1;
	}

	protected onThemeChange(theme: Theme): void {
		this.tint = toneInk(theme, this.tone);
	}

	public render(draw: DrawApi): void {
		drawEventIcon(draw, { kind: this.kind, rect: this.rect, tint: this.tint });
	}
}
