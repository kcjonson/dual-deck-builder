import { Component, ComponentOptions, ResolvedColors } from '../../../engine/components/Component';
import { Container, ContainerOptions } from '../../../engine/components/Container';
import { Text } from '../../../engine/components/Text';
import type { MountContext } from '../../../engine/components/MountContext';
import { linear } from '../../../engine/animation/easing';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { DrawCircleOptions, DrawPolygonOptions, DrawRectOptions, DrawTextOptions } from '../../../engine/draw/commands';
import type { RGBA, Rect, Vec2 } from '../../../engine/draw/geometry';
import { resolveColor } from '../../../engine/style/styleObject';
import { tokens } from '../../../engine/theme/tokens';
import type { AimPreview } from '../../mechanics/AimPreview';
import { DAMAGE_NUMBER_COLOR, MISS_NUMBER_COLOR } from './combatStyle';
import { DiscardFlight } from './DiscardFlight';
import type { Card as UICard } from '../../ui/Card';

/** The mock's targeting line: round dots 5 across every 12, and a head 16 long. */
const DOT_RADIUS = 2.5;
const DOT_SPACING = 12;
const HEAD_LENGTH = 16;
const HEAD_HALF_WIDTH = 10;
const RETICLE_SIZE = 20;
const RETICLE_RING = 2;
/** Samples along the curve for spacing its dots evenly. */
const CURVE_SAMPLES = 48;
/** Over a target that accepts the card, the mock's `#ff6a55`; anywhere else, bone at 60%. */
const ON_TARGET: RGBA = resolveColor('#ff6a55');
const OFF_TARGET: RGBA = resolveColor('rgba(233, 228, 214, 0.6)');
const CLEAR: RGBA = [0, 0, 0, 0];
const HEAD_INDICES: readonly number[] = [0, 1, 2, 0, 2, 3];

/**
 * The mock's `.dmgpop`: 30 px display type with a hard drop shadow. The
 * mock never animates it; it stays `NUMBER_LIFETIME`, longer than any
 * motion token because it has to be read, rising and fading as it goes.
 */
const NUMBER_FONT_SIZE = 30;
const NUMBER_BOX_WIDTH = 120;
const NUMBER_BOX_HEIGHT = 36;
const NUMBER_RISE = 40;
export const NUMBER_LIFETIME = 900;
/** The share of its life a number holds full opacity before fading. */
const NUMBER_HOLD = 0.55;
/** A second number on the same vehicle starts this far below the first. */
const NUMBER_STACK_STEP = 28;
/** Down from the top of the vehicle's box, where the number starts. */
const NUMBER_INSET = 8;
const NUMBER_Z_INDEX = 2;
/** In from the right end of a driver's pile counts, to the discard count. */
const PILE_COUNT_INSET = 10;
const NUMBER_SHADOW = { color: resolveColor('#000000'), offset: { x: 0, y: 2 }, blur: 4 };
const easeOutQuad = (progress: number): number => 1 - (1 - progress) * (1 - progress);

/**
 * What follows the pointer while a card is dragged (R9.12b's ghost): a ring
 * the size of a fingertip, centred on the pointer. The drag service moves it;
 * the targeting line runs from the card to its centre.
 */
export class AimReticle extends Component {
	/** Holds the ring red (true) or bone (false) whatever the drag says; null follows the drag. */
	public pinnedOnTarget: boolean | null = null;
	private readonly centrePoint: Vec2 = { x: RETICLE_SIZE / 2, y: RETICLE_SIZE / 2 };
	private readonly aimed: Vec2 = { x: 0, y: 0 };
	private readonly ring: DrawCircleOptions = {
		center: this.centrePoint,
		radius: RETICLE_SIZE / 2 - RETICLE_RING / 2,
		fill: CLEAR,
		border: { color: OFF_TARGET, width: RETICLE_RING },
	};

	constructor(options: ComponentOptions = {}) {
		// Over the line that ends at its centre
		super({ width: RETICLE_SIZE, height: RETICLE_SIZE, pointerEvents: 'none', zIndex: 1, ...options });
		this.componentType = 'AimReticle';
		this.ring.id = this.id ?? undefined;
	}

	/** Where the pointer is, in the reticle's own space. */
	public get centre(): Vec2 {
		return this.centrePoint;
	}

	/**
	 * Where the drag service last moved it, in its parent's space: the drop
	 * point, read during the drop, after the service has already put the
	 * ghost back.
	 */
	public get lastAim(): Vec2 {
		return this.aimed;
	}

	public get dragOffset(): Vec2 | null {
		return super.dragOffset;
	}

	public set dragOffset(offset: Vec2 | null) {
		super.dragOffset = offset;
		if (!offset) return;
		this.aimed.x = this.x + offset.x + this.centrePoint.x;
		this.aimed.y = this.y + offset.y + this.centrePoint.y;
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: aimColor(this, this.pinnedOnTarget) };
	}

	public render(draw: DrawApi): void {
		if (this.ring.border) this.ring.border.color = aimColor(this, this.pinnedOnTarget);
		draw.drawCircle(this.ring);
	}
}

/**
 * The dotted line from a dragged card to the pointer, bending up out of the
 * hand, with a head at the pointer (Battle Screen Design section 6, the
 * mock's targeting state). It covers the whole stage so the walk never culls
 * it, and draws only while it has a card to draw from; both ends are read
 * from the tree at paint time, so it follows the lifted card and the
 * reticle with no bookkeeping. Its geometry lives in buffers it reuses, so
 * a frame of aiming allocates nothing of its own.
 */
export class TargetingArrow extends Component {
	/** Holds the line red (true) or bone (false) whatever the drag says; null follows the drag. */
	public pinnedOnTarget: boolean | null = null;
	private sourceCard: Component | null = null;
	private reticle: AimReticle;
	private readonly curve: MutableCurve = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
	private readonly path = new CurvePath();
	private readonly dots: Vec2[] = [];
	private readonly head: [Vec2, Vec2, Vec2] = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
	private readonly cardTop: Vec2 = { x: 0, y: 0 };
	private readonly from: Vec2 = { x: 0, y: 0 };
	private readonly to: Vec2 = { x: 0, y: 0 };
	private readonly dot: DrawCircleOptions & { center: Vec2; fill: RGBA } = { center: { x: 0, y: 0 }, radius: DOT_RADIUS, fill: OFF_TARGET };
	private readonly headShape: DrawPolygonOptions & { points: Vec2[] };

	constructor({ reticle, ...options }: ComponentOptions & { reticle: AimReticle }) {
		super({ pointerEvents: 'none', ...options });
		this.componentType = 'TargetingArrow';
		this.reticle = reticle;
		const [base, left, right] = this.head;
		this.headShape = { points: [this.curve[2], left, base, right], indices: HEAD_INDICES, fill: OFF_TARGET };
	}

	/** The card the line starts from, or null to draw nothing. */
	public get source(): Component | null {
		return this.sourceCard;
	}

	public set source(card: Component | null) {
		this.sourceCard = card;
	}

	public get resolvedColors(): ResolvedColors | null {
		return this.sourceCard ? { fill: aimColor(this, this.pinnedOnTarget) } : null;
	}

	/**
	 * Both ends are carried up the tree a level at a time into the layer's
	 * parent (the stage, which holds the hand too), then down into this
	 * line's box past the layer's and its own origins. Neither has a
	 * transform, so that's a subtraction, and the walk builds no matrices.
	 */
	public render(draw: DrawApi): void {
		const card = this.sourceCard;
		const layer = this.parent;
		const space = layer?.parent;
		if (!card || !card.isMounted || !this.reticle.visible || !layer || !space) return;
		const from = this.from;
		const to = this.to;
		this.cardTop.x = card.width / 2;
		this.cardTop.y = 0;
		if (!card.localToAncestorInto(this.cardTop, space, from)) return;
		from.x -= layer.originX + this.originX;
		from.y -= layer.originY + this.originY;
		if (!this.reticle.localToAncestorInto(this.reticle.centre, layer, to)) return;
		to.x -= this.originX;
		to.y -= this.originY;
		const color = aimColor(this, this.pinnedOnTarget);
		targetingCurve(from, to, this.curve);

		const count = this.path.dotsAlong(this.curve, HEAD_LENGTH, this.dots);
		this.dot.fill = color;
		for (let index = 0; index < count; index++) {
			this.dot.center.x = this.dots[index].x;
			this.dot.center.y = this.dots[index].y;
			draw.drawCircle(this.dot);
		}
		arrowHead(this.curve, this.head);
		this.headShape.fill = color;
		draw.drawPolygon(this.headShape);
	}
}

/**
 * Red while the drag service says what's under the pointer would take the
 * card (R9.12c's `canDrop`), unless `pinned` holds it one way: the
 * gallery's picture of a drag, where nothing is dragged.
 */
function aimColor(component: Component, pinned: boolean | null): RGBA {
	const onTarget = pinned ?? component.context?.drag.canDrop ?? false;
	return onTarget ? ON_TARGET : OFF_TARGET;
}

/** A quadratic curve: start, control, end. */
export type Curve = readonly [Vec2, Vec2, Vec2];
type MutableCurve = [Vec2, Vec2, Vec2];

function newCurve(): MutableCurve {
	return [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
}

/**
 * Up out of the card, then over to the pointer: the control point sits
 * above the card, halfway up to the pointer, so the line always leaves the
 * hand going up and arrives leaning in from below.
 */
export function targetingCurve(from: Vec2, to: Vec2, out: MutableCurve = newCurve()): Curve {
	out[0].x = from.x;
	out[0].y = from.y;
	out[1].x = from.x;
	out[1].y = (from.y + to.y) / 2;
	out[2].x = to.x;
	out[2].y = to.y;
	return out;
}

export function pointOnCurve([p0, p1, p2]: Curve, t: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
	const u = 1 - t;
	out.x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
	out.y = u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y;
	return out;
}

/** The arc-length table a curve's dots are spaced by, kept between frames. */
class CurvePath {
	private readonly points: Vec2[] = Array.from({ length: CURVE_SAMPLES + 1 }, () => ({ x: 0, y: 0 }));
	private readonly distances = new Float64Array(CURVE_SAMPLES + 1);

	/**
	 * Dot centres every `DOT_SPACING` along the curve by arc length, starting
	 * half a space in and stopping `clearance` short of the end, where the
	 * head is. Writes them into `out`, growing it only past its longest
	 * line so far, and returns how many it wrote.
	 */
	public dotsAlong(curve: Curve, clearance: number, out: Vec2[]): number {
		const { points, distances } = this;
		pointOnCurve(curve, 0, points[0]);
		distances[0] = 0;
		for (let step = 1; step <= CURVE_SAMPLES; step++) {
			const point = pointOnCurve(curve, step / CURVE_SAMPLES, points[step]);
			const previous = points[step - 1];
			distances[step] = distances[step - 1] + Math.hypot(point.x - previous.x, point.y - previous.y);
		}
		const length = distances[CURVE_SAMPLES];
		let count = 0;
		let segment = 1;
		for (let distance = DOT_SPACING / 2; distance <= length - clearance; distance += DOT_SPACING) {
			while (segment < CURVE_SAMPLES && distances[segment] < distance) segment++;
			const a = points[segment - 1];
			const b = points[segment];
			const span = distances[segment] - distances[segment - 1];
			const t = span > 0 ? (distance - distances[segment - 1]) / span : 0;
			if (count === out.length) out.push({ x: 0, y: 0 });
			out[count].x = a.x + (b.x - a.x) * t;
			out[count].y = a.y + (b.y - a.y) * t;
			count++;
		}
		return count;
	}
}

/** The dots along `curve`, as a fresh list: `CurvePath.dotsAlong` for callers that keep no buffers. */
export function dotsAlong(curve: Curve, clearance: number): Vec2[] {
	const out: Vec2[] = [];
	out.length = new CurvePath().dotsAlong(curve, clearance, out);
	return out;
}

/**
 * The head's base centre and its two back corners, pointing along the
 * curve's direction at its end. A curve with no length points up.
 */
export function arrowHead(
	curve: Curve,
	out: [Vec2, Vec2, Vec2] = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
): [Vec2, Vec2, Vec2] {
	const [, control, tip] = curve;
	let dx = tip.x - control.x;
	let dy = tip.y - control.y;
	const length = Math.hypot(dx, dy);
	if (length < 1e-6) {
		dx = 0;
		dy = -1;
	} else {
		dx /= length;
		dy /= length;
	}
	const [base, left, right] = out;
	base.x = tip.x - dx * HEAD_LENGTH;
	base.y = tip.y - dy * HEAD_LENGTH;
	left.x = base.x - dy * HEAD_HALF_WIDTH - dx * 4;
	left.y = base.y + dx * HEAD_HALF_WIDTH - dy * 4;
	right.x = base.x + dy * HEAD_HALF_WIDTH - dx * 4;
	right.y = base.y - dx * HEAD_HALF_WIDTH - dy * 4;
	return out;
}

/** The mock's `.hitchip`: 12 px mono in a box padded 4 by 6, 146 down the dragged card. */
const HIT_FONT_SIZE = 12;
const HIT_ADVANCE = HIT_FONT_SIZE * 0.6;
const HIT_PAD_X = 6;
const HIT_PAD_Y = 4;
const HIT_BORDER = 1;
const HIT_HEIGHT = HIT_FONT_SIZE + HIT_PAD_Y * 2 + HIT_BORDER * 2;
const HIT_CARD_Y = 146;
const HIT_BACKGROUND = resolveColor('#0d0e0f');
const HIT_DETAIL = resolveColor('#8fbf5c');
const MISS_DETAIL = resolveColor('#ff9d8f');
const MISS_BORDER = resolveColor('rgba(233, 228, 214, 0.36)');

/** The hit check as the chip prints it, in three runs: the verdict, the numbers, the range. */
export interface HitCheckText {
	verdict: string;
	detail: string;
	range: string;
	hits: boolean;
}

/**
 * "HIT", then "Gunnery 7 vs Evade 4+2" (the card's modifier added to evade)
 * or "Ramming 5 vs Evade 4", or "Sure-hit" when nothing rolls, then the
 * range ("R1"). A check that fails says MISS.
 */
export function hitCheckText(preview: AimPreview): HitCheckText {
	const { check, range } = preview;
	const rangeText = range === null ? '' : ` · R${range}`;
	if (!check) return { verdict: 'HIT', detail: 'Sure-hit', range: rangeText, hits: true };
	const skill = check.skill === 'ramming' ? 'Ramming' : 'Gunnery';
	const modifier = check.modifier > 0 ? `+${check.modifier}` : check.modifier < 0 ? `${check.modifier}` : '';
	return { verdict: check.hits ? 'HIT' : 'MISS', detail: `${skill} ${check.attack} vs Evade ${check.evade}${modifier}`, range: rangeText, hits: check.hits };
}

/**
 * The hit check riding with the aimed card (section 6): gunnery against
 * evade and the range to the target the pointer or focus is on, centred
 * on the card near its foot. Like the line, it covers the layer and reads
 * the card's place from the tree at paint time, so it follows the lifted
 * card; its text and box are set when the target changes, never per frame.
 */
export class HitCheckChip extends Component {
	private sourceCard: Component | null = null;
	private content: HitCheckText | null = null;
	private chipWidth = 0;
	private readonly cardPoint: Vec2 = { x: 0, y: 0 };
	private readonly at: Vec2 = { x: 0, y: 0 };
	private readonly box: DrawRectOptions & { rect: { x: number; y: number; width: number; height: number } } = {
		rect: { x: 0, y: 0, width: 0, height: HIT_HEIGHT },
		fill: HIT_BACKGROUND,
		radius: 2,
		border: { color: ON_TARGET, width: HIT_BORDER },
	};
	private readonly runs: (DrawTextOptions & { box: { x: number; y: number; width: number; height: number } })[] = [0, 1, 2].map(() => ({
		text: '',
		box: { x: 0, y: 0, width: 0, height: HIT_HEIGHT },
		font: 'mono',
		size: HIT_FONT_SIZE,
		color: tokens.color.text,
		align: 'left' as const,
		verticalAlign: 'middle' as const,
		wrap: 'none' as const,
	}));

	constructor(options: ComponentOptions = {}) {
		super({ pointerEvents: 'none', zIndex: NUMBER_Z_INDEX, ...options });
		this.componentType = 'HitCheckChip';
		// Hidden while it says nothing, so its layer-sized box doesn't sit over the hit numbers
		this.visible = false;
	}

	/** What the chip says now, or null while it's hidden. */
	public get text(): HitCheckText | null {
		return this.content;
	}

	/** Shows `text` under `card`; a null card or text hides it. */
	public show(card: Component | null, text: HitCheckText | null): void {
		this.sourceCard = text ? card : null;
		this.content = card ? text : null;
		this.visible = this.content !== null;
		if (!this.content) return;
		const { verdict, detail, range, hits } = this.content;
		const [verdictRun, detailRun, rangeRun] = this.runs;
		verdictRun.text = `${verdict} `;
		detailRun.text = detail;
		detailRun.color = hits ? HIT_DETAIL : MISS_DETAIL;
		rangeRun.text = range;
		this.box.border = { color: hits ? ON_TARGET : MISS_BORDER, width: HIT_BORDER };
		let x = HIT_PAD_X + HIT_BORDER;
		for (const run of this.runs) {
			run.box.x = x;
			run.box.width = run.text.length * HIT_ADVANCE;
			x += run.box.width;
		}
		this.chipWidth = Math.ceil(x + HIT_PAD_X + HIT_BORDER);
		this.box.rect.width = this.chipWidth;
	}

	public get drawnText(): readonly string[] | null {
		return this.content ? this.runs.map((run) => run.text) : null;
	}

	public get resolvedColors(): ResolvedColors | null {
		return this.content ? { fill: HIT_BACKGROUND } : null;
	}

	/** Through the stage to the layer, as the line finds its card: no matrices, no allocations. */
	public render(draw: DrawApi): void {
		const card = this.sourceCard;
		const layer = this.parent;
		const space = layer?.parent;
		if (!card || !this.content || !card.isMounted || !layer || !space) return;
		this.cardPoint.x = card.width / 2;
		this.cardPoint.y = Math.min(HIT_CARD_Y, card.height);
		if (!card.localToAncestorInto(this.cardPoint, space, this.at)) return;
		// Centred on the card, but held inside the layer, which is the stage:
		// the hand's edge cards would otherwise push the verdict off screen
		const centred = Math.round(this.at.x - layer.originX - this.originX - this.chipWidth / 2);
		const left = Math.max(0, Math.min(centred, this.width - this.chipWidth));
		const top = Math.round(this.at.y - layer.originY - this.originY);
		this.box.rect.x = left;
		this.box.rect.y = top;
		draw.drawRect(this.box);
		let x = left + HIT_PAD_X + HIT_BORDER;
		for (const run of this.runs) {
			if (!run.text) continue;
			run.box.x = x;
			run.box.y = top;
			draw.drawText(run);
			x += run.box.width;
		}
	}
}

/** What a floating number says: damage dealt, or a miss. */
export type FloatingNumberKind = 'damage' | 'miss';

/**
 * Everything the combat screen draws over its bands: the targeting line
 * and its reticle while a card is dragged, and the numbers that float up
 * off a vehicle when a hit lands or misses. The stage's size and in its
 * space, so it scales with it, on the `overlay` layer and never a target.
 */
export class CombatFxLayer extends Container {
	public readonly reticle: AimReticle;
	private readonly arrow: TargetingArrow;
	private readonly hitCheck: HitCheckChip;
	/** Numbers still rising, per anchor, so a second hit stacks under the first. */
	/** The stack slots each anchor's live numbers hold. */
	private readonly takenSlots = new Map<string, Set<number>>();
	/** Only counts up, so no two numbers ever share an id. */
	private numbersPopped = 0;
	private flights = 0;

	constructor(options: ContainerOptions = {}) {
		super({ layer: 'overlay', pointerEvents: 'none', ...options });
		this.reticle = new AimReticle({ id: 'combat_aim_reticle' });
		this.reticle.visible = false;
		this.arrow = new TargetingArrow({ id: 'combat_targeting_line', reticle: this.reticle });
		this.hitCheck = new HitCheckChip({ id: 'combat_hit_check' });
		this.addChild(this.arrow);
		this.addChild(this.reticle);
		this.addChild(this.hitCheck);
	}

	/** The line and the hit check cover the layer, so they always have the room to draw in. */
	protected onResized(): void {
		this.arrow.setSize(this.width, this.height);
		this.hitCheck.setSize(this.width, this.height);
	}

	/** The hit check on `card` for the target `preview` reads, or hides it with null. */
	public showHitCheck(card: Component | null, preview: AimPreview | null): void {
		this.hitCheck.show(card, preview ? hitCheckText(preview) : null);
	}

	/** What the hit check says now, or null while it's hidden. */
	public get hitCheckText(): HitCheckText | null {
		return this.hitCheck.text;
	}

	/**
	 * Puts the reticle under a press, ready to be the ghost of the drag it
	 * may start: the drag service moves it from there by the pointer's
	 * travel. Hidden until the drag goes active.
	 */
	public prepareAim(press: Vec2): void {
		const at = this.screenToLocal(press);
		if (!at) return;
		const centre = this.reticle.centre;
		this.reticle.setPosition(at.x - centre.x, at.y - centre.y);
	}

	/** Shows the line from `card` to the reticle. */
	public showAim(card: Component): void {
		this.arrow.source = card;
		this.reticle.visible = true;
	}

	public hideAim(): void {
		this.arrow.source = null;
		this.reticle.visible = false;
	}

	public get aiming(): boolean {
		return this.arrow.source !== null;
	}

	/** The card the line runs from; through a drop, until the drag service says the drag is over. */
	public get aimingFrom(): Component | null {
		return this.arrow.source;
	}

	/** The numbers on screen now, oldest first. */
	public get floatingNumbers(): FloatingNumber[] {
		return this.children.filter((child): child is FloatingNumber => child instanceof FloatingNumber);
	}

	/**
	 * Sends a copy of `card` from where it sat in the hand, or from the
	 * reticle when it was dropped there, to the pile `pile` counts, unless
	 * reduced motion is on. Read from the hand before the hand deals again,
	 * so `card` is still in place.
	 */
	public flyToDiscard({ card, pile, droppedAtReticle = false }: { card: UICard; pile: Component; droppedAtReticle?: boolean }): void {
		const animator = this.context?.animator;
		if (!animator || animator.reducedMotion || !this.isMounted) return;
		const centre = { x: 0, y: 0 };
		const across = { x: 0, y: 0 };
		const to = { x: 0, y: 0 };
		if (!this.mapIn(card, card.width / 2, card.height / 2, centre)) return;
		if (!this.mapIn(card, card.width / 2 + 1, card.height / 2, across)) return;
		// The right end of "DISCARD n", where the count is
		if (!this.mapIn(pile, Math.max(0, pile.width - PILE_COUNT_INSET), pile.height / 2, to)) return;
		const dx = across.x - centre.x;
		const dy = across.y - centre.y;
		let rotate = Math.atan2(dy, dx);
		// A card played by a drop leaves from where it landed, upright: the
		// card stayed lifted in the hand while the reticle went to the target,
		// so the target is where the player last aimed it
		if (droppedAtReticle) {
			centre.x = this.reticle.lastAim.x;
			centre.y = this.reticle.lastAim.y;
			rotate = 0;
		}
		this.addChild(new DiscardFlight({
			id: `combat_discard_flight_${this.flights++}`,
			card: card.data,
			driverNumber: card.driver,
			start: { centre, rotate, scale: Math.hypot(dx, dy) },
			to,
			onLanded: (flight) => this.removeChild(flight),
		}));
	}

	/** The fx-layer point of `point` in `component`, through the stage both hang from. */
	private mapIn(component: Component, x: number, y: number, out: Vec2): boolean {
		const stage = this.parent;
		out.x = x;
		out.y = y;
		if (!stage || !component.localToAncestorInto(out, stage, out)) return false;
		out.x -= this.originX;
		out.y -= this.originY;
		return true;
	}

	/** Cards on their way to a discard pile now. */
	public get discardFlights(): DiscardFlight[] {
		return this.children.filter((child): child is DiscardFlight => child instanceof DiscardFlight);
	}

	/**
	 * A number that rises off the top of `anchor` (a vehicle's
	 * `screenBounds`) and fades. `anchorKey` names what it belongs to, so
	 * hits on the same vehicle in one burst stack instead of printing over
	 * each other.
	 */
	public popNumber({ anchor, anchorKey, text, kind }: { anchor: Rect; anchorKey: string; text: string; kind: FloatingNumberKind }): void {
		const top = this.screenToLocal({ x: anchor.x + anchor.width / 2, y: anchor.y });
		if (!top || !this.isMounted) return;

		// The lowest slot no live number on this anchor holds, so a hit that
		// lands while an earlier one is still up never prints over it
		let taken = this.takenSlots.get(anchorKey);
		if (!taken) {
			taken = new Set();
			this.takenSlots.set(anchorKey, taken);
		}
		let stacked = 0;
		while (taken.has(stacked)) stacked++;
		taken.add(stacked);
		this.addChild(new FloatingNumber({
			id: `combat_float_${anchorKey}_${this.numbersPopped++}`,
			text,
			kind,
			x: top.x - NUMBER_BOX_WIDTH / 2,
			y: top.y + NUMBER_INSET + stacked * NUMBER_STACK_STEP,
			onExpire: (number) => {
				const slots = this.takenSlots.get(anchorKey);
				slots?.delete(stacked);
				if (slots?.size === 0) this.takenSlots.delete(anchorKey);
				this.removeChild(number);
			},
		}));
	}
}

/**
 * A hit's `-N` or `MISS`. How long it stays is reading time, not motion, so
 * it counts down on the frame clock like `Toast`'s auto-dismiss; only the
 * rise and the fade go through the animator, and under reduced motion
 * (R11.13) the number holds still at full opacity for its whole life
 * instead.
 */
export class FloatingNumber extends Text {
	private readonly startX: number;
	private readonly startY: number;
	private remainingMs = NUMBER_LIFETIME;
	private fading = false;
	private readonly onExpire: ((number: FloatingNumber) => void) | null;
	private readonly held: boolean;

	/**
	 * `held` keeps it where it starts, at full opacity, for as long as it's
	 * mounted: the gallery's picture of one, which a capture can pin.
	 */
	constructor({ id, text, kind, x, y, onExpire = null, held = false }: {
		id: string;
		text: string;
		kind: FloatingNumberKind;
		x: number;
		y: number;
		onExpire?: ((number: FloatingNumber) => void) | null;
		held?: boolean;
	}) {
		super({
			text,
			id,
			// Over the line and the reticle, and a later number over an earlier one
			zIndex: NUMBER_Z_INDEX,
			width: NUMBER_BOX_WIDTH,
			height: NUMBER_BOX_HEIGHT,
			pointerEvents: 'none',
			wrap: 'none',
			verticalAlign: 'middle',
			style: {
				color: kind === 'damage' ? DAMAGE_NUMBER_COLOR : MISS_NUMBER_COLOR,
				fontRole: 'display',
				fontSize: NUMBER_FONT_SIZE,
				textAlign: 'center',
			},
		});
		this.componentType = 'FloatingNumber';
		this.shadow = NUMBER_SHADOW;
		this.startX = x;
		this.startY = y;
		this.onExpire = onExpire;
		this.held = held;
		this.setPosition(x, y);
	}

	/** Under reduced motion it neither rises nor fades. */
	private get moving(): boolean {
		const animator = this.context?.animator;
		return !this.held && animator !== undefined && !animator.reducedMotion;
	}

	protected onMount(context: MountContext): void {
		super.onMount(context);
		if (this.held) return;
		this.requestUpdate();
		if (!this.moving) return;
		context.animator.tween({
			from: 0,
			to: NUMBER_RISE,
			duration: NUMBER_LIFETIME,
			ease: easeOutQuad,
			owner: this,
			onUpdate: (rise) => this.setPosition(this.startX, this.startY - rise),
		});
	}

	/** The countdown; the fade starts once the hold is up and ends with it. */
	public update(dt: number): void {
		this.remainingMs -= dt * 1000;
		if (this.remainingMs <= 0) {
			if (this.onExpire) this.onExpire(this);
			else this.parent?.removeChild(this);
			return;
		}
		const animator = this.context?.animator;
		if (!this.fading && animator && this.moving && this.remainingMs <= NUMBER_LIFETIME * (1 - NUMBER_HOLD)) {
			this.fading = true;
			animator.tween({
				from: 1,
				to: 0,
				duration: this.remainingMs,
				ease: linear,
				owner: this,
				onUpdate: (opacity) => {
					this.opacity = opacity;
				},
			});
		}
		this.requestUpdate();
	}
}
