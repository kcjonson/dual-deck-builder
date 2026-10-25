import { Component, ComponentOptions, ResolvedColors } from '../../../engine/components/Component';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { DrawCircleOptions, DrawPolygonOptions, DrawPolylineOptions } from '../../../engine/draw/commands';
import type { RGBA, Rect, Vec2 } from '../../../engine/draw/geometry';
import { resolveColor } from '../../../engine/style/styleObject';
import { tokens } from '../../../engine/theme/tokens';
import type { Vehicle as VehicleUI } from '../../ui/Vehicle';
import type { CardTargets } from './cardTargets';
import { DOT_RADIUS, DOT_SPACING, HEAD_INDICES, HEAD_LENGTH, arrowHead } from './CombatFxLayer';
import type { RoadRect } from './CombatLayout';
import { RoadArc } from './RoadArc';
import type { RoadView } from './RoadView';

/** A solid arrow's line, as wide as the dotted one's dots. */
const SOLID_WIDTH = 3;
/** At the raiders' intent lines' 80%, in the colour each target lights in while aimed. */
const RAIDER_LINE: RGBA = resolveColor('rgba(255, 106, 85, 0.8)');
const OWN_LINE: RGBA = [tokens.color.accent[0], tokens.color.accent[1], tokens.color.accent[2], 0.8];

/**
 * A hand card's targets and moves while it has the pointer or keyboard
 * focus on your turn (Battle Screen Design section 6, planning).
 *
 * - Targets: an arrow from the vehicle the card would act from (the
 *   playing driver's, or an attack order's escort) to each vehicle it
 *   would offer if picked, arcing over the road as the raiders' intent
 *   lines do (`RoadArc.trace`): up from the top of the acting vehicle's
 *   plate, and down onto the top of the target's token, over a raider's
 *   intent pills. Solid when there's nothing to choose, one target or a
 *   card that lands on all of them; the aiming line's dots when the player
 *   will pick one of several. A card on the vehicle it acts from draws no
 *   arrow to itself.
 * - Moves: for a card that moves vehicles (`CardTargets.moves`), an arrow
 *   from each vehicle it would move to the slot it would go to
 *   (`RoadArc.traceMove`), coming out from under the vehicle's token and
 *   ending in the middle of the slot. Solid when the card plays only one
 *   way; dotted when the move hangs on a target or a slot the player picks.
 *
 * Red to and for a raider, the interaction yellow for your convoy, as
 * their outlines light while aimed.
 *
 * Covers the road over its tokens, in the road band's own layer, ordered
 * under the log drawer like the end-turn preview. Both ends are read from
 * the road's tokens at paint time, so it follows a swerve or a rescale
 * with no bookkeeping, into buffers it reuses.
 */
export class TargetPreview extends Component {
	private readonly road: RoadView;
	private targets: CardTargets | null = null;
	private readonly arc = new RoadArc();
	private readonly from: Vec2 = { x: 0, y: 0 };
	private readonly to: Vec2 = { x: 0, y: 0 };
	private readonly local: Vec2 = { x: 0, y: 0 };
	private readonly slotBox: RoadRect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly tokenBox: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly corner: Vec2 = { x: 0, y: 0 };
	/** The solid line's points, and the list handed to the draw, holding only the ones in use. */
	private readonly linePoints: Vec2[] = [];
	private readonly lineView: Vec2[] = [];
	private readonly tangent: [Vec2, Vec2, Vec2] = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
	private readonly head: [Vec2, Vec2, Vec2] = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
	private readonly dot: DrawCircleOptions & { center: Vec2; fill: RGBA } = { center: { x: 0, y: 0 }, radius: DOT_RADIUS, fill: RAIDER_LINE };
	private readonly line: DrawPolylineOptions & { color: RGBA } = { points: this.lineView, color: RAIDER_LINE, width: SOLID_WIDTH, cap: 'round' };
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
	}

	/** Whether its target arrows are solid: one target, or a card that lands on every one it lists. */
	public get solid(): boolean {
		const targets = this.targets;
		return !!targets && (!targets.picks || targets.vehicleIds.length + targets.slots.length === 1);
	}

	public get resolvedColors(): ResolvedColors | null {
		return this.targets ? { fill: this.dot.fill } : null;
	}

	public render(draw: DrawApi): void {
		const targets = this.targets;
		const space = this.parent;
		if (!targets || !space) return;
		const solid = this.solid;
		for (const targetId of targets.vehicleIds) {
			const sourceId = targets.carrierIds.get(targetId) ?? targets.sourceId;
			const target = this.road.vehicleView(targetId);
			if (sourceId === null || sourceId === targetId || !target?.isMounted || target.isWrecked) continue;
			if (!this.plateTop(sourceId, space, this.from) || !this.tokenTop(target, space, this.to)) continue;
			const length = this.arc.trace(this.from, this.to);
			this.drawArrow(draw, { start: 0, length, solid, color: target.side === 'raider' ? RAIDER_LINE : OWN_LINE });
		}
		for (const move of targets.moves) {
			const mover = this.road.vehicleView(move.vehicleId);
			if (!mover?.isMounted || mover.isWrecked || !this.plateCentre(mover, space, this.from) || !this.box(mover, space, this.tokenBox)) continue;
			const slot = this.road.slotRect(move.to, this.slotBox);
			this.local.x = slot.x + slot.width / 2;
			this.local.y = slot.y + slot.height / 2;
			if (!this.mapIn(this.road, this.local, space, this.to)) continue;
			const length = this.arc.traceMove(this.from, this.to);
			this.drawArrow(draw, { start: this.arc.leaves(this.tokenBox), length, solid: !move.choice, color: mover.side === 'raider' ? RAIDER_LINE : OWN_LINE });
		}
	}

	/** The middle of a vehicle's plate, where its move leaves from. */
	private plateCentre(view: VehicleUI, space: Component, out: Vec2): boolean {
		const plate = view.plateRect;
		this.local.x = plate.x + plate.width / 2;
		this.local.y = plate.y + plate.height / 2;
		return this.mapIn(view, this.local, space, out);
	}

	/** A token's whole box in this preview's space; a token is scaled into its slot, never turned. */
	private box(view: VehicleUI, space: Component, out: Rect): boolean {
		this.local.x = 0;
		this.local.y = 0;
		if (!this.mapIn(view, this.local, space, this.corner)) return false;
		out.x = this.corner.x;
		out.y = this.corner.y;
		this.local.x = view.width;
		this.local.y = view.height;
		if (!this.mapIn(view, this.local, space, this.corner)) return false;
		out.width = this.corner.x - out.x;
		out.height = this.corner.y - out.y;
		return true;
	}

	/** The middle of a vehicle's plate's top edge, where its arrows leave. */
	private plateTop(vehicleId: string, space: Component, out: Vec2): boolean {
		const view = this.road.vehicleView(vehicleId);
		if (!view?.isMounted) return false;
		const plate = view.plateRect;
		this.local.x = plate.x + plate.width / 2;
		this.local.y = plate.y;
		return this.mapIn(view, this.local, space, out);
	}

	/** Over the middle of a vehicle's plate at the top of its token, above the band a raider's pills take, where an arrow lands. */
	private tokenTop(view: VehicleUI, space: Component, out: Vec2): boolean {
		const plate = view.plateRect;
		this.local.x = plate.x + plate.width / 2;
		this.local.y = 0;
		return this.mapIn(view, this.local, space, out);
	}

	/**
	 * Along the traced arc, `length` long, from `start` along it: a line or
	 * dots up to the head, then the head pointing along the arc's end at
	 * `to`. Nothing when the head wouldn't fit past the start.
	 */
	private drawArrow(draw: DrawApi, { start, length, solid, color }: { start: number; length: number; solid: boolean; color: RGBA }): void {
		const neck = length - HEAD_LENGTH;
		if (neck <= start) return;
		if (solid) {
			const count = this.arc.pointsBetween(start, neck, this.linePoints);
			this.lineView.length = 0;
			for (let index = 0; index < count; index++) this.lineView.push(this.linePoints[index]);
			this.line.color = color;
			draw.drawPolyline(this.line);
		} else {
			this.dot.fill = color;
			let segment = 1;
			for (let distance = start + DOT_SPACING / 2; distance <= neck; distance += DOT_SPACING) {
				segment = this.arc.pointAt(distance, segment, this.dot.center);
				draw.drawCircle(this.dot);
			}
		}
		// The head points from the neck to the tip, as the aiming line's points from its control
		this.arc.pointAt(neck, 1, this.tangent[1]);
		this.tangent[2].x = this.to.x;
		this.tangent[2].y = this.to.y;
		arrowHead(this.tangent, this.head);
		this.headShape.fill = color;
		draw.drawPolygon(this.headShape);
	}

	/** `point` in `component` into this preview's space, through the parent both hang from. */
	private mapIn(component: Component, point: Vec2, space: Component, out: Vec2): boolean {
		if (!component.localToAncestorInto(point, space, out)) return false;
		out.x -= this.originX;
		out.y -= this.originY;
		return true;
	}
}
