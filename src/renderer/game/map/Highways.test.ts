import { Rng } from '../core/Rng';
import { departureBearings, planHighways } from './Highways';
import { MapParamSet, MapParams, resolveMapParams } from './MapParams';
import { validateMapParams } from './ParamValidator';
import { DRIFT_SPACING, OUTWARD_SHARE, ROAD_CLASS_RULES, driftAt, driftKnots } from './RoadGrowth';

/** The highways stream as the pipeline forks it. */
const highwayStream = (seed: number, stageAttempt = 0) => new Rng({ seed }).fork('map', 0).fork('highways', stageAttempt);

const paramsFor = (set: MapParamSet): MapParams => validateMapParams(resolveMapParams(set).params).params;

function plan(set: MapParamSet, stageAttempt = 0) {
	const params = paramsFor(set);
	const terrain = { radius: params.radius, metro: { x: 0, y: 0, radius: params.metroSize * params.radius } };
	return { params, terrain, highways: planHighways({ terrain, params, rng: highwayStream(params.seed, stageAttempt) }) };
}

/** The gaps between neighbouring bearings, counterclockwise round the circle. */
function gaps(bearings: readonly number[]): number[] {
	const sorted = [...bearings].sort((a, b) => a - b);
	return sorted.map((bearing, index) => (index + 1 < sorted.length ? sorted[index + 1] : sorted[0] + 360) - bearing);
}

describe('departureBearings', () => {
	it('keeps every pair of neighbours at least the separation apart, across counts and separations', () => {
		for (let count = 3; count <= 9; count += 1) {
			const most = Math.floor(360 / count);
			[20, 35, Math.min(60, most), most].forEach((separation) => {
				for (let seed = 0; seed < 40; seed += 1) {
					const bearings = departureBearings({ count, separation, rng: new Rng({ seed }) });
					expect(bearings).toHaveLength(count);
					bearings.forEach((bearing) => {
						expect(bearing).toBeGreaterThanOrEqual(0);
						expect(bearing).toBeLessThan(360);
					});
					gaps(bearings).forEach((gap) => expect(gap).toBeGreaterThan(separation - 1e-9));
				}
			});
		}
	});

	it('jitters each bearing by up to a third of the gap, so neighbours sit irregularly', () => {
		let uneven = 0;
		for (let seed = 0; seed < 50; seed += 1) {
			const bearings = departureBearings({ count: 6, separation: 35, rng: new Rng({ seed }) });
			// In departure order, each sits within a third of the gap of even spacing from the first.
			bearings.forEach((bearing, index) => {
				const offset = ((bearing - bearings[0] - index * 60) % 360 + 540) % 360 - 180;
				expect(Math.abs(offset)).toBeLessThanOrEqual(2 * 20 + 1e-9);
			});
			if (gaps(bearings).some((gap) => Math.abs(gap - 60) > 5)) uneven += 1;
		}
		expect(uneven).toBeGreaterThan(40);
	});

	it('spaces them evenly when the separation leaves no room to jitter', () => {
		const bearings = departureBearings({ count: 6, separation: 60, rng: new Rng({ seed: 3 }) });
		gaps(bearings).forEach((gap) => expect(gap).toBeCloseTo(60, 9));
	});
});

describe('planHighways', () => {
	it('starts each highway on the metro\'s edge at its bearing', () => {
		const { terrain, highways, params } = plan({ seed: 5 });
		expect(highways).toHaveLength(params.highways);
		highways.forEach(({ bearing, x, y }) => {
			expect(Math.hypot(x, y)).toBeCloseTo(terrain.metro.radius, 9);
			expect(x).toBeCloseTo(terrain.metro.radius * Math.cos(bearing * Math.PI / 180), 9);
			expect(y).toBeCloseTo(terrain.metro.radius * Math.sin(bearing * Math.PI / 180), 9);
		});
	});

	it('drifts each preferred heading within curviness\'s amplitude, from 0 at the metro, far enough for the longest highway', () => {
		[0, 0.3, 1].forEach((curviness) => {
			const { terrain, highways } = plan({ seed: 9, curviness, radius: 1600 });
			const longest = (terrain.radius - terrain.metro.radius) / OUTWARD_SHARE;
			highways.forEach(({ drift }) => {
				expect(drift[0]).toBe(0);
				expect((drift.length - 1) * DRIFT_SPACING).toBeGreaterThanOrEqual(longest);
				drift.forEach((knot) => expect(Math.abs(knot)).toBeLessThanOrEqual(ROAD_CLASS_RULES.highway.drift * curviness));
			});
			if (curviness === 0) highways.forEach(({ drift }) => drift.forEach((knot) => expect(Math.abs(knot)).toBe(0)));
			else expect(Math.max(...highways.flatMap(({ drift }) => drift.map(Math.abs)))).toBeGreaterThan(0.5 * ROAD_CLASS_RULES.highway.drift * curviness);
		});
	});

	it('plans the same highways from the same stream, and others from another seed or stage attempt', () => {
		expect(plan({ seed: 21 }).highways).toEqual(plan({ seed: 21 }).highways);
		expect(plan({ seed: 22 }).highways).not.toEqual(plan({ seed: 21 }).highways);
		expect(plan({ seed: 21 }, 1).highways).not.toEqual(plan({ seed: 21 }).highways);
	});

	it('draws each highway\'s drift on its own fork, so one more highway never moves another\'s drift', () => {
		const six = plan({ seed: 31, highways: 6 }).highways;
		const seven = plan({ seed: 31, highways: 7 }).highways;
		six.forEach((highway, index) => expect(seven[index].drift).toEqual(highway.drift));
	});
});

describe('driftAt', () => {
	it('passes through the knots and eases between them, holding the last knot beyond', () => {
		const knots = [0, 10, -20];
		expect(driftAt(knots, 0)).toBe(0);
		expect(driftAt(knots, DRIFT_SPACING)).toBe(10);
		expect(driftAt(knots, 2 * DRIFT_SPACING)).toBe(-20);
		expect(driftAt(knots, DRIFT_SPACING / 2)).toBe(5);
		expect(driftAt(knots, DRIFT_SPACING / 4)).toBeCloseTo(10 * 0.15625, 12);
		expect(driftAt(knots, 10 * DRIFT_SPACING)).toBe(-20);
	});

	it('draws one number a knot after the first, so a road\'s drift costs a fixed number of draws', () => {
		const rng = new Rng({ seed: 2 });
		const knots = driftKnots({ rng, span: 1000, amplitude: 30 });
		expect(knots).toHaveLength(Math.floor(1000 / OUTWARD_SHARE / DRIFT_SPACING) + 2);
		const replay = new Rng({ seed: 2 });
		for (let knot = 1; knot < knots.length; knot += 1) replay.float();
		expect(replay.next()).toBe(rng.next());
	});
});
