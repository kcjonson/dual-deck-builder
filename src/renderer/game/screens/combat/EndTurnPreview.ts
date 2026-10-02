import { Component, ComponentOptions, ResolvedColors } from '../../../engine/components/Component';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { DrawCircleOptions, DrawLineOptions, DrawRectOptions, DrawTextOptions } from '../../../engine/draw/commands';
import type { RGBA, Vec2 } from '../../../engine/draw/geometry';
import { resolveColor } from '../../../engine/style/styleObject';
import { EnemyIntent, IntentPill, intentDamage } from '../../ui/IntentPill';
import { TOKEN_WIDTH, Vehicle as VehicleUI } from '../../ui/Vehicle';
import { ROAD_HEADER_HEIGHT } from './CombatLayout';
import type { RoadView } from './RoadView';

/** The mock's preview lines: 2 wide, dashed 6 on and 5 off, at 80%, with a dot of 4 where they land. */
const LINE_WIDTH = 2;
const DASH = 6;
const DASH_GAP = 5;
const END_RADIUS = 4;
/** How far above the higher of its two ends a line arcs, held under the lane header. */
const LIFT = 20;
const HEADER_CLEARANCE = 4;
const CURVE_SAMPLES = 48;
const ATTACK_LINE: RGBA = resolveColor('rgba(255, 106, 85, 0.8)');
const OTHER_LINE: RGBA = resolveColor('rgba(201, 143, 240, 0.8)');

/**
 * The mock's `.predict`: 14 px display type, white on the raiders' red. It
 * sits in the top right of your token, in the band a raider's pills take,
 * so it stays inside the token's box and off the plate.
 */
const TOTAL_SIZE = 14;
const TOTAL_HEIGHT = 20;
const TOTAL_PAD_X = 5;
const TOTAL_TOP = 2;
/** Barlow Condensed's widest digit is 0.456 em; the chip is sized from it rather than measured. */
const TOTAL_ADVANCE = 0.46;
const TOTAL_FILL: RGBA = resolveColor('#d4513f');
const TOTAL_INK: RGBA = resolveColor('#ffffff');

/** What a vehicle stands to take: the damage the preview can see, and whether a hidden attack adds to it. */
export interface IncomingDamage {
	damage: number;
	hidden: boolean;
}

/**
 * Every attack in `plans` added up per vehicle it will land on, into `out`
 * (cleared first): an area hit counts on each vehicle it reaches, a
 * multi-hit every hit. An attack whose value the raider's tier hides adds
 * nothing it can show and marks the total as more than it says.
 */
export function incomingDamage(plans: Iterable<readonly EnemyIntent[]>, out: Map<string, IncomingDamage> = new Map()): Map<string, IncomingDamage> {
	out.clear();
	for (const plan of plans) {
		for (const intent of plan) {
			if (intent.type !== 'attack') continue;
			const damage = intentDamage(intent);
			for (const id of intent.targetIds ?? []) {
				const total = out.get(id) ?? { damage: 0, hidden: false };
				if (damage === null) total.hidden = true;
				else total.damage += damage;
				out.set(id, total);
			}
		}
	}
	return out;
}

/** The chip's text: "-14", "-14+?" with a hidden attack on top, "-?" when only hidden ones land. */
export function incomingLabel({ damage, hidden }: IncomingDamage): string | null {
	if (damage > 0) return hidden ? `-${damage}+?` : `-${damage}`;
	return hidden ? '-?' : null;
}

/**
 * The end-turn preview (Battle Screen Design section 6): while End Turn
 * has the pointer or keyboard focus on your turn, each raider intent draws
 * a dashed line from its pill to every vehicle it will land on, red for
 * an attack and purple for anything else, and each of your vehicles an
 * attack will reach shows the incoming total. The keyboard's way to read
 * the raiders' plan, since the pills themselves take no focus.
 *
 * Covers the road over its tokens, on the overlay layer, and never a
 * target. Everything is read from the road's tokens at paint time, so it
 * follows a swerve or a rescale with no bookkeeping, into buffers it
 * reuses; the totals are worked out when the plan changes (`refresh`).
 */
export class EndTurnPreview extends Component {
	private readonly road: RoadView;
	private readonly isPreviewing: () => boolean;
	/** The player's turn, with the dock unlocked; set by the screen. */
	public turnOpen = false;
	private readonly totals = new Map<string, IncomingDamage>();
	private readonly labels = new Map<string, string>();

	// Paint-time buffers
	private readonly from: Vec2 = { x: 0, y: 0 };
	private readonly to: Vec2 = { x: 0, y: 0 };
	private readonly local: Vec2 = { x: 0, y: 0 };
	private readonly corner: Vec2 = { x: 0, y: 0 };
	private readonly points: Vec2[] = Array.from({ length: CURVE_SAMPLES + 1 }, () => ({ x: 0, y: 0 }));
	private readonly distances = new Float64Array(CURVE_SAMPLES + 1);
	private readonly dash: DrawLineOptions & { from: Vec2; to: Vec2 } = { from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, color: ATTACK_LINE, width: LINE_WIDTH, cap: 'butt' };
	private readonly end: DrawCircleOptions & { center: Vec2 } = { center: { x: 0, y: 0 }, radius: END_RADIUS, fill: ATTACK_LINE };
	private readonly chip: DrawRectOptions & { rect: { x: number; y: number; width: number; height: number } } = { rect: { x: 0, y: 0, width: 0, height: 0 }, fill: TOTAL_FILL, radius: 2 };
	private readonly chipText: DrawTextOptions & { box: { x: number; y: number; width: number; height: number } } = {
		text: '',
		box: { x: 0, y: 0, width: 0, height: 0 },
		font: 'display',
		size: TOTAL_SIZE,
		color: TOTAL_INK,
		align: 'center',
		verticalAlign: 'middle',
		wrap: 'none',
	};

	constructor({ road, isPreviewing, ...options }: ComponentOptions & { road: RoadView; isPreviewing: () => boolean }) {
		super({ pointerEvents: 'none', layer: 'overlay', ...options });
		this.componentType = 'EndTurnPreview';
		this.road = road;
		this.isPreviewing = isPreviewing;
	}

	/** Showing now: End Turn has the pointer or keyboard focus, on your turn. */
	public get showing(): boolean {
		return this.turnOpen && this.isPreviewing();
	}

	/** What each vehicle stands to take, as the chips print it, by vehicle id. */
	public get incoming(): ReadonlyMap<string, string> {
		return this.labels;
	}

	/** The raiders' plans changed: work the totals out again. */
	public refresh(): void {
		incomingDamage(this.road.raiderViews.map((view) => view.intentsRow.planned), this.totals);
		this.labels.clear();
		for (const [id, total] of this.totals) {
			const label = incomingLabel(total);
			if (label) this.labels.set(id, label);
		}
	}

	public get resolvedColors(): ResolvedColors | null {
		return this.showing ? { fill: ATTACK_LINE } : null;
	}

	public get drawnText(): readonly string[] | null {
		return this.showing && this.labels.size > 0 ? [...this.labels.values()] : null;
	}

	public render(draw: DrawApi): void {
		const space = this.parent;
		if (!space || !this.showing) return;
		for (const raider of this.road.raiderViews) {
			if (!raider.isMounted || raider.isWrecked) continue;
			for (const pill of raider.intentsRow.pills) this.drawLinesFrom(draw, pill, space);
		}
		for (const [vehicleId, label] of this.labels) {
			const view = this.road.vehicleView(vehicleId);
			if (view?.isMounted && !view.isWrecked) this.drawTotal(draw, view, label, space);
		}
	}

	/** One line per vehicle each intent the pill stands for will land on, from the pill's centre to the top of that vehicle's plate. */
	private drawLinesFrom(draw: DrawApi, pill: IntentPill, space: Component): void {
		this.local.x = pill.width / 2;
		this.local.y = pill.height / 2;
		for (const intent of pill.represents) {
			const color = intent.type === 'attack' ? ATTACK_LINE : OTHER_LINE;
			for (const targetId of intent.targetIds ?? []) {
				const target = this.road.vehicleView(targetId);
				if (!target?.isMounted || target.isWrecked) continue;
				if (!this.mapIn(pill, this.local, space, this.from)) continue;
				const plate = target.plateRect;
				this.corner.x = plate.x + plate.width / 2;
				this.corner.y = plate.y;
				if (!this.mapIn(target, this.corner, space, this.to)) continue;
				this.drawCurve(draw, color);
			}
		}
	}

	/** Up from the pill, across, and down onto the plate: a cubic arcing over both ends, dashed along its length. */
	private drawCurve(draw: DrawApi, color: RGBA): void {
		const { from, to, points, distances } = this;
		const lift = Math.max(ROAD_HEADER_HEIGHT + HEADER_CLEARANCE, Math.min(from.y, to.y) - LIFT);
		for (let step = 0; step <= CURVE_SAMPLES; step++) {
			const t = step / CURVE_SAMPLES;
			const u = 1 - t;
			const a = u * u * u;
			const b = 3 * u * u * t;
			const c = 3 * u * t * t;
			const d = t * t * t;
			points[step].x = (a + b) * from.x + (c + d) * to.x;
			points[step].y = a * from.y + (b + c) * lift + d * to.y;
			distances[step] = step === 0 ? 0 : distances[step - 1] + Math.hypot(points[step].x - points[step - 1].x, points[step].y - points[step - 1].y);
		}
		const length = distances[CURVE_SAMPLES];
		this.dash.color = color;
		let segment = 1;
		for (let start = 0; start < length; start += DASH + DASH_GAP) {
			segment = this.pointAt(start, segment, this.dash.from);
			segment = this.pointAt(Math.min(length, start + DASH), segment, this.dash.to);
			draw.drawLine(this.dash);
		}
		this.end.center.x = to.x;
		this.end.center.y = to.y;
		this.end.fill = color;
		draw.drawCircle(this.end);
	}

	/** The point `distance` along the sampled curve, searching on from `segment`; returns the segment it was found in. */
	private pointAt(distance: number, segment: number, out: Vec2): number {
		const { points, distances } = this;
		while (segment < CURVE_SAMPLES && distances[segment] < distance) segment++;
		const a = points[segment - 1];
		const b = points[segment];
		const span = distances[segment] - distances[segment - 1];
		const t = span > 0 ? Math.min(1, Math.max(0, (distance - distances[segment - 1]) / span)) : 0;
		out.x = a.x + (b.x - a.x) * t;
		out.y = a.y + (b.y - a.y) * t;
		return segment;
	}

	/** The incoming total, right-aligned in the token's top band, at the token's scale. */
	private drawTotal(draw: DrawApi, view: VehicleUI, label: string, space: Component): void {
		const width = Math.ceil(label.length * TOTAL_SIZE * TOTAL_ADVANCE) + TOTAL_PAD_X * 2;
		this.corner.x = TOKEN_WIDTH - width;
		this.corner.y = TOTAL_TOP;
		if (!this.mapIn(view, this.corner, space, this.from)) return;
		this.corner.x = TOKEN_WIDTH;
		this.corner.y = TOTAL_TOP + TOTAL_HEIGHT;
		if (!this.mapIn(view, this.corner, space, this.to)) return;
		const rect = this.chip.rect;
		rect.x = this.from.x;
		rect.y = this.from.y;
		rect.width = this.to.x - this.from.x;
		rect.height = this.to.y - this.from.y;
		draw.drawRect(this.chip);
		this.chipText.text = label;
		this.chipText.size = TOTAL_SIZE * (rect.height / TOTAL_HEIGHT);
		this.chipText.box.x = rect.x;
		this.chipText.box.y = rect.y;
		this.chipText.box.width = rect.width;
		this.chipText.box.height = rect.height;
		draw.drawText(this.chipText);
	}

	/** `point` in `component` into this layer's space, through the parent both hang from. */
	private mapIn(component: Component, point: Vec2, space: Component, out: Vec2): boolean {
		if (!component.localToAncestorInto(point, space, out)) return false;
		out.x -= this.originX;
		out.y -= this.originY;
		return true;
	}
}
