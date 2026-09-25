import {
	RoadLane,
	RoadRow,
	RoadSlot,
	canTeamUseLane,
	flankLane,
	openingSlots,
	sameSlot,
	slotRange
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
