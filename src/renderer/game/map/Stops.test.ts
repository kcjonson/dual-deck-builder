import { Rng } from '../core/Rng';
import { STOPS_STAGE, ROUTE_TREE_STAGE, poisStage } from './AreaMapPipeline';
import type { MapParams, StopTables } from './MapParams';
import { MapPipeline, MapPipelineError } from './MapPipeline';
import { MeshMapOptions, fakeGround, meshFrom, meshMap, randomMesh } from './meshTesting';
import { POI_TUNING, PoiTuning } from './PoiData';
import { placePois } from './Pois';
import type { RoadNetwork } from './RoadNetwork';
import { buildRouteTree, legPoints, pointAlong, routesTo } from './RouteTree';
import { paramsFor } from './roadTesting';
import { checkStopLayer, typesAlong } from './StopChecks';
import stopTablesFile from '../data/stopTables.json';
import { STOP_TUNING, STOP_TYPES, StopTuning, StopType, isCalm, isFight } from './StopData';
import { DAYLIGHT_TIERS, StopLayer, junctionsAlong, keepsRules, nearestClear, nodeDegrees, placeStops, pointsAlong, rollStop } from './Stops';

/** The shipped tables with some types' class weights replaced, everywhere. */
function tablesWith(weights: Partial<Record<StopType, number>>): StopTables {
	const classes = Object.fromEntries(Object.entries(stopTablesFile.classes).map(([roadClass, row]) => [roadClass, { ...row, ...weights }]));
	return { ...stopTablesFile, classes };
}

/** A tuning with some fields replaced. */
const tuned = (fields: Partial<StopTuning>): StopTuning => ({ ...STOP_TUNING, ...fields });

const meshes = Array.from({ length: 8 }, (_, index) => randomMesh({ seed: 500 + index, spacing: 80 + 3 * index }));

const mapOn = (index: number, options: MeshMapOptions = {}) => meshMap(meshes[index], { seed: index, ...options });

/** Every route to every POI, with the types of its stops in driving order. */
function routeTypes(layer: ReturnType<typeof mapOn>['products']): StopType[][] {
	return layer.pois.pois.flatMap((poi) => routesTo(layer.pois, poi).map((route) => typesAlong(layer.stops, route)));
}

describe('stops on legs', () => {
	it('keep every rule the checks know, on random meshes', () => {
		meshes.forEach((_, index) => {
			const { network, params, products } = mapOn(index);
			expect(checkStopLayer({ network, layer: products.pois, stops: products.stops, params })).toEqual([]);
			expect(products.stops.legs).toHaveLength(products.pois.legs.length);
			expect(products.stops.stops.length).toBeGreaterThan(products.pois.legs.length / 2);
		});
	});

	it('sit only on legs, never on roads no route uses, and a map with no POIs has none', () => {
		const { products } = mapOn(0);
		for (const stop of products.stops.stops) expect(products.pois.legs[stop.leg]).toBeDefined();
		const empty = placeStops({ network: meshes[0], layer: { pois: [], strongholds: [], sectorRotation: 0, legs: [], rings: [], failures: [] }, ground: fakeGround(), params: { stopDensity: 1, dangerCurve: 1, driverFinds: 2, daylightHours: 14 }, rng: new Rng({ seed: 1 }) });
		expect(empty).toMatchObject({ stops: [], legs: [], thinned: 0, failures: [] });
	});

	describe('by arc length', () => {
		// A loop out from the compound with one POI on its far stretch, a leg each way round; a spur off (300, 250) makes it a junction.
		const network = meshFrom({ nodes: [[0, 0], [300, 250], [300, -250], [600, 0], [300, 400]], edges: [[0, 1], [0, 2], [1, 3], [2, 3], [1, 4]] });
		const poiTuning: PoiTuning = { ...POI_TUNING, rings: { ...POI_TUNING.rings, targets: [0, 1, 1, 1] }, cover: [] };
		const tree = buildRouteTree({ network, travelPace: 1, routeSplit: 0.5 });
		const layer = placePois({ network, tree, ground: fakeGround(), params: { strongholds: 2, poiDensity: 1 }, rng: new Rng({ seed: 1 }), tuning: poiTuning });
		const params = { stopDensity: 1, dangerCurve: 1, driverFinds: 0, daylightHours: 16 };

		it('count a leg\'s stops by its length by class over the class\'s spacing, rounded up or down by a draw', () => {
			const spacing = { highway: 150, backRoad: 100, trail: 100 };
			const counts = layer.legs.map(() => new Set<number>());
			let total = 0;
			for (let seed = 0; seed < 40; seed += 1) {
				const stops = placeStops({ network, layer, ground: fakeGround(), params, rng: new Rng({ seed }), tuning: tuned({ spacing }) });
				stops.legs.forEach(({ stops: ids }, leg) => counts[leg].add(ids.length));
				total += stops.stops.length;
			}
			const expected = layer.legs.map(({ length }) => length / 100);
			counts.forEach((seen, leg) => expect([...seen].every((count) => count === Math.floor(expected[leg]) || count === Math.ceil(expected[leg]))).toBe(true));
			// Over many streams the mean comes to what the road earns.
			expect(total / 40).toBeCloseTo(expected[0] + expected[1], 0);
			const doubled = placeStops({ network, layer, ground: fakeGround(), params: { ...params, stopDensity: 2 }, rng: new Rng({ seed: 1 }), tuning: tuned({ spacing }) });
			expect(doubled.stops.length).toBeGreaterThanOrEqual(2 * Math.floor(expected[0] + expected[1]) - 2);
		});

		it('spread them evenly along the leg by arc length, each in its own slot, clear of the ends and of junctions, and minGap apart', () => {
			const tuning = tuned({ jitter: 0, spacing: { highway: 45, backRoad: 45, trail: 45 } });
			// Daylight to spare, so nothing's thinned.
			const stops = placeStops({ network, layer, ground: fakeGround(), params: { ...params, daylightHours: 100 }, rng: new Rng({ seed: 3 }), tuning });
			const degrees = nodeDegrees(network);
			// The quickest leg runs through the spur's junction, and on through a place where it only changes stretch, which isn't one.
			expect(junctionsAlong({ network, leg: layer.legs[0], degrees })).toEqual([layer.legs[0].pieces[0].length]);
			expect(layer.legs[0].pieces).toHaveLength(3);
			layer.legs.forEach((leg, id) => {
				const ids = stops.legs[id].stops;
				const ends = Math.min(tuning.clearance.ends, 0.25 * leg.length);
				const usable = leg.length - 2 * ends;
				const dealt = ids.length;
				expect([Math.floor(leg.length / 45), Math.ceil(leg.length / 45)].map((count) => Math.min(count, Math.floor(usable / tuning.minGap)))).toContain(dealt);
				const slot = usable / dealt;
				const joins = junctionsAlong({ network, leg, degrees });
				const line = legPoints(network, leg);
				let atMiddle = 0;
				ids.forEach((stopId, place) => {
					const stop = stops.stops[stopId];
					if (Math.abs(stop.along - (ends + (place + 0.5) * slot)) < 1e-9) atMiddle += 1;
					for (const join of joins) expect(Math.abs(stop.along - join)).toBeGreaterThanOrEqual(tuning.clearance.junctions - 1e-9);
					if (place > 0) expect(stop.along - stops.stops[ids[place - 1]].along).toBeGreaterThanOrEqual(tuning.minGap - 1e-9);
					expect(stop.along).toBeGreaterThanOrEqual(ends);
					expect(stop.along).toBeLessThanOrEqual(leg.length - ends);
					expect(stop.at).toBeCloseTo(stop.along / leg.length, 12);
					const point = pointAlong(line, stop.along, { x: 0, y: 0 });
					expect(stop.x).toBeCloseTo(point.x, 9);
					expect(stop.y).toBeCloseTo(point.y, 9);
					expect(stop.roadClass).toBe('backRoad');
					expect(stop.biome).toBe('scrub');
				});
				// With no jitter every stop sits at its slot's middle, but the one a junction moves and the few after it that it crowds to minGap.
				expect(atMiddle).toBeGreaterThanOrEqual(ids.length - 4 * joins.length);
				if (joins.length === 0) expect(atMiddle).toBe(ids.length);
			});
		});

		it('take the nearest point in a slot that clears every junction, or none when the slot has none', () => {
			const near = (target: number, joins: number[], from = 0, to = 100) => nearestClear({ target, from, to, joins, clear: 8 });
			expect(near(50, [])).toBe(50);
			expect(near(50, [53])).toBe(45);
			expect(near(55, [53])).toBe(61);
			// Off one junction and onto the next is no good: past both, whichever side is nearer.
			expect(near(50, [53, 44])).toBe(61);
			expect(near(50, [53, 58])).toBe(45);
			// Ties go low.
			expect(near(50, [50])).toBe(42);
			// A target outside the slot comes to its nearest end.
			expect(near(-10, [])).toBe(0);
			expect(near(50, [5, 15, 25], 0, 30)).toBeNull();
			expect(near(4, [4], 0, 30)).toBe(12);
		});

		it('keep clear of junctions on random meshes, added finds too, and in driving order with ids in the map\'s order', () => {
			const sparse = tuned({ spacing: { highway: 300, backRoad: 300, trail: 300 } });
			for (const options of [{}, { stopTuning: sparse, driverFinds: 4 }]) {
				meshes.forEach((network, index) => {
					const { products } = mapOn(index, options);
					const { stops, legs } = products.stops;
					const degrees = nodeDegrees(network);
					stops.forEach((stop, id) => expect(stop.id).toBe(id));
					products.pois.legs.forEach((leg, id) => {
						const joins = junctionsAlong({ network, leg, degrees });
						const ids = legs[id].stops;
						ids.forEach((stopId, place) => {
							if (place > 0) expect(stops[stopId].along).toBeGreaterThan(stops[ids[place - 1]].along);
							for (const join of joins) expect(Math.abs(stops[stopId].along - join)).toBeGreaterThanOrEqual(STOP_TUNING.clearance.junctions - 1e-9);
						});
					});
				});
			}
		});
	});

	it('walk a polyline once for many points', () => {
		const line = [0, 0, 10, 0, 10, 10];
		expect(pointsAlong(line, [0, 5, 10, 15, 20, 25])).toEqual([0, 0, 5, 0, 10, 0, 10, 5, 10, 10, 10, 10]);
	});

	describe('types', () => {
		it('come from the tables by the class and biome where a stop stands', () => {
			const mire = mapOn(1, { ground: fakeGround({ biome: () => 'mire' }) }).products.stops.stops;
			const scrub = mapOn(1).products.stops.stops;
			const share = (stops: StopLayer['stops'], type: StopType) => stops.filter((stop) => stop.type === type).length / stops.length;
			// Mire triples hazards and nearly rules out garages.
			expect(share(mire, 'hazard')).toBeGreaterThan(1.5 * share(scrub, 'hazard'));
			for (const stop of mire) expect(stop.biome).toBe('mire');
			// Only the types the tables weigh.
			const only = mapOn(2, { stopTables: tablesWith(Object.fromEntries(STOP_TYPES.map((type) => [type, type === 'wreck' ? 1 : 0]))) }).products.stops.stops;
			expect(new Set(only.map(({ type }) => type))).toEqual(new Set(['wreck', 'findDriver']));
		});

		it('never put three fights in a row, nor three stops without a non-fight, on any route, however the tables lean', () => {
			const fighty = tablesWith({ ambush: 100, warband: 100, checkpoint: 100, wreck: 0.01, distress: 0, garage: 0, hazard: 0, findDriver: 0, findSettlers: 0, findVehicle: 0, findCards: 0, findSupplies: 0 });
			let pairs = 0;
			meshes.forEach((_, index) => {
				const map = mapOn(index, { stopTables: fighty, dangerCurve: 2 });
				const violations = checkStopLayer({ network: map.network, layer: map.products.pois, stops: map.products.stops, params: map.params });
				expect(violations.filter(({ rule }) => rule === 'fights' || rule === 'calm')).toEqual([]);
				for (const types of routeTypes(map.products)) {
					expect(keepsRules(types)).toBe(true);
					for (let at = 1; at < types.length; at += 1) if (isFight(types[at]) && isFight(types[at - 1])) pairs += 1;
				}
			});
			// The rule bites at three: two fights in a row are allowed, and with these tables common.
			expect(pairs).toBeGreaterThan(10);
		});

		it('are reported by the checks when a route breaks either rule', () => {
			const map = mapOn(3);
			const route = map.products.pois.pois.map((poi) => routesTo(map.products.pois, poi)).flat().find((candidate) => typesAlong(map.products.stops, candidate).length >= 3);
			if (!route) throw new Error('no route with three stops');
			const ids = route.legs.flatMap((leg) => map.products.stops.legs[leg].stops).slice(0, 3);
			const doctor = (types: StopType[]): StopLayer => ({
				...map.products.stops,
				stops: map.products.stops.stops.map((stop) => (ids.includes(stop.id) ? { ...stop, type: types[ids.indexOf(stop.id)], skulls: 1 } : stop)),
			});
			const rules = (types: StopType[]) => new Set(checkStopLayer({ network: map.network, layer: map.products.pois, stops: doctor(types), params: { ...map.params, driverFinds: 0, daylightHours: 100 } }).map(({ rule }) => rule));
			expect(rules(['ambush', 'warband', 'ambush'])).toEqual(new Set(['fights', 'calm']));
			expect(rules(['ambush', 'checkpoint', 'ambush'])).toEqual(new Set(['calm']));
			expect(rules(['ambush', 'wreck', 'ambush'])).toEqual(new Set());
			expect(keepsRules(['ambush', 'checkpoint', 'warband'])).toBe(false);
			expect(keepsRules(['ambush', 'ambush', 'wreck', 'ambush', 'ambush'])).toBe(true);
			expect(isCalm('checkpoint')).toBe(false);
		});

		it('give a fight skulls by its tier and dangerCurve, a warband one more, and every other stop none', () => {
			meshes.slice(0, 4).forEach((_, index) => {
				const { products } = mapOn(index, { dangerCurve: 1 });
				for (const stop of products.stops.stops) {
					const tier = products.stops.legs[stop.leg].tier;
					if (!isFight(stop.type)) {
						expect(stop.skulls).toBe(0);
						continue;
					}
					const level = 1 + (tier - 1) * STOP_TUNING.skulls.step;
					const bonus = stop.type === 'warband' ? STOP_TUNING.skulls.warband : 0;
					expect(stop.skulls).toBeGreaterThanOrEqual(Math.min(3, Math.max(1, Math.floor(level) + bonus)));
					expect(stop.skulls).toBeLessThanOrEqual(Math.min(3, Math.ceil(level) + bonus));
				}
			});
			// Tier 1 fights are 1 skull at dangerCurve 1, unless a warband.
			const { products } = mapOn(4);
			for (const stop of products.stops.stops) if (stop.type === 'ambush' && products.stops.legs[stop.leg].tier === 1) expect(stop.skulls).toBe(1);
		});
	});

	describe('Find: driver', () => {
		const noFinds = tablesWith({ findDriver: 0 });
		const findsIn = ({ products }: ReturnType<typeof mapOn>, tiers: (tier: number) => boolean) => products.stops.stops.filter((stop) => stop.type === 'findDriver' && tiers(products.stops.legs[stop.leg].tier)).length;

		it('meets the driverFinds floor in tiers 1 and 2 even when the tables never draw one', () => {
			for (const driverFinds of [1, 2, 3, 4]) {
				meshes.slice(0, 4).forEach((_, index) => {
					const map = mapOn(index, { stopTables: noFinds, driverFinds });
					expect(findsIn(map, (tier) => tier <= 2)).toBeGreaterThanOrEqual(driverFinds);
					expect(checkStopLayer({ network: map.network, layer: map.products.pois, stops: map.products.stops, params: map.params })).toEqual([]);
				});
			}
		});

		it('adds stops for the floor where the legs in its tiers hold too few to turn', () => {
			const sparse = tuned({ spacing: { highway: 1e6, backRoad: 1e6, trail: 1e6 } });
			const map = mapOn(5, { stopTables: noFinds, stopTuning: sparse, driverFinds: 3 });
			const { stops, legs } = map.products.stops;
			expect(stops.filter((stop) => legs[stop.leg].tier <= 2).map(({ type }) => type)).toEqual(['findDriver', 'findDriver', 'findDriver']);
			expect(map.products.stops.failures.filter((failure) => failure.includes('Find: driver'))).toEqual([]);
		});

		it('keeps a soft rate in the outer tiers, never a failure', () => {
			const rates = tuned({ driverFinds: { floorTiers: 2, rates: [0, 0, 0.2, 0.2, 0.2] } });
			meshes.slice(0, 4).forEach((_, index) => {
				const map = mapOn(index, { stopTables: noFinds, stopTuning: rates });
				for (const tier of [3, 4, 5]) {
					const onTier = map.products.stops.stops.filter((stop) => map.products.stops.legs[stop.leg].tier === tier).length;
					expect(findsIn(map, (legTier) => legTier === tier)).toBeGreaterThanOrEqual(Math.floor(0.2 * onTier));
				}
			});
		});
	});

	describe('the daylight check (guarantee 10)', () => {
		const fits = (map: ReturnType<typeof mapOn>, daylightHours: number) => {
			const { pois, stops } = map.products;
			pois.pois.forEach((poi, index) => {
				if (poi.tier > DAYLIGHT_TIERS) return;
				const routes = routesTo(pois, poi);
				const estimate = (route: (typeof routes)[number]) => 2 * route.hours + STOP_TUNING.objectiveHours.poi + typesAlong(stops, route).reduce((sum, type) => sum + STOP_TUNING.types[type].hours, 0);
				if (routes.some((route) => estimate(route) <= daylightHours)) return;
				// Only a POI no stops could mend is let through, and it's listed.
				expect(2 * routes[0].hours + STOP_TUNING.objectiveHours.poi).toBeGreaterThan(daylightHours);
				expect(stops.failures.some((failure) => failure.startsWith(`poi ${index} `))).toBe(true);
			});
		};

		it('leaves every POI in tiers 1 to 3 a route home by dark, thinning the quickest where none is', () => {
			for (const daylightHours of [10, 14]) {
				meshes.forEach((_, index) => {
					const map = mapOn(index, { daylightHours });
					fits(map, daylightHours);
					expect(checkStopLayer({ network: map.network, layer: map.products.pois, stops: map.products.stops, params: map.params })).toEqual([]);
				});
			}
			const short = mapOn(0, { daylightHours: 10 });
			const long = mapOn(0, { daylightHours: 16 });
			expect(short.products.stops.thinned).toBeGreaterThan(long.products.stops.thinned);
		});

		it('thins only the routes that ran past dark, and only as far as it must', () => {
			const network = meshFrom({ nodes: [[0, 0], [300, 250], [300, -250], [600, 0]], edges: [[0, 1], [0, 2], [1, 3], [2, 3]] });
			const poiTuning: PoiTuning = { ...POI_TUNING, rings: { ...POI_TUNING.rings, targets: [0, 1, 1, 1] }, cover: [] };
			const tree = buildRouteTree({ network, travelPace: 1, routeSplit: 0.5 });
			const layer = placePois({ network, tree, ground: fakeGround(), params: { strongholds: 2, poiDensity: 1 }, rng: new Rng({ seed: 1 }), tuning: poiTuning });
			const [poi] = layer.pois;
			const routes = routesTo(layer, poi);
			const bare = 2 * routes[0].hours + STOP_TUNING.objectiveHours.poi;
			// Every stop a one-hour ambush, dense enough that both routes run past dark.
			const tuning = tuned({ spacing: { highway: 40, backRoad: 40, trail: 40 }, driverFinds: { floorTiers: 2, rates: [0, 0, 0, 0, 0] } });
			const params = { stopDensity: 1, dangerCurve: 1, driverFinds: 0, daylightHours: Math.ceil(bare) + 2, stopTables: tablesWith(Object.fromEntries(STOP_TYPES.map((type) => [type, type === 'ambush' ? 1 : type === 'wreck' ? 1e-9 : 0]))) };
			const loose = placeStops({ network, layer, ground: fakeGround(), params: { ...params, daylightHours: 100 }, rng: new Rng({ seed: 2 }), tuning });
			const thinned = placeStops({ network, layer, ground: fakeGround(), params, rng: new Rng({ seed: 2 }), tuning });
			const hours = (stops: StopLayer, route: number) => 2 * routes[route].hours + STOP_TUNING.objectiveHours.poi + typesAlong(stops, routes[route]).reduce((sum, type) => sum + STOP_TUNING.types[type].hours, 0);
			expect(hours(loose, 0)).toBeGreaterThan(params.daylightHours);
			expect(hours(loose, 1)).toBeGreaterThan(params.daylightHours);
			// The quickest sheds stops until it fits, and not one more; the other route's are untouched.
			expect(hours(thinned, 0)).toBeLessThanOrEqual(params.daylightHours);
			expect(hours(thinned, 0)).toBeGreaterThan(params.daylightHours - 1);
			expect(typesAlong(thinned, routes[1])).toEqual(typesAlong(loose, routes[1]));
			expect(thinned.thinned).toBe(typesAlong(loose, routes[0]).length - typesAlong(thinned, routes[0]).length);
		});

		it('lists a POI whose quickest route runs past dark with no stops at all, and goes on', () => {
			const map = mapOn(1, { daylightHours: 10, travelPace: 2 });
			expect(map.products.stops.failures.length).toBeGreaterThan(0);
			for (const failure of map.products.stops.failures) expect(failure).toMatch(/^poi \d+ \(tier [1-3]\): its quickest route takes [\d.]+ hours with no stops/);
			expect(checkStopLayer({ network: map.network, layer: map.products.pois, stops: map.products.stops, params: map.params })).toEqual([]);
		});
	});

	it('is deterministic from its stream, and a different stream places differently', () => {
		expect(mapOn(6).products.stops).toEqual(mapOn(6).products.stops);
		expect(mapOn(6, { seed: 99 }).products.stops.stops).not.toEqual(mapOn(6).products.stops.stops);
		// Each leg draws on a fork of its own, so a POI layer with the same legs gives the same stops whatever came before.
		const { network, products } = mapOn(7);
		const again = placeStops({ network, layer: products.pois, ground: fakeGround(), params: { stopDensity: 1, dangerCurve: 1, driverFinds: 2, daylightHours: 14 }, rng: new Rng({ seed: 7 }).fork('stops') });
		expect(again).toEqual(products.stops);
	});
});

describe('rollStop', () => {
	const map = mapOn(0);
	const { stops } = map.products.stops;
	const byType = (type: StopType) => stops.filter((stop) => stop.type === type).map(({ id }) => id);

	it('gives the same contents for the same stop and roll, and new ones for the next roll', () => {
		for (const { id } of stops.slice(0, 20)) {
			expect(rollStop(map, id, 0)).toEqual(rollStop(map, id, 0));
			expect(rollStop(map, id, 3)).toEqual(rollStop(meshMap(meshes[0], { seed: 0 }), id, 3));
			expect(rollStop(map, id, 1).seed).not.toBe(rollStop(map, id, 0).seed);
			expect(rollStop(map, id, 0)).toMatchObject({ stop: id, roll: 0, type: stops[id].type });
		}
		expect(new Set(stops.map(({ id }) => rollStop(map, id, 0).seed)).size).toBe(stops.length);
		// Plain JSON, so the save can keep a revealed stop's contents.
		const contents = rollStop(map, stops[0].id, 0);
		expect(JSON.parse(JSON.stringify(contents))).toEqual(contents);
	});

	it('rolls a hazard\'s kind and hours, and a supplies find\'s haul, inside the tuning\'s ranges', () => {
		const { hazards, hazardHours, supplies } = STOP_TUNING.contents;
		for (const id of byType('hazard')) {
			for (let roll = 0; roll < 4; roll += 1) {
				const { hours, hazard } = rollStop(map, id, roll);
				expect(hazards).toContain(hazard);
				expect(hours).toBeGreaterThanOrEqual(hazardHours.min);
				expect(hours).toBeLessThanOrEqual(hazardHours.max);
				expect(((hours - hazardHours.min) / hazardHours.step) % 1).toBeCloseTo(0, 9);
			}
		}
		for (const id of byType('findSupplies')) {
			const { supplies: haul, hours } = rollStop(map, id, 0);
			if (!haul) throw new Error('a supplies find without a haul');
			expect(haul.amount).toBeGreaterThanOrEqual(supplies[haul.resource].min);
			expect(haul.amount).toBeLessThanOrEqual(supplies[haul.resource].max);
			expect(hours).toBe(STOP_TUNING.types.findSupplies.hours);
		}
		for (const id of byType('ambush')) expect(rollStop(map, id, 0)).toEqual({ stop: id, roll: 0, type: 'ambush', hours: 1, seed: expect.any(Number) });
	});

	it('refuses a stop the map doesn\'t have, or a roll that isn\'t a count', () => {
		expect(() => rollStop(map, stops.length, 0)).toThrow(/no stop/);
		expect(() => rollStop(map, -1, 0)).toThrow(/no stop/);
		expect(() => rollStop(map, 0, -1)).toThrow(/roll/);
		expect(() => rollStop(map, 0, 0.5)).toThrow(/roll/);
	});
});

describe('the stops stage in the pipeline', () => {
	const params: MapParams = paramsFor({ seed: 21, strongholds: 4 });
	const looped = randomMesh({ seed: 31 });

	const pipeline = (network: RoadNetwork) => new MapPipeline<MapParams>()
		.stage({ name: 'water', run: () => ({ terrain: fakeGround() }) })
		.stage({ name: 'growth', run: () => ({ network }) })
		.stage(ROUTE_TREE_STAGE)
		.stage(poisStage({ strict: true }))
		.stage(STOPS_STAGE);

	it('places stops on the POIs\' legs and passes its checks', () => {
		const result = pipeline(looped).run({ seed: params.seed, input: params, debug: true });
		expect(result.attempts).toEqual({ water: 0, growth: 0, routeTree: 0, pois: 0, stops: 0 });
		const { pois, stops } = result.products;
		expect(stops.stops.length).toBeGreaterThan(0);
		expect(checkStopLayer({ network: looped, layer: pois, stops, params })).toEqual([]);
		// Its contents hang from its own winning stream.
		expect(stops.contentSeed).toBe(new Rng({ seed: result.streams.stops }).fork('contents').seed);
	});

	it('retries only itself when rejected, never the POIs or the map', () => {
		let rejections = 0;
		const result = pipeline(looped).run({
			seed: params.seed,
			input: params,
			debug: true,
			accept: (_map, { stage }) => (stage === 'stops' && rejections++ < 2 ? ['force a stops rerun'] : []),
		});
		expect(result.attempts).toEqual({ water: 0, growth: 0, routeTree: 0, pois: 0, stops: 2 });
		expect(result.mapAttempt).toBe(0);
		expect(result.timings.pois.runs).toBe(1);
	});

	it('past its cap, keeps its best attempt in a release build and throws in a debug one', () => {
		const accept = (_map: unknown, { stage }: { stage: string }) => (stage === 'stops' ? ['always'] : []);
		const warnings: string[] = [];
		const kept = pipeline(looped).run({ seed: params.seed, input: params, debug: false, accept, warn: (message) => warnings.push(message) });
		expect(kept.keptFailing).toEqual(['stops']);
		expect(kept.mapAttempt).toBe(0);
		expect(warnings).toHaveLength(1);
		expect(() => pipeline(looped).run({ seed: params.seed, input: params, debug: true, accept })).toThrow(MapPipelineError);
	});

	it('places nothing, and passes, on roads with no meeting points', () => {
		const treeOnly = randomMesh({ seed: 31, loops: 0, diagonals: 0 });
		const lenient = new MapPipeline<MapParams>()
			.stage({ name: 'water', run: () => ({ terrain: fakeGround() }) })
			.stage({ name: 'growth', run: () => ({ network: treeOnly }) })
			.stage(ROUTE_TREE_STAGE)
			.stage(poisStage())
			.stage(STOPS_STAGE);
		const result = lenient.run({ seed: params.seed, input: params, debug: true });
		expect(result.products.stops).toMatchObject({ stops: [], legs: [], failures: [] });
		expect(result.attempts.stops).toBe(0);
	});
});
