import { Component, ComponentOptions, PointerEvents } from '../../../engine/components/Component';
import type { MountContext } from '../../../engine/components/MountContext';
import { Text } from '../../../engine/components/Text';
import type { TweenHandle } from '../../../engine/animation/Animator';
import { linear, resolveEase } from '../../../engine/animation/easing';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { DrawPolygonOptions, DrawRectOptions } from '../../../engine/draw/commands';
import type { Rect, Vec2 } from '../../../engine/draw/geometry';
import { tokens } from '../../../engine/theme/tokens';
import { Vehicle as VehicleData } from '../../mechanics/Vehicle';
import { LANE_ORDER, RoadLane, RoadSlot, isShoulder, sameSlot } from '../../mechanics/Road';
import { Vehicle as VehicleUI } from '../../ui/Vehicle';
import type { EnemyIntent, IntentRow } from '../../ui/IntentMarker';
import type { Driver } from '../../mechanics/Driver';
import { CombatModel } from './CombatModel';
import {
	ROAD_ROW_GUTTER,
	RoadLayout,
	RoadRect,
	computeRoadLayout,
	roadSlotRect,
} from './CombatLayout';
import { ROAD_STYLE, Rgba, rgba } from './combatStyle';
import { DashOptions, HatchOptions, dashedOutlineTriangles, hatchTriangles } from '../../ui/stripes';
import type { RangeLabel } from '../../ui/RangeChip';
import type { AimLosses } from '../../mechanics/AimPreview';

export type { EnemyIntent, IntentType } from '../../ui/IntentMarker';

/** An empty slot's outline sits this far inside its cell (the mock's `.slot`). */
const SLOT_OUTLINE_INSET_X = 6;
const SLOT_OUTLINE_INSET_Y = 4;
const SLOT_DASH: DashOptions = { width: 1, dash: 6, gap: 6 };
/** The lane lines' dashes, 26 on and 26 off; the centre line is twice as wide. */
const LANE_DASH = 26;
const LANE_LINE_WIDTH = 2;
const CENTRE_LINE_WIDTH = 4;
/** The shoulder hatch: 12 px stripes every 24 px, at 45 degrees. */
export const SHOULDER_HATCH: HatchOptions = { period: 24 * Math.SQRT2, stripe: 12 * Math.SQRT2 };
/** How long a swerve from one slot to another takes. */
export const SWERVE_DURATION = tokens.motion.dur_slow;
/** Across the lanes on an S-curve; along the rows early, so the speed change leads and the swerve follows. */
const LANE_EASE = resolveEase(tokens.motion.ease_standard);
const ROW_EASE = resolveEase(tokens.motion.ease_emphasized);

type Side = 'player' | 'enemy';

interface LaneLook {
	label: string;
	/** Whose the lane is: red for the raiders', bone for yours. */
	side: Side;
}

/** A shoulder is named and coloured for the team that may use it, which is never the team it borders. */
const LANE_LOOKS: Readonly<Record<RoadLane, LaneLook>> = {
	[RoadLane.PLAYER_SHOULDER]: { label: 'Raider flank', side: 'enemy' },
	[RoadLane.PLAYER_OUTSIDE]: { label: 'Outside', side: 'player' },
	[RoadLane.PLAYER_INSIDE]: { label: 'Inside', side: 'player' },
	[RoadLane.ENEMY_INSIDE]: { label: 'Inside', side: 'enemy' },
	[RoadLane.ENEMY_OUTSIDE]: { label: 'Outside', side: 'enemy' },
	[RoadLane.ENEMY_SHOULDER]: { label: 'Your flank', side: 'player' },
};

/** A vehicle on the road: its token (a raider's plan rides in it) and the slot-sized rect it's drawn in now. */
interface RoadToken {
	vehicle: VehicleData;
	side: Side;
	view: VehicleUI;
	/** Where it sits, or is swerving to. */
	slot: RoadSlot;
	/** The slot it last landed in, whose outline it hides until it lands somewhere else. */
	landed: RoadSlot;
	/** The slot-sized rect it's in now: its slot's, or between two mid-swerve. */
	readonly at: RoadRect;
	readonly from: Vec2;
	readonly to: RoadRect;
	swerve: TweenHandle<number> | null;
}

export type RoadViewOptions = ComponentOptions & {
	combatData?: CombatModel;
	/** The player's seat a driver sits in, for the tokens' marks. */
	seatOf?: (driver: Driver) => 1 | 2 | null;
};

/**
 * The road (Battle Screen Design, sections 1 and 2): six lanes under a
 * 26 px header, an 18 px row gutter, and the 6x3 grid of fixed slots, with
 * every vehicle on the road in its slot. One component for both teams, since
 * a flanker sits on the other team's side of the road.
 *
 * Everything comes from `computeRoadLayout` on the band's size, so slots
 * never move or resize during a fight; a vehicle changing slot swerves from
 * one to the other on the animator, which reduced motion lands at once.
 *
 * The ground is the view's own draws, created on resize (and the empty-slot
 * outlines when a token arrives, leaves, or lands) and only replayed each
 * frame. The road
 * art runs `bleed` past each side, to the screen's edges where the stage is
 * capped (section 2: the road runs on, the UI does not).
 */
export class RoadView extends Component {
	private readonly combatData: CombatModel | null;
	private readonly seatOf: ((driver: Driver) => 1 | 2 | null) | undefined;
	private currentLayout: RoadLayout;
	private sideBleed = 0;
	private readonly roadTokens = new Map<string, RoadToken>();
	private readonly plannedIntents = new Map<string, readonly EnemyIntent[]>();
	private readonly laneHeads: Text[];
	private readonly rowLabels: Text[];
	private readonly fixedChildren: number;

	// The ground, rebuilt on resize
	private readonly shoulderGrounds: DrawRectOptions[] = [];
	private readonly hatches: DrawPolygonOptions[] = [];
	private readonly laneTints: DrawRectOptions[] = [];
	private readonly laneLines: DrawRectOptions[] = [];
	private readonly headerStrip: DrawRectOptions[] = [];
	// Rebuilt when a token arrives, leaves, or lands: one triangle list per side's colour
	private readonly slotOutlines: readonly (DrawPolygonOptions & { points: Vec2[] })[] = [
		{ points: [], fill: ROAD_STYLE.slotOutline },
		{ points: [], fill: ROAD_STYLE.raiderSlotOutline },
	];
	private readonly dashScratch: Vec2[] = [];

	constructor({ combatData, seatOf, ...options }: RoadViewOptions) {
		super(options);
		this.componentType = 'RoadView';
		this.combatData = combatData ?? null;
		this.seatOf = seatOf;
		this.currentLayout = computeRoadLayout({ width: this.width, height: this.height });

		this.laneHeads = LANE_ORDER.map((lane) => {
			const look = LANE_LOOKS[lane];
			const head = new Text({
				id: this.partId(`head_${lane}`),
				text: look.label,
				wrap: 'none',
				textOverflow: 'ellipsis',
				verticalAlign: 'middle',
				pointerEvents: 'none',
				style: {
					fontRole: 'display',
					fontSize: 12,
					letterSpacing: 0.12,
					textTransform: 'uppercase',
					textAlign: 'center',
					color: look.side === 'enemy' ? ROAD_STYLE.raiderHeaderLabel : ROAD_STYLE.headerLabel,
				},
			});
			this.addChild(head);
			return head;
		});
		// Read up the gutter, turned a quarter to the left
		this.rowLabels = this.currentLayout.rows.map(({ row }) => {
			const label = new Text({
				id: this.partId(`row_${row}`),
				text: row.toUpperCase(),
				wrap: 'none',
				verticalAlign: 'middle',
				pointerEvents: 'none',
				transform: { rotate: -Math.PI / 2 },
				style: { fontRole: 'mono', fontSize: 11, letterSpacing: 0.14, textAlign: 'center', color: rgba('text_faint') },
			});
			this.addChild(label);
			return label;
		});
		this.fixedChildren = this.children.length;
		this.layoutRoad();
	}

	/** The road's geometry now: lanes, rows, and every slot's size. */
	public get roadLayout(): RoadLayout {
		return this.currentLayout;
	}

	/** A slot's rect in this view's space, for anything placed against a slot (range labels, the fit suite). */
	public slotRect(slot: RoadSlot, out?: RoadRect): RoadRect {
		return roadSlotRect(this.currentLayout, slot, out);
	}

	/** How far the road art runs past each side of the view, to the screen's edges. */
	public get bleed(): number {
		return this.sideBleed;
	}

	public set bleed(value: number) {
		const bleed = Math.max(0, value);
		if (bleed === this.sideBleed) return;
		this.sideBleed = bleed;
		this.buildGround();
		this.invalidateInk();
	}

	/** Like a container, the road itself is never a target; its vehicles are, and a card let go on it cancels. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'passthrough';
	}

	protected get cullInk(): Rect | null {
		return { x: -this.sideBleed, y: 0, width: this.width + this.sideBleed * 2, height: this.height };
	}

	/** The plate showing a vehicle, while it's on the road. */
	public vehicleView(vehicleId: string): VehicleUI | null {
		return this.roadTokens.get(vehicleId)?.view ?? null;
	}

	/** The row showing a raider's plan, while the raider is on the road. */
	public intentRowOf(vehicleId: string): IntentRow | null {
		return this.roadTokens.get(vehicleId)?.view.intentsRow ?? null;
	}

	/** The slot a vehicle's token sits in, or is swerving to. */
	public slotOf(vehicleId: string): RoadSlot | null {
		return this.roadTokens.get(vehicleId)?.slot ?? null;
	}

	/** Whether a vehicle's token is between two slots now. */
	public isSwerving(vehicleId: string): boolean {
		return this.roadTokens.get(vehicleId)?.swerve?.running ?? false;
	}

	/**
	 * Both teams' vehicles. Those with a slot get a token there; one that has
	 * changed slot swerves to it; one that has left the road loses its token.
	 * Raiders come first in the tree, so focus meets them before your own.
	 */
	public showVehicles({ player, enemy }: { player: readonly VehicleData[]; enemy: readonly VehicleData[] }): void {
		const onRoad = new Set<string>();
		let created = false;
		let occupancyChanged = false;
		const show = (vehicle: VehicleData, side: Side): void => {
			const slot = vehicle.slot;
			if (!slot) return;
			onRoad.add(vehicle.id);
			const token = this.roadTokens.get(vehicle.id);
			if (!token) {
				this.roadTokens.set(vehicle.id, this.createToken(vehicle, side, slot));
				created = true;
				occupancyChanged = true;
				return;
			}
			token.vehicle = vehicle;
			token.view.data = vehicle;
			// Its outlines follow when it lands
			if (!sameSlot(token.slot, slot)) this.swerveTo(token, slot);
		};
		for (const vehicle of enemy) show(vehicle, 'enemy');
		for (const vehicle of player) show(vehicle, 'player');

		for (const [vehicleId, token] of this.roadTokens) {
			if (onRoad.has(vehicleId)) continue;
			this.removeToken(token);
			this.roadTokens.delete(vehicleId);
			occupancyChanged = true;
		}
		if (created) this.orderTokens(enemy, player);
		if (occupancyChanged) this.buildSlotOutlines();
	}

	/**
	 * Each listed vehicle's range chip while a card is aimed (section 6);
	 * every other token's goes. An empty map clears them all.
	 */
	public showRanges(labels: ReadonlyMap<string, RangeLabel>): void {
		for (const [vehicleId, token] of this.roadTokens) token.view.rangeLabel = labels.get(vehicleId) ?? null;
	}

	/** The damage ghost on one vehicle, clearing it everywhere else; null clears them all. */
	public showDamageGhost(vehicleId: string | null, losses: AimLosses | null): void {
		for (const [id, token] of this.roadTokens) token.view.damageGhost = id === vehicleId ? losses : null;
	}

	/** A raider's plan for the enemy turn, in order; empty clears it. */
	public setVehicleIntents(vehicleId: string, intents: readonly EnemyIntent[]): void {
		if (intents.length === 0) this.plannedIntents.delete(vehicleId);
		else this.plannedIntents.set(vehicleId, intents);
		const token = this.roadTokens.get(vehicleId);
		if (token) token.view.intents = intents;
	}

	protected onResized(): void {
		this.layoutRoad();
	}

	/** A swerve cut short by an unmount lands where it was going. */
	protected onMount(context: MountContext): void {
		super.onMount(context);
		for (const token of this.roadTokens.values()) {
			if (token.swerve?.running) continue;
			this.land(token);
		}
	}

	private partId(suffix: string): string | undefined {
		return this.id === null ? undefined : `${this.id}_${suffix}`;
	}

	/** Stable ids from the slot a vehicle arrives in: vehicle ids are random per load, and slots are unique. */
	private createToken(vehicle: VehicleData, side: Side, slot: RoadSlot): RoadToken {
		const view = new VehicleUI({
			id: `${side}_vehicle_${slot.lane}_${slot.row}`,
			vehicleData: vehicle,
			side: side === 'enemy' ? 'raider' : 'player',
			seatOf: this.seatOf,
			combatData: this.combatData ?? undefined,
			onClick: (target) => this.combatData?.targetVehicle(target),
		});
		if (side === 'enemy') view.intents = this.plannedIntents.get(vehicle.id) ?? [];
		this.addChild(view);
		const token: RoadToken = {
			vehicle,
			side,
			view,
			slot,
			landed: slot,
			at: { x: 0, y: 0, width: 0, height: 0 },
			from: { x: 0, y: 0 },
			to: { x: 0, y: 0, width: 0, height: 0 },
			swerve: null,
		};
		this.land(token);
		return token;
	}

	private removeToken(token: RoadToken): void {
		token.swerve?.cancel();
		token.swerve = null;
		this.removeChild(token.view);
	}

	/** Raiders, then your vehicles, each team in its own order, after the labels. */
	private orderTokens(enemy: readonly VehicleData[], player: readonly VehicleData[]): void {
		let index = this.fixedChildren;
		for (const vehicle of [...enemy, ...player]) {
			const token = this.roadTokens.get(vehicle.id);
			if (!token) continue;
			this.moveChild(token.view, index++);
		}
	}

	/** Straight into its slot, ending any swerve; the slot it left shows its outline again. */
	private land(token: RoadToken): void {
		token.swerve?.cancel();
		token.swerve = null;
		this.raise(token, false);
		roadSlotRect(this.currentLayout, token.slot, token.at);
		this.placeToken(token);
		if (sameSlot(token.landed, token.slot)) return;
		token.landed = token.slot;
		this.buildSlotOutlines();
	}

	private swerveTo(token: RoadToken, slot: RoadSlot): void {
		token.slot = slot;
		const animator = this.context?.animator;
		if (!animator || !this.isMounted) {
			this.land(token);
			return;
		}
		token.swerve?.cancel();
		token.from.x = token.at.x;
		token.from.y = token.at.y;
		roadSlotRect(this.currentLayout, slot, token.to);
		// Over the vehicles it passes
		this.raise(token, true);
		token.swerve = animator.tween({
			from: 0,
			to: 1,
			duration: SWERVE_DURATION,
			ease: linear,
			owner: this,
			onUpdate: (progress) => {
				token.at.x = token.from.x + (token.to.x - token.from.x) * LANE_EASE(progress);
				token.at.y = token.from.y + (token.to.y - token.from.y) * ROW_EASE(progress);
				this.placeToken(token);
			},
			onComplete: () => this.land(token),
		});
	}

	private raise(token: RoadToken, raised: boolean): void {
		const zIndex = raised ? 1 : 0;
		token.view.zIndex = zIndex;
	}

	/** The token centred in the rect it's in now, at the layout's one scale (the token holds it to x1 to x1.25). */
	private placeToken(token: RoadToken): void {
		token.view.fitToSlot(token.at, this.currentLayout.tokenScale);
	}

	/** Everything from the band's size: the ground, the labels, and every token back in its slot. */
	private layoutRoad(): void {
		const layout = computeRoadLayout({ width: this.width, height: this.height });
		this.currentLayout = layout;
		layout.lanes.forEach((lane, index) => {
			const head = this.laneHeads[index];
			head.setPosition(lane.x, 0);
			head.setSize(lane.width, layout.headerHeight);
		});
		layout.rows.forEach((row, index) => {
			// Laid out across, then turned about its centre into the gutter
			const label = this.rowLabels[index];
			label.setSize(row.height, ROAD_ROW_GUTTER);
			label.setPosition(layout.gutterX + ROAD_ROW_GUTTER / 2 - row.height / 2, row.y + row.height / 2 - ROAD_ROW_GUTTER / 2);
		});
		for (const token of this.roadTokens.values()) this.land(token);
		this.buildGround();
		this.buildSlotOutlines();
	}

	private buildGround(): void {
		const layout = this.currentLayout;
		const { width, height } = this;
		const bleed = this.sideBleed;
		const lanes = layout.lanes;
		this.shoulderGrounds.length = 0;
		this.hatches.length = 0;
		this.laneTints.length = 0;
		this.laneLines.length = 0;
		this.headerStrip.length = 0;
		if (width <= 0 || height <= 0) return;

		// Each shoulder from its lane's inner edge out to the screen's edge,
		// hatched, and tinted over its lane for the team that uses it
		const leftEdge = lanes[1].x;
		const rightEdge = lanes[5].x;
		const shoulders: Rect[] = [
			{ x: -bleed, y: 0, width: leftEdge + bleed, height },
			{ x: rightEdge, y: 0, width: width + bleed - rightEdge, height },
		];
		for (const rect of shoulders) {
			this.shoulderGrounds.push({ rect, fill: ROAD_STYLE.shoulderGround });
			this.hatches.push({ points: hatchTriangles(rect, SHOULDER_HATCH), fill: ROAD_STYLE.shoulderStripe });
		}
		for (const lane of lanes) {
			const look = LANE_LOOKS[lane.lane];
			let tint: Rgba | null = null;
			if (look.side === 'enemy') tint = ROAD_STYLE.raiderLaneTint;
			else if (isShoulder(lane.lane)) tint = ROAD_STYLE.playerShoulderTint;
			if (tint) this.laneTints.push({ rect: { x: lane.x, y: 0, width: lane.width, height }, fill: tint });
		}

		// Between lanes, under the header: solid at the shoulders' edges,
		// dashed between a team's lanes, and the wide yellow centre line
		// where the two inside lanes meet at range 1
		const top = layout.headerHeight;
		for (let index = 1; index < lanes.length; index++) {
			const x = lanes[index].x;
			if (index === 1 || index === lanes.length - 1) {
				this.laneLines.push({ rect: { x: x - LANE_LINE_WIDTH / 2, y: top, width: LANE_LINE_WIDTH, height: height - top }, fill: ROAD_STYLE.edgeLine });
				continue;
			}
			const centre = index === lanes.length / 2;
			const lineWidth = centre ? CENTRE_LINE_WIDTH : LANE_LINE_WIDTH;
			const fill = centre ? ROAD_STYLE.centreLine : ROAD_STYLE.laneDash;
			for (let y = top; y < height; y += LANE_DASH * 2) {
				this.laneLines.push({ rect: { x: x - lineWidth / 2, y, width: lineWidth, height: Math.min(LANE_DASH, height - y) }, fill });
			}
		}

		this.headerStrip.push(
			{ rect: { x: -bleed, y: 0, width: width + bleed * 2, height: layout.headerHeight }, fill: ROAD_STYLE.header },
			{ rect: { x: -bleed, y: layout.headerHeight - 1, width: width + bleed * 2, height: 1 }, fill: ROAD_STYLE.headerRule },
		);
	}

	/**
	 * A faint dashed outline in every slot nobody has landed in, so the grid
	 * reads as a board; a swerving token keeps its old slot's outline hidden
	 * until it lands. Each side's colour is one triangle list, so the
	 * outlines cost two draws however many slots are empty.
	 */
	private buildSlotOutlines(): void {
		const [player, raider] = this.slotOutlines;
		player.points.length = 0;
		raider.points.length = 0;
		const layout = this.currentLayout;
		if (layout.slotWidth <= SLOT_OUTLINE_INSET_X * 2 || layout.slotHeight <= SLOT_OUTLINE_INSET_Y * 2) return;
		const taken = new Set<string>();
		for (const token of this.roadTokens.values()) taken.add(`${token.landed.lane}:${token.landed.row}`);
		const cell: RoadRect = { x: 0, y: 0, width: 0, height: 0 };
		for (const { lane } of layout.lanes) {
			const points = LANE_LOOKS[lane].side === 'enemy' ? raider.points : player.points;
			for (const { row } of layout.rows) {
				if (taken.has(`${lane}:${row}`)) continue;
				roadSlotRect(layout, { lane, row }, cell);
				cell.x += SLOT_OUTLINE_INSET_X;
				cell.y += SLOT_OUTLINE_INSET_Y;
				cell.width -= SLOT_OUTLINE_INSET_X * 2;
				cell.height -= SLOT_OUTLINE_INSET_Y * 2;
				for (const point of dashedOutlineTriangles(cell, SLOT_DASH, this.dashScratch)) points.push(point);
			}
		}
	}

	public render(draw: DrawApi): void {
		for (const ground of this.shoulderGrounds) draw.drawRect(ground);
		for (const hatch of this.hatches) draw.drawPolygon(hatch);
		for (const tint of this.laneTints) draw.drawRect(tint);
		for (const line of this.laneLines) draw.drawRect(line);
		for (const outline of this.slotOutlines) {
			if (outline.points.length > 0) draw.drawPolygon(outline);
		}
		for (const strip of this.headerStrip) draw.drawRect(strip);
	}
}
