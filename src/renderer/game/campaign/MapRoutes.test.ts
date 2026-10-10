import { meshMap, randomMesh } from '../map/meshTesting';
import { POI_TUNING, STRONGHOLD_TYPE } from '../map/PoiData';
import { ROAD_CLASSES } from '../map/RoadNetwork';
import { describeMap } from '../map/RouteDescriptors';
import { isFight } from '../map/StopData';
import { RunRoute, offersForDay, routeOffers } from './MapRoutes';

const maps = Array.from({ length: 3 }, (_, index) => meshMap(randomMesh({ seed: 900 + index, spacing: 85 + index }), { seed: index }));

/** The run loop's route model, field for field, as its save reader holds it: exact fields, and every value in range. */
function expectRunRoute(route: RunRoute): void {
	expect(Object.keys(route).sort()).toEqual(['destination', 'fuel', 'hours', 'id', 'legs', 'name', 'risk']);
	expect(Object.keys(route.destination).sort()).toEqual(['id', 'name', 'tier', 'yield']);
	expect(Object.keys(route.destination.yield).sort()).toEqual(['food', 'fuel', 'scrap', 'water']);
	for (const amount of Object.values(route.destination.yield)) expect(Number.isInteger(amount) && amount >= 0).toBe(true);
	expect(Object.keys(route.hours).sort()).toEqual(['home', 'objective', 'out']);
	expect(route.name.trim()).not.toBe('');
	expect(route.destination.name.trim()).not.toBe('');
	expect(Number.isInteger(route.destination.tier) && route.destination.tier >= 1 && route.destination.tier <= 5).toBe(true);
	expect(Number.isInteger(route.fuel) && route.fuel >= 1).toBe(true);
	expect([1, 2, 3]).toContain(route.risk);
	for (const hours of Object.values(route.hours)) expect(hours).toBeGreaterThanOrEqual(0);
	expect(route.legs.length).toBeGreaterThan(0);
	for (const leg of route.legs) {
		expect(Object.keys(leg).sort()).toEqual(['hours', 'id', 'length', 'roadClass', 'stops']);
		expect(ROAD_CLASSES).toContain(leg.roadClass);
		expect(leg.length).toBeGreaterThanOrEqual(0);
		expect(leg.hours).toBeGreaterThanOrEqual(0);
		leg.stops.forEach((stop, index) => {
			expect(Object.keys(stop).sort()).toEqual(stop.kind === 'fight' ? ['at', 'id', 'kind', 'skulls'] : ['at', 'id', 'kind']);
			if (stop.kind === 'fight') expect([1, 2, 3]).toContain(stop.skulls);
			expect(stop.at).toBeGreaterThanOrEqual(0);
			expect(stop.at).toBeLessThanOrEqual(1);
			// A leg's stops are in driving order.
			if (index > 0) expect(stop.at).toBeGreaterThanOrEqual(leg.stops[index - 1].at);
		});
	}
}

describe('routeOffers', () => {
	it('gives every route on the map in the run loop\'s route model', () => {
		for (const map of maps) {
			const routes = routeOffers(map);
			const described = describeMap(map).flat();
			expect(routes).toHaveLength(described.length);
			routes.forEach(expectRunRoute);
			expect(new Set(routes.map(({ id }) => id)).size).toBe(routes.length);
			const stopIds = routes.flatMap(({ legs }) => legs.flatMap(({ stops }) => stops.map(({ id }) => id)));
			// A stop on a shared leg is the same stop on every route over it.
			expect(new Set(stopIds).size).toBe(map.products.stops.stops.length);
			// Plain JSON, so the run's save keeps a route as it was rolled.
			expect(JSON.parse(JSON.stringify(routes))).toEqual(routes);
			expect(Object.isFrozen(routes[0].legs[0])).toBe(true);
		}
	});

	it('carries each route\'s descriptor and every stop it will meet, fights as fights and the rest as quiet stretches', () => {
		const map = maps[0];
		const { stops, pois } = map.products;
		const described = describeMap(map).flat();
		routeOffers(map).forEach((route, index) => {
			const descriptor = described[index];
			expect(route.id).toBe(`route-${descriptor.poi}-${descriptor.route}`);
			expect(route.destination).toMatchObject({ id: `poi-${descriptor.poi}`, tier: pois.pois[descriptor.poi].tier });
			const { type } = pois.pois[descriptor.poi];
			const yields: Partial<Record<string, number>> = POI_TUNING.types[type]?.yields ?? {};
			expect(route.destination.yield).toEqual({ food: yields.food ?? 0, water: yields.water ?? 0, fuel: yields.fuel ?? 0, scrap: yields.scrap ?? 0 });
			expect(route).toMatchObject({ name: descriptor.name, fuel: descriptor.fuel, risk: Math.max(1, descriptor.risk) });
			expect(route.hours.out).toBeCloseTo(descriptor.hours.out, 1);
			expect(route.hours.home).toBeCloseTo(descriptor.hours.home, 1);
			expect(route.legs.map(({ id }) => id)).toEqual(descriptor.legs.map((leg) => `leg-${leg}`));
			const along = route.legs.flatMap((leg) => leg.stops);
			expect(along.map(({ id }) => id)).toEqual(descriptor.stops.map(({ id }) => `stop-${id}`));
			along.forEach((stop) => {
				const real = stops.stops[Number(stop.id.slice('stop-'.length))];
				expect(stop.kind).toBe(isFight(real.type) ? 'fight' : 'quiet');
				if (stop.kind === 'fight') expect(stop.skulls).toBe(real.skulls);
			});
		});
		// Both kinds turn up.
		const kinds = new Set(routeOffers(map).flatMap(({ legs }) => legs.flatMap(({ stops: on }) => on.map(({ kind }) => kind))));
		expect(kinds).toEqual(new Set(['fight', 'quiet']));
	});

	it('gives the same routes however often it\'s asked', () => {
		expect(routeOffers(maps[1])).toEqual(routeOffers(maps[1]));
		expect(routeOffers(meshMap(randomMesh({ seed: 901, spacing: 86 }), { seed: 1 }))).toEqual(routeOffers(maps[1]));
	});

	it('gives nothing on a map with no POIs', () => {
		const empty = { ...maps[0], products: { pois: { ...maps[0].products.pois, pois: [], legs: [], strongholds: [] }, stops: { ...maps[0].products.stops, stops: [], legs: [] } } };
		expect(routeOffers(empty)).toEqual([]);
	});
});

describe('offersForDay', () => {
	const map = maps[2];
	const routes = routeOffers(map);
	const destinations = (offered: readonly RunRoute[]) => [...new Set(offered.map(({ destination }) => destination.id))];

	it('offers a tier 1 destination and up to two from tiers 2 and 3, each with every route it has', () => {
		for (let day = 1; day <= 10; day += 1) {
			const offered = offersForDay({ map, seed: 42, day });
			const ids = destinations(offered);
			expect(ids.length).toBeGreaterThanOrEqual(1);
			expect(ids.length).toBeLessThanOrEqual(3);
			expect(offered[0].destination.tier).toBe(1);
			for (const id of ids) {
				expect(offered.filter((route) => route.destination.id === id)).toEqual(routes.filter((route) => route.destination.id === id));
				const tier = offered.find((route) => route.destination.id === id)?.destination.tier ?? 0;
				expect(tier).toBeLessThanOrEqual(3);
			}
		}
	});

	it('offers only destinations a run can reach and leave by dark, by the unrounded hours, and never a stronghold', () => {
		const strongholds = new Set(map.products.pois.strongholds.map(({ poi }) => `poi-${poi}`));
		const short = { ...map, params: { ...map.params, daylightHours: 9 } };
		const described = describeMap(short);
		const seen = new Set<string>();
		for (let day = 1; day <= 20; day += 1) {
			for (const id of destinations(offersForDay({ map: short, seed: 7, day }))) {
				seen.add(id);
				expect(strongholds.has(id)).toBe(false);
				expect(described[Number(id.slice('poi-'.length))].some(({ spare }) => spare >= 0)).toBe(true);
			}
		}
		// Some destinations the full day would offer are past dark in a short one.
		const fullDay = new Set(Array.from({ length: 20 }, (_, day) => destinations(offersForDay({ map, seed: 7, day: day + 1 }))).flat());
		expect([...fullDay].some((id) => !seen.has(id))).toBe(true);
		expect(map.products.pois.pois.some(({ type }) => type === STRONGHOLD_TYPE)).toBe(true);
	});

	it('offers the same for a day however often it\'s asked, and other days differ', () => {
		expect(offersForDay({ map, seed: 42, day: 3 })).toEqual(offersForDay({ map, seed: 42, day: 3 }));
		const days = new Set(Array.from({ length: 10 }, (_, day) => destinations(offersForDay({ map, seed: 42, day: day + 1 })).join()));
		expect(days.size).toBeGreaterThan(1);
	});
});
