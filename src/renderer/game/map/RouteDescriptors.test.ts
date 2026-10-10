import { Rng } from '../core/Rng';
import { fakeGround, meshFrom, meshMap, randomMesh } from './meshTesting';
import { POI_TUNING, PoiTuning, STRONGHOLD_TYPE } from './PoiData';
import { placePois } from './Pois';
import { LegKnowledge, RouteMap, compass, describeMap, describeRoutes, fuelFor, poiNames } from './RouteDescriptors';
import { buildRouteTree, routesTo } from './RouteTree';
import { ROUTE_TUNING, STOP_TUNING, isFight } from './StopData';
import { placeStops } from './Stops';

const meshes = Array.from({ length: 4 }, (_, index) => randomMesh({ seed: 700 + index, spacing: 85 + index }));
const mapOn = (index: number, options: Parameters<typeof meshMap>[1] = {}) => meshMap(meshes[index], { seed: index, ...options });

describe('route descriptors', () => {
	it('give each route its hours out, at the objective, and home, and when it\'s back against dark', () => {
		const map = mapOn(0);
		const { pois, stops } = map.products;
		describeMap(map).forEach((routes, poi) => {
			const tree = routesTo(pois, pois.pois[poi]);
			expect(routes.map(({ route }) => route)).toEqual(tree.map((_, place) => place));
			routes.forEach((descriptor, place) => {
				const route = tree[place];
				const stopHours = route.legs.flatMap((leg) => stops.legs[leg].stops).reduce((sum, id) => sum + STOP_TUNING.types[stops.stops[id].type].hours, 0);
				const objective = pois.pois[poi].type === STRONGHOLD_TYPE ? STOP_TUNING.objectiveHours.stronghold : STOP_TUNING.objectiveHours.poi;
				expect(descriptor.legs).toEqual(route.legs);
				expect(descriptor.hours.out).toBeCloseTo(route.hours + stopHours, 9);
				expect(descriptor.hours.objective).toBe(objective);
				// Home down the cleared road: the drive alone.
				expect(descriptor.hours.home).toBeCloseTo(route.hours, 9);
				expect(descriptor.back).toBeCloseTo(ROUTE_TUNING.dawn + descriptor.hours.out + objective + descriptor.hours.home, 9);
				expect(descriptor.dark).toBe(ROUTE_TUNING.dawn + map.params.daylightHours);
				expect(descriptor.spare).toBeCloseTo(descriptor.dark - descriptor.back, 9);
				expect(descriptor.length).toBeCloseTo(route.length, 9);
			});
		});
	});

	it('cost a unit of fuel per unitsPerFuel of road, at least one', () => {
		const map = mapOn(1);
		for (const routes of describeMap(map)) for (const { length, fuel } of routes) expect(fuel).toBe(Math.max(1, Math.ceil(length / ROUTE_TUNING.unitsPerFuel)));
		expect(fuelFor(0)).toBe(1);
		expect(fuelFor(150)).toBe(1);
		expect(fuelFor(151)).toBe(2);
	});

	it('list every stop on a charted route in driving order, and its risk is its worst fight', () => {
		const map = mapOn(2);
		const { stops } = map.products;
		for (const routes of describeMap(map)) {
			for (const descriptor of routes) {
				const ids = descriptor.legs.flatMap((leg) => stops.legs[leg].stops);
				expect(descriptor.stops.map(({ id }) => id)).toEqual(ids);
				descriptor.stops.forEach(({ id, leg, type, skulls, at }) => expect({ leg, type, skulls, at }).toEqual({ leg: stops.stops[id].leg, type: stops.stops[id].type, skulls: stops.stops[id].skulls, at: stops.stops[id].at }));
				const worst = Math.max(0, ...ids.map((id) => stops.stops[id]).filter(({ type }) => isFight(type)).map(({ skulls }) => skulls));
				expect(descriptor.risk).toBe(worst);
				expect(descriptor).toMatchObject({ knowledge: 'charted', estimated: false });
			}
		}
	});

	it('show what\'s known of a rumored or uncharted leg, and take the least known leg as the route\'s', () => {
		// A route whose second leg has a stop and whose third has two, on the first map that has one.
		const fits = (stops: (typeof maps)[number]['products']['stops'], legs: readonly number[]) => legs.length >= 3 && stops.legs[legs[1]].stops.length >= 1 && stops.legs[legs[2]].stops.length >= 2;
		const maps = [0, 1, 2, 3].map((index) => mapOn(index));
		const map = maps.find(({ products }) => products.pois.pois.some((candidate) => routesTo(products.pois, candidate).some(({ legs }) => fits(products.stops, legs))));
		if (!map) throw new Error('no route with stops on its second and third legs');
		const { pois, stops } = map.products;
		const poi = pois.pois.findIndex((candidate) => routesTo(pois, candidate).some(({ legs }) => fits(stops, legs)));
		const charted = describeRoutes(map, poi);
		const route = charted.findIndex(({ legs }) => fits(stops, legs));
		const [first, second, third, ...beyond] = charted[route].legs;
		// Everything past the uncharted leg is charted, which a run can't see past it anyway.
		const knowledge = (leg: number): LegKnowledge => (leg === second ? 'rumored' : leg === third ? 'uncharted' : 'charted');
		const known = describeRoutes(map, poi, { knowledge })[route];
		expect(known.knowledge).toBe('uncharted');
		expect(known.estimated).toBe(true);
		const on = (leg: number) => known.stops.filter((stop) => stop.leg === leg);
		expect(on(first).every(({ type }) => type !== null)).toBe(true);
		// Rumored: how many stops, not what they are.
		expect(on(second).map(({ id, type, skulls }) => ({ id, type, skulls }))).toEqual(stops.legs[second].stops.map((id) => ({ id, type: null, skulls: 0 })));
		// Uncharted: a direction and the next stop, and nothing past it, on this leg or any after.
		expect(on(third).map(({ id, type }) => ({ id, type }))).toEqual([{ id: stops.legs[third].stops[0], type: null }]);
		for (const leg of beyond) expect(on(leg)).toEqual([]);
		expect(known.stops).toHaveLength(on(first).length + on(second).length + 1);
		// Hours estimate what isn't known: the rumored leg's stops at the unknown rate, and every leg from the uncharted one on at what its road would earn.
		const hoursOf = (legs: number[]) => legs.flatMap((leg) => stops.legs[leg].stops).reduce((sum, id) => sum + STOP_TUNING.types[stops.stops[id].type].hours, 0);
		const earns = (leg: number) => (['highway', 'backRoad', 'trail'] as const).reduce((sum, roadClass) => sum + stops.legs[leg].classLengths[roadClass] / STOP_TUNING.spacing[roadClass], 0) * map.params.stopDensity;
		const rumoredHours = stops.legs[second].stops.length * ROUTE_TUNING.unknownStopHours;
		const fogged = [third, ...beyond];
		const foggedHours = fogged.reduce((sum, leg) => sum + earns(leg), 0) * ROUTE_TUNING.unknownStopHours;
		expect(known.hours.home).toBeCloseTo(charted[route].hours.home, 9);
		expect(known.hours.out).toBeCloseTo(charted[route].hours.out - hoursOf([second, ...fogged]) + rumoredHours + foggedHours, 9);
		// Risk counts only fights it knows of.
		const knownFights = on(first).filter(({ type }) => type !== null && isFight(type)).map(({ skulls }) => skulls);
		expect(known.risk).toBe(Math.max(0, ...knownFights));
	});

	it('keep guarantee 5: two routes to a POI share nothing past routeSplit of the shorter one\'s hours', () => {
		for (const index of [0, 1, 2, 3]) {
			const map = mapOn(index);
			for (const routes of describeMap(map)) {
				for (let a = 0; a < routes.length; a += 1) {
					for (let b = a + 1; b < routes.length; b += 1) {
						let shared = 0;
						for (let leg = 0; leg < routes[a].legs.length && routes[a].legs[leg] === routes[b].legs[leg]; leg += 1) shared += map.products.pois.legs[routes[a].legs[leg]].hours;
						expect(shared).toBeLessThanOrEqual(0.5 * Math.min(routes[a].hours.home, routes[b].hours.home) + 1e-9);
						// Past the split they share no leg at all.
						const rest = new Set(routes[a].legs);
						expect(routes[b].legs.filter((leg) => rest.has(leg)).every((leg, place) => routes[b].legs[place] === leg)).toBe(true);
					}
				}
			}
		}
	});

	describe('names', () => {
		// A loop out from the compound, its north side highway: the POI's quickest route takes the highway round, the other the back road.
		const network = meshFrom({ nodes: [[0, 0], [300, 250], [300, -250], [600, 0]], edges: [[0, 1, 'highway'], [0, 2], [1, 3, 'highway'], [2, 3]] });
		const poiTuning: PoiTuning = { ...POI_TUNING, rings: { ...POI_TUNING.rings, targets: [0, 1, 1, 1] }, cover: [] };
		const tree = buildRouteTree({ network, travelPace: 1, routeSplit: 0.5 });
		const layer = placePois({ network, tree, ground: fakeGround(), params: { strongholds: 2, poiDensity: 1 }, rng: new Rng({ seed: 1 }), tuning: poiTuning });
		const params = { stopDensity: 1, dangerCurve: 1, driverFinds: 2, daylightHours: 14 };
		const map: RouteMap = { params, products: { pois: layer, stops: placeStops({ network, layer, ground: fakeGround(), params, rng: new Rng({ seed: 1 }) }) } };

		it('come from the dominant class of a route\'s own road, a highway\'s numbered by its road', () => {
			const [highway, backRoads] = describeRoutes(map, 0);
			expect(highway).toMatchObject({ name: 'Route 1 highway', roadClass: 'highway', biome: 'scrub' });
			expect(backRoads).toMatchObject({ name: 'Back roads', roadClass: 'backRoad' });
		});

		it('come from a biome that covers enough of a route\'s own road', () => {
			const mire = mapOn(0, { ground: fakeGround({ biome: (x) => (x > 0 ? 'mire' : 'scrub') }) });
			const named = describeMap(mire).flat();
			expect(named.some(({ name }) => name.startsWith('Through the mire'))).toBe(true);
			for (const { name, biome } of named) if (name.startsWith('Through the mire')) expect(biome).toBe('mire');
		});

		it('tell a POI\'s routes apart by the side they come in from, then by letter', () => {
			for (const index of [0, 1, 2, 3]) {
				for (const routes of describeMap(mapOn(index))) {
					expect(new Set(routes.map(({ name }) => name)).size).toBe(routes.length);
					for (const { name } of routes) expect(name).toMatch(/^(Route \d+ highway|Back roads|Trails|Through the \w+|Across the desert|Down the canyons|Over the mountains)( from the (north|south|east|west|north-east|north-west|south-east|south-west))?( [A-C])?$/);
				}
			}
		});
	});

	it('point the compass by plain arithmetic, x east and y north', () => {
		expect(compass(1, 0)).toBe('east');
		expect(compass(-1, 0.4)).toBe('west');
		expect(compass(0, 1)).toBe('north');
		expect(compass(0.4, -1)).toBe('south');
		expect(compass(1, 1)).toBe('north-east');
		expect(compass(-1, -1)).toBe('south-west');
		expect(compass(-1, 0.5)).toBe('north-west');
	});

	it('name POIs by type and bearing until places have names, strongholds by faction, and never twice', () => {
		const { pois } = mapOn(1).products;
		const names = poiNames(pois);
		expect(new Set(names).size).toBe(names.length);
		pois.pois.forEach(({ type }, index) => {
			if (type === STRONGHOLD_TYPE) expect(names[index]).toMatch(/ stronghold$/);
			else expect(names[index].startsWith(POI_TUNING.types[type].label)).toBe(true);
		});
	});
});
