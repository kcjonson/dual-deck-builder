import campaignStartFile from '../data/campaign-start.json';
import { CAMPAIGN_START, readCampaignStart } from './CampaignStart';

type StartJson = Record<string, unknown>;

/** The stores in a start's JSON. */
const stores = (json: StartJson): StartJson => json.resources as StartJson;

/** The shipped file as a fresh object to damage. */
const shipped = (): StartJson => JSON.parse(JSON.stringify(campaignStartFile));

const read = (json: unknown) => readCampaignStart(json, 'CampaignStart');

/** The shipped file with one change made to it. */
const damaged = (change: (json: StartJson) => void): StartJson => {
	const json = shipped();
	change(json);
	return json;
};

describe('campaign-start.json', () => {
	it('reads as a campaign start, which founding uses when given none', () => {
		expect(read(shipped())).toEqual(CAMPAIGN_START);
	});

	it('comes back frozen, stores and escorts included', () => {
		expect(Object.isFrozen(CAMPAIGN_START)).toBe(true);
		expect(Object.isFrozen(CAMPAIGN_START.resources)).toBe(true);
		expect(Object.isFrozen(CAMPAIGN_START.escorts)).toBe(true);
	});

	it('takes up to four escorts, two of a type among them, as the convoy does', () => {
		const escorts = ['fuel_hauler', 'outrider', 'fuel_hauler', 'med_truck'];

		expect(read(damaged(json => { json.escorts = escorts; })).escorts).toEqual(escorts);
	});

	it.each([
		['an unknown field', (json: StartJson) => { json.weather = 'clear'; }, 'CampaignStart has an unknown field "weather"'],
		['no pool size', (json: StartJson) => { delete json.poolSize; }, 'CampaignStart.poolSize is missing'],
		['a pool of one, which could never send out a run', (json: StartJson) => { json.poolSize = 1; }, 'CampaignStart.poolSize must be an integer >= 2, got 1'],
		['a pool size in a string', (json: StartJson) => { json.poolSize = '4'; }, 'CampaignStart.poolSize must be a number, got "4"'],
		['no stores', (json: StartJson) => { delete json.resources; }, 'CampaignStart.resources is missing'],
		['a store missing', (json: StartJson) => { delete stores(json).meds; }, 'CampaignStart.resources.meds is missing'],
		['a store the compound doesn\'t keep', (json: StartJson) => { stores(json).ammo = 3; }, 'CampaignStart.resources has an unknown field "ammo"'],
		['a store below 0', (json: StartJson) => { stores(json).food = -1; }, 'CampaignStart.resources.food must be an integer >= 0, got -1'],
		['part of a store', (json: StartJson) => { stores(json).water = 2.5; }, 'CampaignStart.resources.water must be an integer >= 0, got 2.5'],
		['escorts that aren\'t a list', (json: StartJson) => { json.escorts = 'outrider'; }, 'CampaignStart.escorts must be an array, got "outrider"'],
		['an escort the garage doesn\'t hire', (json: StartJson) => { json.escorts = ['outrider', 'tank']; },
			'CampaignStart.escorts[1] must be one of outrider, pilot_car, fuel_hauler, med_truck, got "tank"'],
		['more escorts than the convoy takes', (json: StartJson) => { json.escorts = ['outrider', 'outrider', 'pilot_car', 'pilot_car', 'med_truck']; },
			'CampaignStart.escorts must hold at most 4, as many as the convoy takes, got 5']
	])('rejects %s', (_label, change, message) => {
		expect(() => read(damaged(change))).toThrow(message);
	});

	it('rejects a start that isn\'t an object', () => {
		expect(() => read([])).toThrow('CampaignStart must be an object, got []');
	});
});
