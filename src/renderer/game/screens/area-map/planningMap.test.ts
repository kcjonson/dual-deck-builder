import { routeOffers } from '../../campaign/MapRoutes';
import { foundTestCampaign } from '../../campaign/__fixtures__/mapFixtures';
import { STRONGHOLD_TYPE } from '../../map/PoiData';
import { describeRoutes } from '../../map/RouteDescriptors';
import { clockText, darkText, homeByText, poiKindText, poiYieldText, routeDetail, routesText, stopTag, stopText } from './areaMapText';
import { PlanningMaps, byDistance, mapRoutes, plannedPois, poiMarkers, routePoints, routesBounds, viewData } from './planningMap';
import { meshPlanningMap } from './testing';

/** The planning screens' reading of a campaign's map, and what they say about it (DDB-43, DDB-319). */

const MAP = meshPlanningMap({ daylightHours: 9 });
const POIS = plannedPois(MAP);

describe('the planned POIs', () => {
	it('are the map\'s POIs in its order, each with its routes described, worked out once a map', () => {
		const { pois, strongholds } = MAP.products.pois;
		expect(POIS.map(({ poi }) => poi)).toEqual(pois.map((_poi, index) => index));
		POIS.forEach((planned) => {
			const poi = pois[planned.poi];
			expect(planned).toMatchObject({ id: `poi-${planned.poi}`, type: poi.type, tier: poi.tier, x: poi.site.x, y: poi.site.y, stronghold: poi.type === STRONGHOLD_TYPE });
			expect(planned.routes).toEqual(describeRoutes(MAP, planned.poi));
			expect(planned.pastDark).toBe(planned.routes.every(({ spare }) => spare < 0));
		});
		expect(POIS.filter(({ stronghold }) => stronghold)).toHaveLength(strongholds.length);
		expect(POIS.some(({ pastDark, stronghold }) => pastDark && !stronghold)).toBe(true);
		expect(plannedPois(MAP)).toBe(POIS);
		// The names are the route loop's destinations'
		const names = new Map(routeOffers(MAP).map(({ destination }) => [destination.id, destination.name]));
		POIS.forEach(({ id, name }) => expect(name).toBe(names.get(id)));
	});

	it('go nearest first: by tier, then the quickest route\'s hours out, the strongholds last', () => {
		const ordered = byDistance(POIS);
		const key = (poi: (typeof POIS)[number]) => [poi.stronghold ? 9 : poi.tier, poi.routes[0]?.hours.out ?? Infinity];
		for (let index = 1; index < ordered.length; index += 1) {
			const [tier, hours] = key(ordered[index]);
			const [before, beforeHours] = key(ordered[index - 1]);
			expect(tier > before || (tier === before && hours >= beforeHours)).toBe(true);
		}
		expect(ordered[ordered.length - 1].stronghold).toBe(true);
	});

	it('mark the map: a badge of the tier, the night ring past dark, and labels placed nearest first', () => {
		const markers = poiMarkers(POIS);
		const order = byDistance(POIS);
		POIS.forEach((poi, index) => {
			const marker = markers[index];
			expect(marker.priority).toBe(order.indexOf(poi));
			expect(marker.badge).toBe(poi.stronghold ? undefined : String(poi.tier));
			expect(marker.pastDark).toBe(!poi.stronghold && poi.pastDark);
		});
	});
});

describe('a POI\'s routes on the map', () => {
	const poi = byDistance(POIS).find(({ stronghold, routes }) => !stronghold && routes.length > 1) as (typeof POIS)[number];

	it('run from the compound out to the POI along their legs, one line each', () => {
		for (const route of poi.routes) {
			const points = routePoints(MAP, route);
			expect(points.slice(0, 2)).toEqual([0, 0]);
			const end = points.slice(-2);
			expect(Math.hypot(end[0] - poi.x, end[1] - poi.y)).toBeLessThan(1e-6);
			for (let index = 2; index + 1 < points.length; index += 2) {
				// No point twice where two legs join
				expect(points[index] === points[index - 2] && points[index + 1] === points[index - 1]).toBe(false);
			}
		}
	});

	it('draw the picked one with its stops, and frame the compound, the POI, and every route', () => {
		const routes = mapRoutes(MAP, poi.routes, 1);
		expect(routes.map(({ picked }) => picked)).toEqual(poi.routes.map((_route, index) => index === 1));
		const { stops } = MAP.products.stops;
		expect(routes[1].stops).toEqual(poi.routes[1].stops.map(({ id, type }) => ({ x: stops[id].x, y: stops[id].y, fight: type === 'ambush' || type === 'warband' })));
		const bounds = routesBounds(MAP, poi);
		for (const route of routes) {
			for (let index = 0; index + 1 < route.points.length; index += 2) {
				expect(route.points[index]).toBeGreaterThanOrEqual(bounds.x);
				expect(route.points[index]).toBeLessThanOrEqual(bounds.x + bounds.width);
				expect(route.points[index + 1]).toBeGreaterThanOrEqual(bounds.y);
				expect(route.points[index + 1]).toBeLessThanOrEqual(bounds.y + bounds.height);
			}
		}
	});

	it('are drawn over the map\'s own land and roads', () => {
		expect(viewData(MAP)).toEqual({ terrain: MAP.products.water.terrain, network: MAP.products.roads.network, rivers: MAP.products.water.lines, places: null });
		const hazards = { terrain: MAP.products.water.terrain };
		expect(viewData({ ...MAP, products: { ...MAP.products, hazards } }).terrain).toBe(hazards.terrain);
	});
});

describe('PlanningMaps', () => {
	it('keeps a campaign\'s map once it has arrived, so a screen has it at mount, and asks again for another campaign', async () => {
		let asked = 0;
		const maps = new PlanningMaps({ source: { mapOf: async () => { asked += 1; return MAP; } } });
		const campaign = foundTestCampaign({ seed: 5, unlockedArchetypes: ['road_warrior', 'interceptor'] });
		expect(maps.known(campaign)).toBeNull();
		expect(await maps.load(campaign)).toBe(MAP);
		expect(maps.known(campaign)).toBe(MAP);
		expect(await maps.load(campaign)).toBe(MAP);
		expect(asked).toBe(1);
		const another = foundTestCampaign({ seed: 5, unlockedArchetypes: ['road_warrior', 'interceptor'] });
		expect(maps.known(another)).toBeNull();
	});

	it('remembers nothing when the source fails', async () => {
		const maps = new PlanningMaps({ source: { mapOf: async () => { throw new Error('no attempts'); } } });
		const campaign = foundTestCampaign({ seed: 5, unlockedArchetypes: ['road_warrior', 'interceptor'] });
		await expect(maps.load(campaign)).rejects.toThrow('no attempts');
		expect(maps.known(campaign)).toBeNull();
	});
});

describe('what the planning screens say', () => {
	it('tells the time of day to the minute, past midnight the next morning\'s', () => {
		expect([clockText(6), clockText(17.5), clockText(20.25), clockText(9.999), clockText(25.25)]).toEqual(['06:00', '17:30', '20:15', '10:00', '01:15']);
	});

	it('says when a route would be home against dark', () => {
		expect(homeByText({ back: 17.5, dark: 20, spare: 2.5 })).toBe('Home by 17:30, 2.5 h before dark.');
		expect(homeByText({ back: 21.7, dark: 20, spare: -1.7 })).toBe('Home by 21:42, 1.7 h after dark.');
		expect(homeByText({ back: 20, dark: 20, spare: 0 })).toBe('Home at dark, 20:00.');
	});

	it('describes a route on its card, its hours as an estimate off charted road', () => {
		const route = { knowledge: 'charted' as const, stops: [{}, {}, {}, {}] as never[], hours: { out: 5.24, objective: 1.5, home: 3 }, fuel: 4, risk: 2, estimated: false };
		expect(routeDetail(route)).toBe('charted / 4 stops / 5.2 h out / fuel 4 / risk 2 of 3');
		expect(routeDetail({ ...route, knowledge: 'rumored', estimated: true, stops: [{}] as never[], risk: 0 })).toBe('rumored / 1 stop / about 5.2 h out / fuel 4 / risk 0 of 3');
	});

	it('tags and names a stop by its type, skulls for a fight, and "?" for one not known', () => {
		expect([stopTag({ type: 'ambush' }), stopText({ type: 'ambush', skulls: 2 })]).toEqual(['FIGHT', 'Raider ambush, 2 skulls']);
		expect([stopTag({ type: 'warband' }), stopText({ type: 'warband', skulls: 3 })]).toEqual(['WARBAND', 'Warband, 3 skulls']);
		expect([stopTag({ type: 'garage' }), stopText({ type: 'garage', skulls: 0 })]).toEqual(['GARAGE', 'Roadside garage']);
		expect([stopTag({ type: 'findDriver' }), stopText({ type: 'findDriver', skulls: 0 })]).toEqual(['FIND', 'Find: driver']);
		expect([stopTag({ type: null }), stopText({ type: null, skulls: 0 })]).toEqual(['?', 'Unknown stop']);
	});

	it('sums up a POI: its kind, yield, routes, and dark', () => {
		const poi = byDistance(POIS).find(({ stronghold, pastDark }) => !stronghold && !pastDark) as (typeof POIS)[number];
		expect(poiKindText(poi)).toMatch(new RegExp(`, tier ${poi.tier}$`));
		expect(poiKindText({ type: STRONGHOLD_TYPE, tier: 5 })).toBe('Stronghold, tier 5');
		expect(poiYieldText({ stronghold: false, yields: { food: 6, water: 4, fuel: 0, scrap: 0 } })).toBe('Yields 6 food and 4 water.');
		expect(poiYieldText({ stronghold: true, yields: null })).toBe('Its stores go to whoever takes it.');
		expect(routesText(poi)).toMatch(/^\d routes, the quickest [\d.]+ h out\.$/);
		expect(darkText({ routes: [{ spare: 1 }, { spare: -1 }] as never[] })).toBe('Home by dark on 1 of 2 routes.');
		expect(darkText({ routes: [{ spare: -1 }] as never[] })).toBe('No route gets home by dark.');
	});
});
