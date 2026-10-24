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

/** Every lane, left to right as the road is drawn. */
export const LANE_ORDER: readonly RoadLane[] = [
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

const LANE_KIND_RANK: Record<LaneKind, number> = { inside: 0, outside: 1, shoulder: 2 };

/**
 * Tie order between two slots equally near something: inside lane, then
 * outside, then shoulder, and within a lane ahead, center, behind. Lanes are
 * read from their own team's side, so the same order picks the escort that
 * carries out an attack order (the player's inside, outside, then the
 * raiders' shoulder) and, mirrored, a raider for Rally the Convoy.
 */
export function compareTieOrder(a: RoadSlot, b: RoadSlot): number {
	return LANE_KIND_RANK[laneKind(a.lane)] - LANE_KIND_RANK[laneKind(b.lane)] ||
		ROW_ORDER.indexOf(a.row) - ROW_ORDER.indexOf(b.row);
}

/**
 * The candidate at the lowest range from a slot, ties broken by
 * compareTieOrder. Candidates off the road are skipped.
 */
export function nearestTo<T>({ to, candidates, slotOf }: { to: RoadSlot; candidates: readonly T[]; slotOf: (candidate: T) => RoadSlot | null }): T | null {
	let best: { candidate: T; slot: RoadSlot; range: number } | null = null;
	for (const candidate of candidates) {
		const slot = slotOf(candidate);
		if (!slot) continue;
		const range = slotRange(slot, to);
		if (!best || range < best.range || (range === best.range && compareTieOrder(slot, best.slot) < 0)) {
			best = { candidate, slot, range };
		}
	}
	return best?.candidate ?? null;
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
 * A direction a one-step swerve takes, read from the mover's own side: its
 * other formation lane, its outside lane (a shove off the inside), or one
 * row ahead or behind in the same lane.
 */
export type SwerveDirection = 'other_lane' | 'outside' | 'ahead' | 'behind';

/** The row one step ahead, or null from the ahead row. */
export function rowAhead(row: RoadRow): RoadRow | null {
	return ROW_ORDER[ROW_ORDER.indexOf(row) - 1] ?? null;
}

/** The row one step behind, or null from the behind row. */
export function rowBehind(row: RoadRow): RoadRow | null {
	return ROW_ORDER[ROW_ORDER.indexOf(row) + 1] ?? null;
}

/** The other lane of the same formation, or null for a shoulder. */
export function otherFormationLane(lane: RoadLane): RoadLane | null {
	switch (lane) {
		case RoadLane.PLAYER_INSIDE: return RoadLane.PLAYER_OUTSIDE;
		case RoadLane.PLAYER_OUTSIDE: return RoadLane.PLAYER_INSIDE;
		case RoadLane.ENEMY_INSIDE: return RoadLane.ENEMY_OUTSIDE;
		case RoadLane.ENEMY_OUTSIDE: return RoadLane.ENEMY_INSIDE;
		default: return null;
	}
}

/**
 * The formation slot one step from `from` in a direction, or null when the
 * step runs off the formation (ahead of the ahead row, out past the outside
 * lane). A shoulder slot has none: shoulders are left only by dropping back.
 */
export function swerveSlot(from: RoadSlot, direction: SwerveDirection): RoadSlot | null {
	if (isShoulder(from.lane)) return null;
	switch (direction) {
		case 'other_lane': {
			const lane = otherFormationLane(from.lane);
			return lane ? { lane, row: from.row } : null;
		}
		case 'outside': {
			const lane = otherFormationLane(from.lane);
			return lane && laneKind(from.lane) === 'inside' ? { lane, row: from.row } : null;
		}
		case 'ahead': {
			const row = rowAhead(from.row);
			return row ? { lane: from.lane, row } : null;
		}
		case 'behind': {
			const row = rowBehind(from.row);
			return row ? { lane: from.lane, row } : null;
		}
	}
}

/**
 * The formation slots one step from `from`: the other lane in its row, then
 * its own lane a row ahead and behind. Never diagonal, never a shoulder, and
 * none from a shoulder. Whether they're free is the board's question.
 */
export function adjacentFormationSlots(from: RoadSlot): RoadSlot[] {
	return (['other_lane', 'ahead', 'behind'] as const)
		.map(direction => swerveSlot(from, direction))
		.filter((slot): slot is RoadSlot => slot !== null);
}

/**
 * The team's six formation slots, inside lane first, each ahead to behind.
 */
export function formationSlots(team: TeamType): RoadSlot[] {
	return formationLanes(team).flatMap(lane => ROW_ORDER.map(row => ({ lane, row })));
}

/**
 * Whether a move between two slots stays inside one team's formation: both
 * slots in its lanes, so never onto, off, or along a shoulder. Shoulders are
 * entered only by flanking and left only by dropping back.
 */
export function isFormationMove(team: TeamType, from: RoadSlot, to: RoadSlot): boolean {
	return isFormationLane(team, from.lane) && isFormationLane(team, to.lane);
}

/**
 * Whether a move is one swerve step: inside the team's formation and to an
 * adjacent slot, one lane over or one row ahead or behind. Range 1, so never
 * diagonal (a diagonal is range 2). Occupied and reserved slots are the
 * board's to check (BoardProjection.slotMoveBlocker).
 */
export function isSwerveStep(team: TeamType, from: RoadSlot, to: RoadSlot): boolean {
	return isFormationMove(team, from, to) && slotRange(from, to) === 1;
}

/**
 * The slot directly behind another in its lane (Slipstream's), or null from
 * the behind row or a shoulder.
 */
export function slotBehind(slot: RoadSlot): RoadSlot | null {
	return swerveSlot(slot, 'behind');
}

/**
 * The team's six formation slots in the order an opening fills them: the
 * inside lane, then the outside, each center, behind, ahead. With
 * `firstRow`, each lane starts from that row instead (a reinforcement wave
 * fills from the row the latest wreck left), the others following in the
 * usual order.
 */
export function openingSlots(team: TeamType, firstRow: RoadRow | null = null): RoadSlot[] {
	const rows = firstRow ? [firstRow, ...FORMATION_ROW_FILL.filter(row => row !== firstRow)] : FORMATION_ROW_FILL;
	const slots: RoadSlot[] = [];
	for (const lane of formationLanes(team)) {
		for (const row of rows) {
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
