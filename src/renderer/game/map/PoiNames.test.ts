import { routeOffers } from '../campaign/MapRoutes';
import { plannedPois } from '../screens/area-map/planningMap';
import { generateAreaMap } from './AreaMapPipeline';
import { meshMap, randomMesh } from './meshTesting';
import { FACTIONS, POI_TUNING, STRONGHOLD_TYPE } from './PoiData';
import { PLACE_REACH, mapPoiNames, poiNames } from './PoiNames';
import type { Poi, PoiLayer } from './Pois';
import type { Settlement } from './Places';
import { paramsFor } from './roadTesting';

const RADIUS = 1000;
const REACH = PLACE_REACH * RADIUS;

const poi = (type: string, x: number, y: number): Poi => ({ site: { x, y, stretch: -1, along: 0, node: 0 }, arrivals: [], type, ring: 1, tier: 2 });
const layerOf = (...pois: Poi[]): Pick<PoiLayer, 'pois' | 'strongholds'> => ({ pois, strongholds: [] });
const settlement = (kind: 'town' | 'village', name: string, x: number, y: number): Settlement => ({ id: 0, kind, x, y, radius: 20, name, suitability: 1 });
const placesOf = (...settlements: Settlement[]) => ({ towns: settlements.filter(({ kind }) => kind === 'town'), villages: settlements.filter(({ kind }) => kind === 'village') });

describe('POI names', () => {
	it('take the nearest town or village and the type, its label in title case', () => {
		const places = placesOf(settlement('town', 'Elk Creek', 300, 0), settlement('village', 'Ashford', 0, 300));
		const names = poiNames(layerOf(poi('clinic', 320, 10), poi('salvageYard', 10, 280), poi('store', 200, 180)), { places, radius: RADIUS });
		// The store is nearer Elk Creek, 100 and 180 off against 200 and 120.
		expect(names).toEqual(['Elk Creek Clinic', 'Ashford Salvage Yard', 'Elk Creek General Store']);
	});

	it('keep type and bearing where no town or village is in reach', () => {
		const places = placesOf(settlement('town', 'Elk Creek', 0, 0));
		const names = poiNames(layerOf(poi('clinic', REACH + 1, 0), poi('farm', -REACH, 0), poi('mine', 400, 400)), { places, radius: RADIUS });
		expect(names).toEqual(['Clinic, east', 'Elk Creek Farm', 'Mine, north-east']);
		expect(poiNames(layerOf(poi('clinic', 10, 0)))).toEqual(['Clinic, east']);
		// No radius, no reach: not even a POI standing on the place takes its name.
		expect(poiNames(layerOf(poi('clinic', 0, 0), poi('farm', 10, 0)), { places })).toEqual(['Clinic, east', 'Farm, east']);
		expect(poiNames(layerOf(poi('clinic', 10, 0)), { places: placesOf(), radius: RADIUS })).toEqual(['Clinic, east']);
	});

	it('give the nearer of two alike the place, and the other the next place in its reach', () => {
		const pois = layerOf(poi('clinic', 150, 0), poi('clinic', 20, 0));
		expect(poiNames(pois, { places: placesOf(settlement('village', 'Elk Creek', 0, 0)), radius: RADIUS })).toEqual(['Elk Creek Clinic 2', 'Elk Creek Clinic']);
		const twoPlaces = placesOf(settlement('village', 'Elk Creek', 0, 0), settlement('village', 'Cold Springs', 150, 200));
		expect(poiNames(pois, { places: twoPlaces, radius: RADIUS })).toEqual(['Cold Springs Clinic', 'Elk Creek Clinic']);
	});

	it('are never alike, numbering stand-ins and places past the first', () => {
		const places = placesOf(settlement('town', 'Elk Creek', 0, 0));
		const pois = layerOf(poi('farm', 10, 0), poi('farm', 20, 0), poi('farm', 30, 0), poi('farm', 900, 10), poi('farm', 910, -10));
		expect(poiNames(pois, { places, radius: RADIUS })).toEqual(['Elk Creek Farm', 'Elk Creek Farm 2', 'Elk Creek Farm 3', 'Farm, east', 'Farm, east 2']);
		// Numbers go nearest first too, whatever the layer's order.
		const outward = layerOf(poi('farm', 200, 0), poi('farm', 100, 0), poi('farm', 10, 0));
		expect(poiNames(outward, { places, radius: RADIUS })).toEqual(['Elk Creek Farm 3', 'Elk Creek Farm 2', 'Elk Creek Farm']);
	});

	it('name strongholds by faction, whatever stands near them', () => {
		const map = meshMap(randomMesh({ seed: 701, spacing: 86 }), { seed: 1 });
		const { pois } = map.products;
		const onTop = placesOf(...pois.pois.map(({ site }, index) => settlement('village', `Place ${index}`, site.x, site.y)));
		const names = poiNames(pois, { places: onTop, radius: RADIUS });
		expect(new Set(names).size).toBe(names.length);
		pois.pois.forEach(({ type }, index) => {
			if (type !== STRONGHOLD_TYPE) expect(names[index]).toBe(`Place ${index} ${titleCase(POI_TUNING.types[type].label)}`);
		});
		for (const { poi: index, faction } of pois.strongholds) expect(names[index]).toBe(`${FACTIONS[faction].label} stronghold`);
	});

	it('name a generated map\'s POIs after its own towns and villages, alike on the area map and the run\'s routes', () => {
		const map = generateAreaMap({ params: paramsFor({ seed: 11, environment: 'rustBelt', radius: 800 }) });
		const { pois, places } = map.products;
		const names = mapPoiNames(map);
		expect(mapPoiNames(map)).toBe(names);
		expect(new Set(names).size).toBe(names.length);
		const settled = [...places.towns, ...places.villages];
		const reach = PLACE_REACH * map.params.radius;
		let fromPlaces = 0;
		pois.pois.forEach(({ type, site }, index) => {
			if (type === STRONGHOLD_TYPE) return;
			const label = titleCase(POI_TUNING.types[type].label);
			const near = settled.filter(({ x, y }) => Math.hypot(x - site.x, y - site.y) <= reach);
			if (near.length === 0) expect(names[index]).toMatch(new RegExp(`^${POI_TUNING.types[type].label}, [a-z-]+( \\d+)?$`));
			else {
				expect(near.some(({ name }) => names[index] === `${name} ${label}` || names[index].startsWith(`${name} ${label} `))).toBe(true);
				fromPlaces += 1;
			}
		});
		expect(fromPlaces).toBeGreaterThan(0);
		for (const planned of plannedPois(map)) expect(planned.name).toBe(names[planned.poi]);
		for (const { destination } of routeOffers(map)) expect(destination.name).toBe(names[Number(destination.id.slice('poi-'.length))]);
	});
});

function titleCase(label: string): string {
	return label.split(' ').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}
