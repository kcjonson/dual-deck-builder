import { Component, ComponentOptions, ResolvedColors } from '../../../engine/components/Component';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { DrawCirclesOptions, DrawPolygonOptions, DrawPolylineOptions } from '../../../engine/draw/commands';
import type { RGBA, Rect, Vec2 } from '../../../engine/draw/geometry';
import { resolveColor } from '../../../engine/style/styleObject';
import { tokens } from '../../../engine/theme/tokens';
import type { Vehicle as VehicleUI } from '../../ui/Vehicle';
import type { CardTargets } from './cardTargets';
import { DOT_RADIUS, DOT_SPACING, HEAD_INDICES, HEAD_LENGTH, arrowHead, leading } from './CombatFxLayer';
import type { RoadRect } from './CombatLayout';
import { RoadArc } from './RoadArc';
import type { RoadView } from './RoadView';

/** A solid arrow's line, as wide as the dotted one's dots. */
const SOLID_WIDTH = 3;
/** How far above a target an arrow's arc turns down onto it, so the head points down rather than in from the side. */
const LANDING_DROP = 40;
/** At the raiders' intent lines' 80%, in the colour each side lights in while aimed. */
const RAIDER_LINE: RGBA = resolveColor('rgba(255, 106, 85, 0.8)');
const OWN_LINE: RGBA = [tokens.color.accent[0], tokens.color.accent[1], tokens.color.accent[2], 0.8];

/**
 * A hand card's targets and moves while it has the pointer or keyboard
 * focus on your turn (Battle Screen Design section 6, planning).
 *
 * - Targets: an arrow for each of the card's links (`CardTargets.links`),
 *   from the vehicle that would act (the playing driver's, or an order's
 *   escort) to the vehicle it would act on. Across the road it arcs as the
 *   raiders' intent lines do (`RoadArc.trace`): up from the top of the
 *   acting vehicle's plate, and down onto the top of the target's token,
 *   over a raider's intent pills. Between two vehicles in one lane, where
 *   that arc would run through the target, it goes the short way between
 *   the plates' facing edges, bowed (`RoadArc.traceMove`). Solid when
 *   there's nothing to choose, one target or a card that lands on all of
 *   them; the aiming line's dots when the player will pick one of several.
 * - Moves: for a card that moves vehicles (`CardTargets.moves`), an arrow
 *   from each vehicle it would move to the slot it would go to
 *   (`RoadArc.traceMove`), coming out from under the vehicle's token and
 *   ending in the middle of the slot. Solid when every way of playing the
 *   card makes the move; dotted when it hangs on a target or a slot the
 *   player picks.
 *
 * Red to and for a raider, the interaction yellow for your convoy, as
 * their outlines light while aimed.
 *
 * Covers the road over its tokens, in the road band's own layer, ordered
 * between the end-turn preview and the log drawer. Both ends are read from
 * the road's tokens at paint time, so it follows a swerve or a rescale
 * with no bookkeeping, into buffers it reuses.
 */
export class TargetPreview extends Component {
	private readonly road: RoadView;
	private targets: CardTargets | null = null;
	/** The colour of the first arrow it draws, for the tree snapshot. */
	private firstColor: RGBA | null = null;
	private readonly arc = new RoadArc();
	private readonly from: Vec2 = { x: 0, y: 0 };
	private readonly to: Vec2 = { x: 0, y: 0 };
	private readonly local: Vec2 = { x: 0, y: 0 };
	private readonly corner: Vec2 = { x: 0, y: 0 };
	private readonly slotBox: RoadRect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly tokenBox: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly sourcePlate: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly targetPlate: Rect = { x: 0, y: 0, width: 0, height: 0 };
	/** The solid line's points and the dots' centres, and for each length a list of exactly that many, for the draw (`leading`). */
	private readonly linePoints: Vec2[] = [];
	private readonly lineLists: Vec2[][] = [];
	private readonly dotPoints: Vec2[] = [];
	private readonly dotLists: Vec2[][] = [];
	private readonly tangent: [Vec2, Vec2, Vec2] = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
	private readonly head: [Vec2, Vec2, Vec2] = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
	private readonly dots: DrawCirclesOptions & { fill: RGBA } = { centers: [], radius: DOT_RADIUS, fill: RAIDER_LINE };
	private readonly line: DrawPolylineOptions & { color: RGBA } = { points: [], color: RAIDER_LINE, width: SOLID_WIDTH, cap: 'round' };
	private readonly headShape: DrawPolygonOptions & { fill: RGBA };

	constructor({ road, ...options }: ComponentOptions & { road: RoadView }) {
		super({ pointerEvents: 'none', ...options });
		this.componentType = 'TargetPreview';
		this.road = road;
		const [base, left, right] = this.head;
		this.headShape = { points: [this.tangent[2], left, base, right], indices: HEAD_INDICES, fill: RAIDER_LINE };
	}

	/** What it points at now, or null for nothing. */
	public get showing(): CardTargets | null {
		return this.targets;
	}

	public set showing(targets: CardTargets | null) {
		this.targets = targets;
		this.firstColor = null;
		if (!targets) return;
		const [link] = targets.links;
		const [move] = targets.moves;
		const view = link ? this.road.vehicleView(link.targetId) : move ? this.road.vehicleView(move.vehicleId) : null;
		if (view) this.firstColor = sideColor(view);
	}

	/** Whether its target arrows are solid: one target, or a card that lands on every one it lists. */
	public get solid(): boolean {
		const targets = this.targets;
		return !!targets && (!targets.picks || targets.vehicleIds.length + targets.slots.length === 1);
	}

	public get resolvedColors(): ResolvedColors | null {
		return this.firstColor ? { fill: this.firstColor } : null;
	}

	public render(draw: DrawApi): void {
		const targets = this.targets;
		const space = this.parent;
		if (!targets || !space) return;
		const solid = this.solid;
		for (const { sourceId, targetId } of targets.links) {
			const source = this.road.vehicleView(sourceId);
			const target = this.road.vehicleView(targetId);
			if (!source?.isMounted || !target?.isMounted || target.isWrecked) continue;
			const length = this.traceLink(source, target, space);
			if (length !== null) this.drawArrow(draw, 0, length, solid, sideColor(target));
		}
		for (const move of targets.moves) {
			const mover = this.road.vehicleView(move.vehicleId);
			if (!mover?.isMounted || mover.isWrecked || !this.box(mover, mover.plateRect, space, this.sourcePlate)) continue;
			if (!this.box(mover, null, space, this.tokenBox)) continue;
			centreOf(this.sourcePlate, this.from);
			const slot = this.road.slotRect(move.to, this.slotBox);
			this.local.x = slot.x + slot.width / 2;
			this.local.y = slot.y + slot.height / 2;
			if (!this.mapIn(this.road, this.local, space, this.to)) continue;
			const length = this.arc.traceMove(this.from, this.to);
			this.drawArrow(draw, this.arc.leaves(this.tokenBox), length, !move.choice, sideColor(mover));
		}
	}

	/**
	 * Traces the arc from `source` to `target` into `this.arc` and its ends
	 * into `from` and `to`; returns its length, or null when either can't be
	 * placed. Across the road, from the top of the source's plate over the
	 * road onto the top of the target's token. Within one lane (the plates
	 * overlap across), the short way between the plates' facing edges.
	 */
	private traceLink(source: VehicleUI, target: VehicleUI, space: Component): number | null {
		if (!this.box(source, source.plateRect, space, this.sourcePlate) || !this.box(target, target.plateRect, space, this.targetPlate)) return null;
		const a = this.sourcePlate;
		const b = this.targetPlate;
		this.from.x = a.x + a.width / 2;
		this.to.x = b.x + b.width / 2;
		if (a.x < b.x + b.width && b.x < a.x + a.width) {
			const above = b.y < a.y;
			this.from.y = above ? a.y : a.y + a.height;
			this.to.y = above ? b.y + b.height : b.y;
			return this.arc.traceMove(this.from, this.to);
		}
		this.from.y = a.y;
		this.local.x = target.plateRect.x + target.plateRect.width / 2;
		this.local.y = 0;
		if (!this.mapIn(target, this.local, space, this.to)) return null;
		return this.arc.trace(this.from, this.to, LANDING_DROP);
	}

	/**
	 * Along the traced arc, `length` long, from `start` along it: a line or
	 * dots up to the head, then the head pointing along the arc's end at
	 * `to`. Nothing when the head wouldn't fit past the start.
	 */
	private drawArrow(draw: DrawApi, start: number, length: number, solid: boolean, color: RGBA): void {
		const neck = length - HEAD_LENGTH;
		if (neck <= start) return;
		if (solid) {
			const count = this.arc.pointsBetween(start, neck, this.linePoints);
			this.line.points = leading(this.linePoints, count, this.lineLists);
			this.line.color = color;
			draw.drawPolyline(this.line);
		} else {
			// Every dot in one draw group (R2.9's drawCircles)
			let count = 0;
			let segment = 1;
			for (let distance = start + DOT_SPACING / 2; distance <= neck; distance += DOT_SPACING) {
				if (count === this.dotPoints.length) this.dotPoints.push({ x: 0, y: 0 });
				segment = this.arc.pointAt(distance, segment, this.dotPoints[count++]);
			}
			this.dots.centers = leading(this.dotPoints, count, this.dotLists);
			this.dots.fill = color;
			if (count > 0) draw.drawCircles(this.dots);
		}
		// The head points from the neck to the tip, as the aiming line's points from its control
		this.arc.pointAt(neck, 1, this.tangent[1]);
		this.tangent[2].x = this.to.x;
		this.tangent[2].y = this.to.y;
		arrowHead(this.tangent, this.head);
		this.headShape.fill = color;
		draw.drawPolygon(this.headShape);
	}

	/**
	 * A box in `view` (its whole token when `rect` is null) in this
	 * preview's space; a token is scaled into its slot, never turned.
	 */
	private box(view: VehicleUI, rect: Readonly<Rect> | null, space: Component, out: Rect): boolean {
		this.local.x = rect ? rect.x : 0;
		this.local.y = rect ? rect.y : 0;
		if (!this.mapIn(view, this.local, space, this.corner)) return false;
		out.x = this.corner.x;
		out.y = this.corner.y;
		this.local.x = rect ? rect.x + rect.width : view.width;
		this.local.y = rect ? rect.y + rect.height : view.height;
		if (!this.mapIn(view, this.local, space, this.corner)) return false;
		out.width = this.corner.x - out.x;
		out.height = this.corner.y - out.y;
		return true;
	}

	/** `point` in `component` into this preview's space, through the parent both hang from. */
	private mapIn(component: Component, point: Vec2, space: Component, out: Vec2): boolean {
		if (!component.localToAncestorInto(point, space, out)) return false;
		out.x -= this.originX;
		out.y -= this.originY;
		return true;
	}
}

/** A raider's arrows in the raiders' red, your convoy's in the interaction yellow. */
function sideColor(view: VehicleUI): RGBA {
	return view.side === 'raider' ? RAIDER_LINE : OWN_LINE;
}

function centreOf(box: Rect, out: Vec2): void {
	out.x = box.x + box.width / 2;
	out.y = box.y + box.height / 2;
}
