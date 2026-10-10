import { Rng } from '../core/Rng';
import { highwayDepartures } from './Highways';
import { MapParamSet, MapParams, resolveMapParams } from './MapParams';
import { validateMapParams } from './ParamValidator';
import type { Exit } from './Places';
import { DRIFT_SPACING, OUTWARD_SHARE, ROAD_CLASS_RULES, driftAt, driftKnots } from './RoadGrowth';

const paramsFor = (set: MapParamSet): MapParams => validateMapParams(resolveMapParams(set).params).params;

/** Exits at the rim on these bearings, highways unless listed in `backRoads`. */
function exitsAt(radius: number, bearings: number[], backRoads: number[] = []): Exit[] {
	return [...bearings, ...backRoads].map((bearing, index) => ({
		id: index + 1,
		kind: 'exit',
		bearing,
		highway: index < bearings.length,
		x: radius * Math.cos(bearing * Math.PI / 180),
		y: radius * Math.sin(bearing * Math.PI / 180),
	}));
}

function plan(set: MapParamSet, exits?: Exit[], seed = 1) {
	const params = paramsFor(set);
	const terrain = { radius: params.radius, metro: { x: 0, y: 0, radius: params.metroSize * params.radius } };
	const bearings = Array.from({ length: params.highways }, (_, index) => (index * 360) / params.highways + 7);
	return { params, terrain, highways: highwayDepartures({ terrain, params, exits: exits ?? exitsAt(params.radius, bearings), rng: new Rng({ seed }) }) };
}

describe('highwayDepartures', () => {
	it('starts a highway on the metro\'s edge at each highway exit\'s bearing, and none toward a back road\'s', () => {
		const params = paramsFor({ seed: 5 });
		const exits = exitsAt(params.radius, [10, 100, 200, 290], [55, 150]);
		const { terrain, highways } = plan({ seed: 5 }, exits);
		expect(highways.map(({ bearing }) => bearing)).toEqual([10, 100, 200, 290]);
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

	it('drifts the same from the same stream, and otherwise from another', () => {
		expect(plan({ seed: 21 }).highways).toEqual(plan({ seed: 21 }).highways);
		expect(plan({ seed: 21 }, undefined, 2).highways).not.toEqual(plan({ seed: 21 }).highways);
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
