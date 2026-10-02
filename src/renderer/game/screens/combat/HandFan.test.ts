import { HAND_CARD_SCALE, fanPoses } from './HandFan';

const DEGREE = Math.PI / 180;

describe('fanPoses', () => {
	it('leaves a single card upright and level', () => {
		expect(fanPoses(1)).toEqual([{ rotate: 0, drop: 0 }]);
	});

	it('turns each card 0.9 degrees per step from the middle, mirrored about it', () => {
		const poses = fanPoses(5);
		expect(poses.map((pose) => pose.rotate / DEGREE)).toEqual([-1.8, -0.9, 0, 0.9, 1.8].map((degrees) => expect.closeTo(degrees, 9)));
		expect(poses[0].drop).toBeCloseTo(poses[4].drop, 9);
		expect(poses[2].drop).toBe(0);
	});

	it('drops the edges along a shallow arc, never more than 5 logical pixels', () => {
		const poses = fanPoses(7);
		// 0.6 per step squared: 5.4 at three steps out, held to 5
		expect(poses[0].drop * HAND_CARD_SCALE).toBeCloseTo(5, 9);
		expect(poses[1].drop * HAND_CARD_SCALE).toBeCloseTo(2.4, 9);
		expect(poses[2].drop * HAND_CARD_SCALE).toBeCloseTo(0.6, 9);
	});

	it('turns a crowded hand more gently', () => {
		expect(fanPoses(8)[0].rotate / DEGREE).toBeCloseTo(-3.5 * 0.5, 9);
	});
});
