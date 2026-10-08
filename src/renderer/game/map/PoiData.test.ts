import factionsFile from '../data/factions.json';
import poisFile from '../data/pois.json';
import { NO_RESOURCES } from '../campaign/Campaign';
import { MAP_PARAMETERS } from './MapParams';
import { FACTIONS, POI_RESOURCES, POI_TUNING, lengthOf, readFactions, readPoiTuning } from './PoiData';

/** Parsed JSON a test damages at any depth. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const read = (json: unknown) => readPoiTuning(json, 'PoiTuning');

/** The shipped file with one change made to it. */
const damaged = (change: (json: Json) => void): Json => {
	const json = JSON.parse(JSON.stringify(poisFile));
	change(json);
	return json;
};

describe('pois.json', () => {
	it('reads as the shipped tuning, frozen all the way down', () => {
		expect(read(JSON.parse(JSON.stringify(poisFile)))).toEqual(POI_TUNING);
		expect(Object.isFrozen(POI_TUNING)).toBe(true);
		expect(Object.isFrozen(POI_TUNING.approaches.steer)).toBe(true);
		expect(Object.isFrozen(POI_TUNING.placement[0].where[0])).toBe(true);
		expect(Object.isFrozen(POI_TUNING.types.hospital.yields)).toBe(true);
	});

	it('yields only what the compound stores, so a run brings home something it can keep', () => {
		for (const resource of POI_RESOURCES) expect(Object.keys(NO_RESOURCES)).toContain(resource);
		for (const { yields } of Object.values(POI_TUNING.types)) expect(Object.keys(yields).length).toBeGreaterThan(0);
	});

	it.each([
		['an unknown field', (json: Json) => { json.weather = 'clear'; }, 'PoiTuning has an unknown field "weather"'],
		['no rings', (json: Json) => { delete json.rings; }, 'PoiTuning.rings is missing'],
		['a band turned inside out', (json: Json) => { json.strongholds.band = { inner: 0.9, outer: 0.8 }; }, 'PoiTuning.strongholds.band.inner must be less than PoiTuning.strongholds.band.outer, got 0.9 and 0.8'],
		['a reach past the radius', (json: Json) => { json.approaches.reach.share = 1.5; }, 'PoiTuning.approaches.reach.share must be a share above 0 to 1, got 1.5'],
		['a reach in a string', (json: Json) => { json.approaches.reach = '0.12'; }, 'PoiTuning.approaches.reach must be an object, got "0.12"'],
		['part of a dart', (json: Json) => { json.sites.darts = 2.5; }, 'PoiTuning.sites.darts must be an integer >= 1, got 2.5'],
		['no rings to place POIs in', (json: Json) => { json.rings.targets = []; }, 'PoiTuning.rings.targets must list at least one ring'],
		['a detour shorter than the way there', (json: Json) => { json.approaches.detour = 0.5; }, 'PoiTuning.approaches.detour must be at least 1, got 0.5'],
		['a condition nothing reads', (json: Json) => { json.placement[0].where[0].nearRiver = true; }, 'PoiTuning.placement[0].where[0] has an unknown field "nearRiver"'],
		['a biome that isn\'t one', (json: Json) => { json.placement[3].where[0].biomes = ['swamp']; }, 'PoiTuning.placement[3].where[0].biomes[0] must be one of scrub, desert, mire, badlands, canyons, mountains, got "swamp"'],
		['a rule placing a type with no yields', (json: Json) => { json.placement[0].types = ['casino']; }, 'PoiTuning.placement[0].types[0] must be one of hospital, mall, waterPlant, fuelDepot, farm, silo, salvageYard, got "casino"'],
		['a type nothing places', (json: Json) => { json.types.casino = { label: 'Casino', yields: { scrap: 1 } }; }, 'PoiTuning.placement never places type "casino"'],
		['placement with no rule for anywhere left', (json: Json) => { json.placement.pop(); }, 'PoiTuning.placement must end with a rule that holds everywhere (a condition of {}), so every POI gets a type'],
		['a yield the compound doesn\'t store', (json: Json) => { json.types.farm.yields.ammo = 3; }, 'PoiTuning.types.farm.yields.ammo must be one of food, water, fuel, meds, scrap, got "ammo"'],
		['part of a yield', (json: Json) => { json.types.farm.yields.food = 2.5; }, 'PoiTuning.types.farm.yields.food must be an integer >= 1, got 2.5'],
		['a type that yields nothing', (json: Json) => { json.types.farm.yields = {}; }, 'PoiTuning.types.farm.yields must yield something'],
	])('rejects %s', (_label, change, message) => {
		expect(() => read(damaged(change))).toThrow(message);
	});
});

describe('factions.json', () => {
	it('reads as the shipped factions, enough for the most strongholds a map can have', () => {
		expect(readFactions(JSON.parse(JSON.stringify(factionsFile)), 'Factions')).toEqual(FACTIONS);
		expect(Object.keys(FACTIONS).length).toBeGreaterThanOrEqual(MAP_PARAMETERS.strongholds.tuning.max);
		expect(Object.isFrozen(FACTIONS.mireCrawlers.terrain.biomes)).toBe(true);
	});

	it.each([
		['too few factions', (json: Json) => { for (const name of Object.keys(json).slice(3)) delete json[name]; }, 'Factions must list at least 8 factions, one for each of the most strongholds a map can have, got 3'],
		['a biome that isn\'t one', (json: Json) => { json.mireCrawlers.terrain.biomes.swamp = 1; }, 'Factions.mireCrawlers.terrain.biomes.swamp must be one of scrub, desert, mire, badlands, canyons, mountains, got "swamp"'],
		['a weight below 0', (json: Json) => { json.mireCrawlers.terrain.ruin = -1; }, 'Factions.mireCrawlers.terrain.ruin must be at least 0, got -1'],
		['no label', (json: Json) => { delete json.mireCrawlers.label; }, 'Factions.mireCrawlers.label is missing'],
	])('rejects %s', (_label, change, message) => {
		const json = JSON.parse(JSON.stringify(factionsFile));
		change(json);
		expect(() => readFactions(json, 'Factions')).toThrow(message);
	});
});

describe('lengthOf', () => {
	it('scales with the radius but never falls below its clearances', () => {
		expect(lengthOf({ share: 0.12, clearances: 3 }, 1000, 24)).toBe(120);
		expect(lengthOf({ share: 0.12, clearances: 3 }, 600, 60)).toBe(180);
	});
});
