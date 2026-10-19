import { meshMap, randomMesh } from '../map/meshTesting';
import { POI_TUNING } from '../map/PoiData';
import { ROAD_CLASSES } from '../map/RoadNetwork';
import { describeMap } from '../map/RouteDescriptors';
import { isFight } from '../map/StopData';
import { rollStop } from '../map/Stops';
import { eventsFor } from './Events';
import { RESOLVED_STOP_TYPES, destinationId, routeId, routeOffers } from './MapRoutes';
import { RUN_EVENT_TYPES, RunRoute, readRunRoute } from './SupplyRoutes';

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
			const fields = { fight: ['at', 'id', 'kind', 'skulls'], quiet: ['at', 'id', 'kind'], find: ['at', 'find', 'id', 'kind'], event: ['at', 'id', 'kind', 'stopType'] }[stop.kind];
			expect(Object.keys(stop).sort()).toEqual(stop.kind === 'find' && stop.find === 'supplies' ? [...fields, 'supplies'] : fields);
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
			// The run's own save reader takes every one, unchanged.
			routes.forEach((route, index) => expect(readRunRoute(JSON.parse(JSON.stringify(route)), `routes[${index}]`)).toEqual(route));
			expect(new Set(routes.map(({ id }) => id)).size).toBe(routes.length);
			const stopIds = routes.flatMap(({ legs }) => legs.flatMap(({ stops }) => stops.map(({ id }) => id)));
			// A stop on a shared leg is the same stop on every route over it.
			expect(new Set(stopIds).size).toBe(map.products.stops.stops.length);
			// Plain JSON, so the run's save keeps a route as it was rolled.
			expect(JSON.parse(JSON.stringify(routes))).toEqual(routes);
			expect(Object.isFrozen(routes[0].legs[0])).toBe(true);
		}
	});

	it('carries each route\'s descriptor and every stop it will meet, fights as fights, finds as finds, wrecks and distress signals as events, and the rest as quiet stretches', () => {
		const map = maps[0];
		const { stops, pois } = map.products;
		const described = describeMap(map).flat();
		routeOffers(map).forEach((route, index) => {
			const descriptor = described[index];
			expect(route.id).toBe(`route-${descriptor.poi}-${descriptor.route}`);
			expect(route.id).toBe(routeId(descriptor.poi, descriptor.route));
			expect(route.destination).toMatchObject({ id: `poi-${descriptor.poi}`, tier: pois.pois[descriptor.poi].tier });
			expect(route.destination.id).toBe(destinationId(descriptor.poi));
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
				const find = ({ findCards: 'cards', findSupplies: 'supplies', findDriver: 'driver' } as Partial<Record<string, string>>)[real.type];
				const event = real.type === 'wreck' || real.type === 'distress';
				expect(stop.kind).toBe(isFight(real.type) ? 'fight' : find ? 'find' : event ? 'event' : 'quiet');
				if (stop.kind === 'fight') expect(stop.skulls).toBe(real.skulls);
				if (stop.kind === 'event') expect(stop.stopType).toBe(real.type);
				if (stop.kind === 'find') expect(stop.find).toBe(find);
				// A haul is the stop's contents at its first roll.
				if (stop.kind === 'find' && stop.find === 'supplies') expect(stop.supplies).toEqual(rollStop(map, Number(stop.id.slice('stop-'.length)), 0).supplies);
			});
		});
		// Every kind turns up, and every find.
		const along = routeOffers(map).flatMap(({ legs }) => legs.flatMap(({ stops: on }) => on));
		expect(new Set(along.map(({ kind }) => kind))).toEqual(new Set(['fight', 'quiet', 'find', 'event']));
		expect(new Set(along.flatMap(stop => (stop.kind === 'find' ? [stop.find] : [])))).toEqual(new Set(['cards', 'supplies', 'driver']));
		expect(new Set(along.flatMap(stop => (stop.kind === 'event' ? [stop.stopType] : [])))).toEqual(new Set(['wreck', 'distress']));
	});

	it('names every stop type a run resolves, each event type with events to open', () => {
		expect(RESOLVED_STOP_TYPES).toEqual(['ambush', 'warband', 'wreck', 'distress', 'findDriver', 'findCards', 'findSupplies']);
		for (const type of RUN_EVENT_TYPES) expect(eventsFor(type).length).toBeGreaterThan(0);
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
