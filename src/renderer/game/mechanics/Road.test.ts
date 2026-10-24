import {
	RoadLane,
	RoadRow,
	RoadSlot,
	adjacentFormationSlots,
	canTeamUseLane,
	flankLane,
	formationSlots,
	isFormationMove,
	isSwerveStep,
	openingSlots,
	otherFormationLane,
	sameSlot,
	slotBehind,
	slotRange,
	swerveSlot
} from './Road';
import { TeamType } from './TeamType';

describe('Road', () => {
	describe('slotRange', () => {
		// Battle Screen Design section 1: ranges from your inside-center slot
		const origin: RoadSlot = { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.CENTER };
		const lanes = [
			RoadLane.PLAYER_SHOULDER,
			RoadLane.PLAYER_OUTSIDE,
			RoadLane.PLAYER_INSIDE,
			RoadLane.ENEMY_INSIDE,
			RoadLane.ENEMY_OUTSIDE,
			RoadLane.ENEMY_SHOULDER
		];
		const table: Array<[RoadRow, number[]]> = [
			[RoadRow.AHEAD, [3, 2, 1, 2, 3, 4]],
			[RoadRow.CENTER, [2, 1, 0, 1, 2, 3]],
			[RoadRow.BEHIND, [3, 2, 1, 2, 3, 4]]
		];

		for (const [row, ranges] of table) {
			lanes.forEach((lane, index) => {
				test(`inside center to ${lane} ${row} is ${ranges[index]}`, () => {
					expect(slotRange(origin, { lane, row })).toBe(ranges[index]);
				});
			});
		}

		test('is the same in both directions', () => {
			const flanker = { lane: RoadLane.ENEMY_SHOULDER, row: RoadRow.AHEAD };
			const rear = { lane: RoadLane.PLAYER_OUTSIDE, row: RoadRow.BEHIND };
			expect(slotRange(flanker, rear)).toBe(slotRange(rear, flanker));
			expect(slotRange(flanker, rear)).toBe(6);
		});
	});

	describe('lane rules', () => {
		test('a team never uses its own shoulder', () => {
			expect(canTeamUseLane(TeamType.PLAYER, RoadLane.PLAYER_SHOULDER)).toBe(false);
			expect(canTeamUseLane(TeamType.ENEMY, RoadLane.ENEMY_SHOULDER)).toBe(false);
		});

		test("a team flanks onto the other team's shoulder", () => {
			expect(flankLane(TeamType.PLAYER)).toBe(RoadLane.ENEMY_SHOULDER);
			expect(flankLane(TeamType.ENEMY)).toBe(RoadLane.PLAYER_SHOULDER);
			expect(canTeamUseLane(TeamType.PLAYER, RoadLane.ENEMY_SHOULDER)).toBe(true);
			expect(canTeamUseLane(TeamType.ENEMY, RoadLane.PLAYER_SHOULDER)).toBe(true);
		});

		test("a team never enters the other team's formation lanes", () => {
			expect(canTeamUseLane(TeamType.PLAYER, RoadLane.ENEMY_INSIDE)).toBe(false);
			expect(canTeamUseLane(TeamType.PLAYER, RoadLane.ENEMY_OUTSIDE)).toBe(false);
			expect(canTeamUseLane(TeamType.ENEMY, RoadLane.PLAYER_INSIDE)).toBe(false);
			expect(canTeamUseLane(TeamType.ENEMY, RoadLane.PLAYER_OUTSIDE)).toBe(false);
		});
	});

	describe('swerve geometry', () => {
		const { PLAYER_SHOULDER, PLAYER_OUTSIDE, PLAYER_INSIDE, ENEMY_INSIDE, ENEMY_OUTSIDE, ENEMY_SHOULDER } = RoadLane;
		const { AHEAD, CENTER, BEHIND } = RoadRow;
		const at = (lane: RoadLane, row: RoadRow): RoadSlot => ({ lane, row });

		test('one step goes to the other lane, a row ahead, or a row behind', () => {
			const from = at(PLAYER_INSIDE, CENTER);
			expect(swerveSlot(from, 'other_lane')).toEqual(at(PLAYER_OUTSIDE, CENTER));
			expect(swerveSlot(from, 'outside')).toEqual(at(PLAYER_OUTSIDE, CENTER));
			expect(swerveSlot(from, 'ahead')).toEqual(at(PLAYER_INSIDE, AHEAD));
			expect(swerveSlot(from, 'behind')).toEqual(at(PLAYER_INSIDE, BEHIND));
			expect(swerveSlot(at(ENEMY_OUTSIDE, BEHIND), 'other_lane')).toEqual(at(ENEMY_INSIDE, BEHIND));
		});

		test('runs off the formation into nothing, never onto a shoulder', () => {
			expect(swerveSlot(at(PLAYER_INSIDE, AHEAD), 'ahead')).toBeNull();
			expect(swerveSlot(at(ENEMY_INSIDE, BEHIND), 'behind')).toBeNull();
			expect(swerveSlot(at(PLAYER_OUTSIDE, CENTER), 'outside')).toBeNull();
			expect(swerveSlot(at(ENEMY_OUTSIDE, CENTER), 'outside')).toBeNull();
		});

		test('has no step from a shoulder', () => {
			expect(adjacentFormationSlots(at(ENEMY_SHOULDER, CENTER))).toEqual([]);
			expect(swerveSlot(at(PLAYER_SHOULDER, CENTER), 'ahead')).toBeNull();
		});

		test('lists the adjacent formation slots, never diagonal', () => {
			expect(adjacentFormationSlots(at(PLAYER_INSIDE, CENTER))).toEqual([
				at(PLAYER_OUTSIDE, CENTER), at(PLAYER_INSIDE, AHEAD), at(PLAYER_INSIDE, BEHIND)
			]);
			expect(adjacentFormationSlots(at(ENEMY_OUTSIDE, AHEAD))).toEqual([at(ENEMY_INSIDE, AHEAD), at(ENEMY_OUTSIDE, CENTER)]);
		});

		test('a swerve step is range 1 inside one team\'s formation', () => {
			expect(isSwerveStep(TeamType.PLAYER, at(PLAYER_INSIDE, CENTER), at(PLAYER_OUTSIDE, CENTER))).toBe(true);
			// Diagonal is range 2
			expect(isSwerveStep(TeamType.PLAYER, at(PLAYER_INSIDE, CENTER), at(PLAYER_OUTSIDE, AHEAD))).toBe(false);
			// Onto, off, and along a shoulder
			expect(isSwerveStep(TeamType.PLAYER, at(PLAYER_OUTSIDE, CENTER), at(PLAYER_SHOULDER, CENTER))).toBe(false);
			expect(isSwerveStep(TeamType.PLAYER, at(ENEMY_SHOULDER, CENTER), at(ENEMY_OUTSIDE, CENTER))).toBe(false);
			expect(isSwerveStep(TeamType.PLAYER, at(ENEMY_SHOULDER, CENTER), at(ENEMY_SHOULDER, AHEAD))).toBe(false);
			// Across into the other team's formation
			expect(isSwerveStep(TeamType.PLAYER, at(PLAYER_INSIDE, CENTER), at(ENEMY_INSIDE, CENTER))).toBe(false);
			expect(isFormationMove(TeamType.ENEMY, at(ENEMY_INSIDE, AHEAD), at(ENEMY_OUTSIDE, BEHIND))).toBe(true);
		});

		test('names the slot behind, and each team\'s six formation slots', () => {
			expect(slotBehind(at(PLAYER_OUTSIDE, CENTER))).toEqual(at(PLAYER_OUTSIDE, BEHIND));
			expect(slotBehind(at(PLAYER_OUTSIDE, BEHIND))).toBeNull();
			expect(otherFormationLane(ENEMY_SHOULDER)).toBeNull();
			const slots = formationSlots(TeamType.ENEMY);
			expect(slots).toHaveLength(6);
			expect(slots.every(slot => slot.lane === ENEMY_INSIDE || slot.lane === ENEMY_OUTSIDE)).toBe(true);
		});
	});

	describe('openingSlots', () => {
		test('puts the player pair in the inside lane, center then behind', () => {
			const [first, second] = openingSlots(TeamType.PLAYER);
			expect(first).toEqual({ lane: RoadLane.PLAYER_INSIDE, row: RoadRow.CENTER });
			expect(second).toEqual({ lane: RoadLane.PLAYER_INSIDE, row: RoadRow.BEHIND });
		});

		test('lists all six formation slots once each', () => {
			const slots = openingSlots(TeamType.ENEMY);
			expect(slots).toHaveLength(6);
			slots.forEach(slot => {
				expect(canTeamUseLane(TeamType.ENEMY, slot.lane)).toBe(true);
				expect(slots.filter(other => sameSlot(other, slot))).toHaveLength(1);
			});
		});
	});
});
