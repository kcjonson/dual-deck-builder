import { TeamType } from './TeamType';

/**
 * Lanes across the road, listed left to right as the battle screen draws
 * them. Each team's formation is its inside and outside lanes; each
 * shoulder only holds the other team's flankers.
 * See docs/specs/Combat Rules.md, "The road".
 */
export enum RoadLane {
	PLAYER_SHOULDER = 'player_shoulder',
	PLAYER_OUTSIDE = 'player_outside',
	PLAYER_INSIDE = 'player_inside',
	ENEMY_INSIDE = 'enemy_inside',
	ENEMY_OUTSIDE = 'enemy_outside',
	ENEMY_SHOULDER = 'enemy_shoulder'
}

/**
 * Rows along the road. Ahead is further up the screen.
 */
export enum RoadRow {
	AHEAD = 'ahead',
	CENTER = 'center',
	BEHIND = 'behind'
}

/**
 * One slot on the road grid. One vehicle per slot.
 */
export interface RoadSlot {
	readonly lane: RoadLane;
	readonly row: RoadRow;
}

/**
 * A lane described from its own team's side: inside, outside, or the
 * shoulder a flanker swerves onto.
 */
export type LaneKind = 'inside' | 'outside' | 'shoulder';

/**
 * A formation slot described from its own team's side, so one value means
 * the same place for either team (an escort type's preferred slot).
 */
export interface FormationSlot {
	readonly lane: Exclude<LaneKind, 'shoulder'>;
	readonly row: RoadRow;
}

const LANE_ORDER: readonly RoadLane[] = [
	RoadLane.PLAYER_SHOULDER,
	RoadLane.PLAYER_OUTSIDE,
	RoadLane.PLAYER_INSIDE,
	RoadLane.ENEMY_INSIDE,
	RoadLane.ENEMY_OUTSIDE,
	RoadLane.ENEMY_SHOULDER
];

export const ROW_ORDER: readonly RoadRow[] = [RoadRow.AHEAD, RoadRow.CENTER, RoadRow.BEHIND];

/** One vehicle per row, so a shoulder holds three. */
export const SHOULDER_CAPACITY = ROW_ORDER.length;

// Opening fill order when an encounter doesn't give a vehicle its slot.
// The player's pair lands inside center and inside behind, as the spec asks.
const FORMATION_ROW_FILL: readonly RoadRow[] = [RoadRow.CENTER, RoadRow.BEHIND, RoadRow.AHEAD];

/**
 * Range between two slots: lanes apart plus rows apart, no diagonal shortcut.
 */
export function slotRange(from: RoadSlot, to: RoadSlot): number {
	const lanesApart = Math.abs(LANE_ORDER.indexOf(from.lane) - LANE_ORDER.indexOf(to.lane));
	const rowsApart = Math.abs(ROW_ORDER.indexOf(from.row) - ROW_ORDER.indexOf(to.row));
	return lanesApart + rowsApart;
}

export function sameSlot(a: RoadSlot | null, b: RoadSlot | null): boolean {
	return a !== null && b !== null && a.lane === b.lane && a.row === b.row;
}

export function isShoulder(lane: RoadLane): boolean {
	return lane === RoadLane.PLAYER_SHOULDER || lane === RoadLane.ENEMY_SHOULDER;
}

export function laneKind(lane: RoadLane): LaneKind {
	switch (lane) {
		case RoadLane.PLAYER_INSIDE:
		case RoadLane.ENEMY_INSIDE:
			return 'inside';
		case RoadLane.PLAYER_OUTSIDE:
		case RoadLane.ENEMY_OUTSIDE:
			return 'outside';
		default:
			return 'shoulder';
	}
}

/**
 * The team's own formation lanes, inside first.
 */
export function formationLanes(team: TeamType): readonly [RoadLane, RoadLane] {
	return team === TeamType.PLAYER
		? [RoadLane.PLAYER_INSIDE, RoadLane.PLAYER_OUTSIDE]
		: [RoadLane.ENEMY_INSIDE, RoadLane.ENEMY_OUTSIDE];
}

/**
 * The road slot a formation slot names for a team.
 */
export function resolveFormationSlot(team: TeamType, { lane, row }: FormationSlot): RoadSlot {
	const [inside, outside] = formationLanes(team);
	return { lane: lane === 'inside' ? inside : outside, row };
}

/**
 * The shoulder a team's flankers use: always the other team's.
 */
export function flankLane(team: TeamType): RoadLane {
	return team === TeamType.PLAYER ? RoadLane.ENEMY_SHOULDER : RoadLane.PLAYER_SHOULDER;
}

export function isFormationLane(team: TeamType, lane: RoadLane): boolean {
	return formationLanes(team).includes(lane);
}

/**
 * Whether a team may ever occupy a lane: its own formation lanes, and the
 * other team's shoulder as a flanker. Never its own shoulder.
 */
export function canTeamUseLane(team: TeamType, lane: RoadLane): boolean {
	return isFormationLane(team, lane) || lane === flankLane(team);
}

/**
 * The team's six formation slots in the order an opening fills them.
 */
export function openingSlots(team: TeamType): RoadSlot[] {
	const slots: RoadSlot[] = [];
	for (const lane of formationLanes(team)) {
		for (const row of FORMATION_ROW_FILL) {
			slots.push({ lane, row });
		}
	}
	return slots;
}

/**
 * Human-readable lane name for the combat log, e.g. "enemy shoulder".
 */
export function describeLane(lane: RoadLane): string {
	return lane.replace('_', ' ');
}

/**
 * Human-readable slot name for the combat log, e.g. "enemy shoulder, ahead".
 */
export function describeSlot(slot: RoadSlot): string {
	return `${describeLane(slot.lane)}, ${slot.row}`;
}
