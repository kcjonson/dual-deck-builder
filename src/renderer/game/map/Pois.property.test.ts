import { Rng } from '../core/Rng';
import { pointSegmentDistanceSquared } from './Geometry';
import type { MapParamSet } from './MapParams';
import { checkPois } from './PoiChecks';
import { FACTIONS, POI_TUNING, lengthOf } from './PoiData';
import type { PoiMap } from './Pois';
import { checkRoadNetwork } from './RoadChecks';
import { ROAD_CLASS_RULES, turnScale } from './RoadGrowth';
import { rollParams } from './RollParams';
import { LaidMap, degreesBetween, inHardCorner, layMap, paramsFor, sampledPoiParamSets } from './roadTesting';

/**
 * Stage 5's guarantees on generated maps (Area Map Generation, Guarantees 4
 * and 5, and 3 and 8 for the approaches it adds), over parameter sets sampled
 * across the tuning ranges, strongholds, POI density, and routes per POI
 * among them, and over campaign rolls. Each map is laid as the pipeline lays
 * it: stage 5's retries, growth rerun when they run out, and the whole map
 * restarted when growth's do. CI lays a few dozen; set POI_PROPERTY_MAPS to
 * lay more:
 *
 *   POI_PROPERTY_MAPS=300 npx jest Pois.property --coverage=false
 */
const MAPS = Number(process.env.POI_PROPERTY_MAPS ?? 24);
const ROLLS = Math.max(4, Math.round(MAPS / 3));
/** Whole-map restarts a set gets before the test calls it a failure; the spec allows 32, which a test can't afford. */
const MAP_ATTEMPTS = 4;

const rollStream = new Rng({ seed: 2911 });
const CASES: [string, MapParamSet][] = [
	...sampledPoiParamSets(MAPS).map((set, index): [string, MapParamSet] => [`tuning set ${index}`, set]),
	...Array.from({ length: ROLLS }, (_, index): [string, MapParamSet] => [`campaign roll ${index}`, rollParams(rollStream.next())]),
];

describe('stage 5 across the tuning ranges and campaign rolls', () => {
	it.each(CASES)('keeps every guarantee on %s', (label, set) => {
		const params = paramsFor(set);
		// In a hard corner a map isn't promised, so it gets one map attempt and is checked only if it's laid.
		const hard = inHardCorner(params);
		const laid = layMap(set, { mapAttempts: hard ? 1 : MAP_ATTEMPTS });
		if (!hard) expect(laid.laid.pois).not.toBeNull();
		if (label.startsWith('campaign')) expect(laid.mapAttempt).toBe(0);
		const pois = laid.laid.pois;
		if (pois === null) return;

		// Guarantees 2, 3, and 8 over the whole network, approaches included, and the trees they hang on.
		expect(checkRoadNetwork({ network: pois.network, terrain: laid.terrain, clearance: params.roadClearance, limit: 5 })).toEqual([]);
		// Guarantees 4 and 5: every site a dead end, with two to routesTarget approaches whose routes share nothing past the home area.
		expect(checkPois({ map: pois, routesTarget: params.routesTarget, limit: 5 })).toEqual([]);

		expectStrongholdsAllRound(laid, pois);
		expectSitesApartAndClear(laid, pois);
		expectApproachTurns(laid, pois);

		if (Number(label.split(' ').pop()) % 6 === 0) expect(layMap(set, { mapAttempts: hard ? 1 : MAP_ATTEMPTS }).laid).toEqual(laid.laid);
	});
});

/** One stronghold per sector, in the outer band and in its sector, each seating a different faction. */
function expectStrongholdsAllRound({ params, laid, mapAttempt }: LaidMap, pois: PoiMap): void {
	const { band } = POI_TUNING.strongholds;
	const width = 360 / params.strongholds;
	const rotation = new Rng({ seed: params.seed }).fork('map', mapAttempt).fork('pois', laid.attempts.pois).fork('sectors').float() * width;
	expect(pois.strongholds.map(({ sector }) => sector)).toEqual(Array.from({ length: params.strongholds }, (_, sector) => sector));
	expect(new Set(pois.strongholds.map(({ faction }) => faction)).size).toBe(params.strongholds);
	for (const { node, faction, sector } of pois.strongholds) {
		expect(FACTIONS[faction]).toBeDefined();
		const { x, y } = pois.network.nodes[node];
		const distance = Math.hypot(x, y);
		expect(distance).toBeGreaterThanOrEqual(band.inner * params.radius * (1 - 1e-9));
		expect(distance).toBeLessThanOrEqual(band.outer * params.radius * (1 + 1e-9));
		const into = ((Math.atan2(y, x) * 180 / Math.PI - rotation - sector * width) % 360 + 360) % 360;
		// A hair either side for the sector's edges, which the sites are drawn up to.
		expect(into <= width + 1e-6 || into >= 360 - 1e-6).toBe(true);
	}
}

/** Sites the Poisson-disc spacing apart, and every road but a site's own approaches the clearance from it. */
function expectSitesApartAndClear({ params }: LaidMap, pois: PoiMap): void {
	const { network } = pois;
	const spacing = lengthOf(POI_TUNING.sites.spacing, params.radius, params.roadClearance);
	const sites = [...pois.strongholds, ...pois.pois];
	let nearestSite = Infinity;
	let nearestRoad = Infinity;
	sites.forEach((site, index) => {
		const { x, y } = network.nodes[site.node];
		sites.slice(index + 1).forEach((other) => {
			const there = network.nodes[other.node];
			nearestSite = Math.min(nearestSite, Math.hypot(x - there.x, y - there.y));
		});
		network.roads.forEach((road, id) => {
			if (site.approaches.includes(id)) return;
			for (const stretch of road.stretches) {
				const points = network.stretches[stretch].points;
				for (let point = 0; point + 3 < points.length; point += 2) {
					nearestRoad = Math.min(nearestRoad, pointSegmentDistanceSquared(x, y, points[point], points[point + 1], points[point + 2], points[point + 3]));
				}
			}
		});
	});
	expect(nearestSite).toBeGreaterThanOrEqual(spacing);
	expect(Math.sqrt(nearestRoad)).toBeGreaterThanOrEqual(params.roadClearance * (1 - 1e-9));
}

/** Every bend along an approach within its class's turn limit, as curviness scales it. */
function expectApproachTurns({ params }: LaidMap, pois: PoiMap): void {
	const scale = turnScale(params.curviness);
	for (const site of [...pois.strongholds, ...pois.pois]) {
		for (const road of site.approaches) {
			const { points, roadClass } = pois.network.stretches[pois.network.roads[road].stretches[0]];
			expect(roadClass === 'backRoad' || roadClass === 'trail').toBe(true);
			let sharpest = 0;
			for (let at = 2; at + 3 < points.length; at += 2) {
				sharpest = Math.max(sharpest, degreesBetween(points[at] - points[at - 2], points[at + 1] - points[at - 1], points[at + 2] - points[at], points[at + 3] - points[at + 1]));
			}
			expect(sharpest).toBeLessThan(ROAD_CLASS_RULES[roadClass].turnLimit * scale + 1e-6);
		}
	}
}
