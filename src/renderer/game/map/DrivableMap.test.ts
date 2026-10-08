import { Rng } from '../core/Rng';
import { STAGE_ATTEMPTS, layDrivableMap } from './DrivableMap';
import { checkPois } from './PoiChecks';
import { placePois } from './Pois';
import { checkRoadNetwork } from './RoadChecks';
import { growRoads } from './RoadGrowth';
import { RoadNetwork } from './RoadNetwork';
import { rollParams } from './RollParams';
import { generateTerrain } from './Terrain';
import { layMap } from './roadTesting';

/** A campaign roll whose terrain stops four of its six highways short of the rim (DDB-290's QA). */
const SHORT_OF_THE_RIM = 3472152493;

function highwaysAtTheRim(network: RoadNetwork): number {
	return network.roads.filter((road) => road.parent === -1
		&& network.nodes[network.stretches[road.stretches[road.stretches.length - 1]].to].kind === 'exit').length;
}

describe('layDrivableMap', () => {
	it('reruns growth when stage 5 runs out of attempts on roads that stop short of the rim', () => {
		const params = rollParams(SHORT_OF_THE_RIM);
		const map = new Rng({ seed: params.seed }).fork('map', 0);
		const terrain = generateTerrain({ params, rng: map.fork('terrain', 0) });
		const laid = layDrivableMap({ terrain, params, map });

		// Growth's first attempt: two highways of six reach the rim, and no stage-5 retry can move a road.
		const first = growRoads({ terrain, params, highways: laid.highways, rng: map.fork('growth', 0) }).network;
		expect(params.highways).toBe(6);
		expect(highwaysAtTheRim(first)).toBe(2);
		expect(laid.failures).toHaveLength(STAGE_ATTEMPTS);
		laid.failures.forEach((failure, run) => expect(failure).toEqual({ growth: 0, pois: run, sector: expect.any(Number) }));

		// Growth's second attempt seats every stronghold on stage 5's next stream.
		expect(laid.attempts).toEqual({ growth: 1, pois: STAGE_ATTEMPTS });
		const pois = laid.pois;
		expect(pois).not.toBeNull();
		if (pois === null) return;
		expect(pois.strongholds).toHaveLength(params.strongholds);
		expect(checkRoadNetwork({ network: pois.network, terrain, clearance: params.roadClearance })).toEqual([]);
		expect(checkPois({ map: pois, routesTarget: params.routesTarget })).toEqual([]);

		// What it returns is exactly that growth with that stage 5.
		const second = growRoads({ terrain, params, highways: laid.highways, rng: map.fork('growth', 1) }).network;
		const replay = placePois({ terrain, params, network: second, rng: map.fork('pois', STAGE_ATTEMPTS) });
		expect(replay.placed && replay.map).toEqual(pois);
	});

	it('gives the same map from the same seed and parameters, and another from the next seed', () => {
		const set = { seed: 11, radius: 700 };
		const first = layMap(set);
		expect(first.laid.pois).not.toBeNull();
		expect(layMap(set).laid).toEqual(first.laid);
		expect(layMap({ ...set, seed: 12 }).laid.pois).not.toEqual(first.laid.pois);
	});

	it('moves nothing in stages 1 to 5 when only the stop tables or the scenery change', () => {
		const set = { seed: 5, radius: 700 };
		const plain = layMap({ ...set, sceneryDensity: 0, streetGrids: 0, countyRoads: 0, brokenHighways: 0, railLines: 0, farmTracks: 0 });
		const dressed = layMap({
			...set, sceneryDensity: 1, streetGrids: 1, countyRoads: 1, brokenHighways: 4, railLines: 4, farmTracks: 1,
			stopTables: { highway: { raiderAmbush: 9 } },
		});
		expect(dressed.laid).toEqual(plain.laid);
		expect(dressed.mapAttempt).toBe(plain.mapAttempt);
	});
});
