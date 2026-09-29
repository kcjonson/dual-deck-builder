import { Component, ComponentOptions, ResolvedColors } from '../../../engine/components/Component';
import { Container, ContainerOptions } from '../../../engine/components/Container';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Vec2 } from '../../../engine/draw/geometry';
import { resolveColor } from '../../../engine/style/styleObject';

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

/**
 * What follows the pointer while a card is dragged (R9.12b's ghost): a ring
 * the size of a fingertip, centred on the pointer. The drag service moves it;
 * the targeting line runs from the card to its centre.
 */
export class AimReticle extends Component {
	constructor(options: ComponentOptions = {}) {
		super({ width: RETICLE_SIZE, height: RETICLE_SIZE, pointerEvents: 'none', ...options });
		this.componentType = 'AimReticle';
	}

	/** Where the pointer is, in the reticle's own space. */
	public get centre(): Vec2 {
		return { x: RETICLE_SIZE / 2, y: RETICLE_SIZE / 2 };
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: aimColor(this) };
	}

	public render(draw: DrawApi): void {
		draw.drawCircle({
			id: this.id ?? undefined,
			center: this.centre,
			radius: RETICLE_SIZE / 2 - RETICLE_RING / 2,
			fill: CLEAR,
			border: { color: aimColor(this), width: RETICLE_RING },
		});
	}
}

/**
 * The dotted line from a dragged card to the pointer, bending up out of the
 * hand, with a head at the pointer (Battle Screen Design section 6, the
 * mock's targeting state). It covers the whole stage so the walk never culls
 * it, and draws only while it has a card to draw from; both ends are read
 * from the tree at paint time, so it follows the lifted card and the
 * reticle with no bookkeeping.
 */
export class TargetingArrow extends Component {
	private sourceCard: Component | null = null;
	private reticle: AimReticle;

	constructor({ reticle, ...options }: ComponentOptions & { reticle: AimReticle }) {
		super({ pointerEvents: 'none', ...options });
		this.componentType = 'TargetingArrow';
		this.reticle = reticle;
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
		const from = this.screenToLocal({ x: (topLeft.x + topRight.x) / 2, y: (topLeft.y + topRight.y) / 2 });
		const to = this.screenToLocal(this.reticle.localToScreen(this.reticle.centre));
		if (!from || !to) return;
		const color = aimColor(this);
		const curve = targetingCurve(from, to);

		for (const center of dotsAlong(curve, HEAD_LENGTH)) {
			draw.drawCircle({ center, radius: DOT_RADIUS, fill: color });
		}
		const [base, left, right] = arrowHead(curve);
		draw.drawPolygon({ points: [to, left, base, right], indices: [0, 1, 2, 0, 2, 3], fill: color });
	}
}

/** Red while the drag service says what's under the pointer would take the card (R9.12c's `canDrop`). */
function aimColor(component: Component): RGBA {
	return component.context?.drag.canDrop ? ON_TARGET : OFF_TARGET;
}

/** A quadratic curve: start, control, end. */
export type Curve = readonly [Vec2, Vec2, Vec2];

/**
 * Up out of the card, then over to the pointer: the control point sits
 * above the card, halfway up to the pointer, so the line always leaves the
 * hand going up and arrives leaning in from below.
 */
export function targetingCurve(from: Vec2, to: Vec2): Curve {
	return [from, { x: from.x, y: (from.y + to.y) / 2 }, to];
}

export function pointOnCurve([p0, p1, p2]: Curve, t: number): Vec2 {
	const u = 1 - t;
	return {
		x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
		y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
	};
}

/**
 * Dot centres every `DOT_SPACING` along the curve by arc length, starting
 * half a space in and stopping `clearance` short of the end, where the head
 * is.
 */
export function dotsAlong(curve: Curve, clearance: number): Vec2[] {
	const samples: { point: Vec2; distance: number }[] = [{ point: curve[0], distance: 0 }];
	for (let step = 1; step <= CURVE_SAMPLES; step++) {
		const point = pointOnCurve(curve, step / CURVE_SAMPLES);
		const previous = samples[samples.length - 1];
		samples.push({ point, distance: previous.distance + Math.hypot(point.x - previous.point.x, point.y - previous.point.y) });
	}
	const length = samples[samples.length - 1].distance;
	const dots: Vec2[] = [];
	let segment = 1;
	for (let distance = DOT_SPACING / 2; distance <= length - clearance; distance += DOT_SPACING) {
		while (segment < samples.length - 1 && samples[segment].distance < distance) segment++;
		const a = samples[segment - 1];
		const b = samples[segment];
		const span = b.distance - a.distance;
		const t = span > 0 ? (distance - a.distance) / span : 0;
		dots.push({ x: a.point.x + (b.point.x - a.point.x) * t, y: a.point.y + (b.point.y - a.point.y) * t });
	}
	return dots;
}

/**
 * The head's base centre and its two back corners, pointing along the
 * curve's direction at its end. A curve with no length points up.
 */
export function arrowHead(curve: Curve): [Vec2, Vec2, Vec2] {
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
	const base = { x: tip.x - dx * HEAD_LENGTH, y: tip.y - dy * HEAD_LENGTH };
	return [
		base,
		{ x: base.x - dy * HEAD_HALF_WIDTH - dx * 4, y: base.y + dx * HEAD_HALF_WIDTH - dy * 4 },
		{ x: base.x + dy * HEAD_HALF_WIDTH - dx * 4, y: base.y - dx * HEAD_HALF_WIDTH - dy * 4 },
	];
}

/**
 * Everything the combat screen draws over its bands: the targeting line
 * and its reticle while a card is dragged (and, from the next PR, damage
 * numbers). The stage's size and in its space, so it scales with it, on
 * the `overlay` layer and never a target.
 */
export class CombatFxLayer extends Container {
	public readonly reticle: AimReticle;
	private readonly arrow: TargetingArrow;

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
}
