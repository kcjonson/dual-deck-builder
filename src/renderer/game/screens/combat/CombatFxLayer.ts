import { Component, ComponentOptions, ResolvedColors } from '../../../engine/components/Component';
import { Container, ContainerOptions } from '../../../engine/components/Container';
import { Text } from '../../../engine/components/Text';
import { linear } from '../../../engine/animation/easing';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { DrawCircleOptions, DrawPolygonOptions } from '../../../engine/draw/commands';
import type { RGBA, Rect, Vec2 } from '../../../engine/draw/geometry';
import { resolveColor } from '../../../engine/style/styleObject';
import { DAMAGE_NUMBER_COLOR, MISS_NUMBER_COLOR } from './combatStyle';

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
 * mock never animates it; it rises and fades out over `NUMBER_LIFETIME`,
 * longer than any motion token because it has to be read.
 */
const NUMBER_FONT_SIZE = 30;
const NUMBER_BOX_WIDTH = 120;
const NUMBER_BOX_HEIGHT = 36;
const NUMBER_RISE = 40;
const NUMBER_LIFETIME = 900;
/** The share of its life a number holds full opacity before fading. */
const NUMBER_HOLD = 0.55;
/** A second number on the same vehicle starts this far below the first. */
const NUMBER_STACK_STEP = 28;
/** Down from the top of the vehicle's box, where the number starts. */
const NUMBER_INSET = 8;
const NUMBER_SHADOW = { color: resolveColor('#000000'), offset: { x: 0, y: 2 }, blur: 4 };

/**
 * What follows the pointer while a card is dragged (R9.12b's ghost): a ring
 * the size of a fingertip, centred on the pointer. The drag service moves it;
 * the targeting line runs from the card to its centre.
 */
export class AimReticle extends Component {
	private readonly centrePoint: Vec2 = { x: RETICLE_SIZE / 2, y: RETICLE_SIZE / 2 };
	private readonly ring: DrawCircleOptions = {
		center: this.centrePoint,
		radius: RETICLE_SIZE / 2 - RETICLE_RING / 2,
		fill: CLEAR,
		border: { color: OFF_TARGET, width: RETICLE_RING },
	};

	constructor(options: ComponentOptions = {}) {
		super({ width: RETICLE_SIZE, height: RETICLE_SIZE, pointerEvents: 'none', ...options });
		this.componentType = 'AimReticle';
		this.ring.id = this.id ?? undefined;
	}

	/** Where the pointer is, in the reticle's own space. */
	public get centre(): Vec2 {
		return this.centrePoint;
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: aimColor(this) };
	}

	public render(draw: DrawApi): void {
		if (this.ring.border) this.ring.border.color = aimColor(this);
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
	private sourceCard: Component | null = null;
	private reticle: AimReticle;
	private readonly curve: MutableCurve = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
	private readonly path = new CurvePath();
	private readonly dots: Vec2[] = [];
	private readonly head: [Vec2, Vec2, Vec2] = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
	private readonly cardTop: Vec2 = { x: 0, y: 0 };
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
		return this.sourceCard ? { fill: aimColor(this) } : null;
	}

	public render(draw: DrawApi): void {
		const card = this.sourceCard;
		if (!card || !card.isMounted || !this.reticle.visible) return;
		const [topLeft, topRight] = card.screenQuad;
		this.cardTop.x = (topLeft.x + topRight.x) / 2;
		this.cardTop.y = (topLeft.y + topRight.y) / 2;
		const from = this.screenToLocal(this.cardTop);
		const to = this.screenToLocal(this.reticle.localToScreen(this.reticle.centre));
		if (!from || !to) return;
		const color = aimColor(this);
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

/** Red while the drag service says what's under the pointer would take the card (R9.12c's `canDrop`). */
function aimColor(component: Component): RGBA {
	return component.context?.drag.canDrop ? ON_TARGET : OFF_TARGET;
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
	/** Numbers still rising, per anchor, so a second hit stacks under the first. */
	private readonly risingPerAnchor = new Map<string, number>();

	constructor(options: ContainerOptions = {}) {
		super({ layer: 'overlay', pointerEvents: 'none', ...options });
		this.reticle = new AimReticle({ id: 'combat_aim_reticle' });
		this.reticle.visible = false;
		this.arrow = new TargetingArrow({ id: 'combat_targeting_line', reticle: this.reticle });
		this.addChild(this.arrow);
		this.addChild(this.reticle);
	}

	/** The line covers the layer, so it always has the room to draw in. */
	protected onResized(): void {
		this.arrow.setSize(this.getWidth(), this.getHeight());
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

	/** The numbers on screen now, oldest first. */
	public get floatingNumbers(): Text[] {
		return this.getChildren().filter((child): child is Text => child instanceof Text);
	}

	/**
	 * A number that rises off the top of `anchor` (a vehicle's
	 * `screenBounds`) and fades, on the animator. `anchorKey` names what it
	 * belongs to, so hits on the same vehicle in one burst stack instead of
	 * printing over each other. Under reduced motion the animator finishes
	 * it on its first tick.
	 */
	public popNumber({ anchor, anchorKey, text, kind }: { anchor: Rect; anchorKey: string; text: string; kind: FloatingNumberKind }): void {
		const animator = this.context?.animator;
		const top = this.screenToLocal({ x: anchor.x + anchor.width / 2, y: anchor.y });
		if (!animator || !top) return;

		const stacked = this.risingPerAnchor.get(anchorKey) ?? 0;
		this.risingPerAnchor.set(anchorKey, stacked + 1);
		const label = new Text(text, {
			id: `combat_float_${anchorKey}_${stacked}`,
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
		label.shadow = NUMBER_SHADOW;
		const x = top.x - NUMBER_BOX_WIDTH / 2;
		const startY = top.y + NUMBER_INSET + stacked * NUMBER_STACK_STEP;
		label.setPosition(x, startY);
		this.addChild(label);

		const settle = (): void => {
			const left = (this.risingPerAnchor.get(anchorKey) ?? 1) - 1;
			if (left > 0) this.risingPerAnchor.set(anchorKey, left);
			else this.risingPerAnchor.delete(anchorKey);
		};
		animator.tween({
			from: 0,
			to: 1,
			duration: NUMBER_LIFETIME,
			ease: linear,
			owner: label,
			onUpdate: (progress) => {
				const rise = 1 - (1 - progress) * (1 - progress);
				label.setPosition(x, startY - NUMBER_RISE * rise);
				label.opacity = progress <= NUMBER_HOLD ? 1 : 1 - (progress - NUMBER_HOLD) / (1 - NUMBER_HOLD);
			},
			onComplete: () => {
				settle();
				this.removeChild(label);
			},
		});
	}
}
