import { HAND_CARD_SCALE, fanPoses, fanReach } from './HandFan';

const DEGREE = Math.PI / 180;

describe('fanPoses', () => {
	it('leaves a single card upright and level', () => {
		expect(fanPoses(1)).toEqual([{ rotate: 0, drop: 0, order: 0 }]);
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

	it('stacks each card over the one before it', () => {
		expect(fanPoses(4).map((pose) => pose.order)).toEqual([0, 1, 2, 3]);
	});

	it('reaches past the card by its lean and drop, and not at all upright', () => {
		expect(fanReach({ rotate: 0, drop: 0, order: 0 })).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
		const [edge] = fanPoses(5);
		const reach = fanReach(edge);
		// 1.8 degrees: the top corner leans about 6.6 out, the bottom one swings 2.4 down
		expect(reach.left).toBe(reach.right);
		expect(reach.left).toBe(7);
		expect(reach.bottom).toBe(Math.ceil(75 * Math.sin(1.8 * DEGREE) + edge.drop));
	});

	it('turns a crowded hand more gently', () => {
		expect(fanPoses(8)[0].rotate / DEGREE).toBeCloseTo(-3.5 * 0.5, 9);
	});
});
