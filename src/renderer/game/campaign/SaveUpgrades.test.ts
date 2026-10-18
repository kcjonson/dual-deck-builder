import { CAMPAIGN_SCHEMA_VERSION } from './Campaign';
import { UPGRADABLE_SCHEMA_VERSIONS, UPGRADE_STEPS, upgradeCampaignJson } from './SaveUpgrades';

describe('save upgrades', () => {
	it('has a step from every version it lists up to the current one, so a bump can\'t leave a listed version stranded', () => {
		for (const version of UPGRADABLE_SCHEMA_VERSIONS) {
			expect(version).toBeLessThan(CAMPAIGN_SCHEMA_VERSION);
			for (let from = version; from < CAMPAIGN_SCHEMA_VERSION; from += 1) expect(typeof UPGRADE_STEPS[from]).toBe('function');
		}
	});

	it('refuses a version it doesn\'t list', () => {
		expect(() => upgradeCampaignJson({ campaign: {}, version: 7 })).toThrow("Version 7 saves can't be upgraded");
		expect(() => upgradeCampaignJson({ campaign: {}, version: CAMPAIGN_SCHEMA_VERSION })).toThrow(`Version ${CAMPAIGN_SCHEMA_VERSION} saves can't be upgraded`);
	});

	it('reads version 8\'s map state with every POI full, keeping anything else in it', () => {
		expect(upgradeCampaignJson({ campaign: { day: 3, map: {} }, version: 8 })).toEqual({ day: 3, map: {}, buildings: ['bunkhouse'] });
		expect(upgradeCampaignJson({ campaign: { day: 3, map: { pois: 'anything', fog: [1] } }, version: 8 })).toEqual({ day: 3, map: { fog: [1] }, buildings: ['bunkhouse'] });
	});

	it('stands the bunkhouse in a version 9 campaign, which every one was founded with', () => {
		expect(upgradeCampaignJson({ campaign: { day: 3, map: {}, supplyRun: null }, version: 9 })).toEqual({ day: 3, map: {}, supplyRun: null, buildings: ['bunkhouse'] });
	});

	it('clears each POI a version 11 campaign took stock from, once, in order, and drops the stock', () => {
		const map = { fog: [1], pois: [{ poi: 3, left: 1, nights: 4 }, { poi: 5, left: 0, nights: 2 }] };
		expect(upgradeCampaignJson({ campaign: { day: 3, map }, version: 11 })).toEqual({ day: 3, map: { fog: [1], clearedPois: [3, 5] } });
		expect(upgradeCampaignJson({ campaign: { day: 3, map: { pois: [] } }, version: 11 })).toEqual({ day: 3, map: {} });
		expect(upgradeCampaignJson({ campaign: { day: 3, map: { fog: [1] } }, version: 11 })).toEqual({ day: 3, map: { fog: [1] } });
		expect(upgradeCampaignJson({ campaign: { day: 3, map: [] }, version: 11 })).toEqual({ day: 3, map: [] });
	});

	it.each([
		['POIs out of order', [{ poi: 5, left: 0, nights: 2 }, { poi: 3, left: 1, nights: 4 }], 'Campaign.map.pois[1].poi must come after the entry above it (5), got 3'],
		['a POI twice', [{ poi: 5, left: 0, nights: 2 }, { poi: 5, left: 1, nights: 0 }], 'Campaign.map.pois[1].poi must come after the entry above it (5), got 5'],
		['a POI that was full', [{ poi: 5, left: 3, nights: 0 }], 'Campaign.map.pois[0].left must be an integer from 0 to 2, got 3'],
		['an entry with no POI', [{ poi: 'x', left: 0, nights: 0 }], 'Campaign.map.pois[0].poi must be a number, got "x"'],
		['stock that is not a list', 'garbage', 'Campaign.map.pois must be an array'],
	])('refuses version 11 stock with %s, as version 11 did, rather than guess at it', (_label, pois, message) => {
		expect(() => upgradeCampaignJson({ campaign: { day: 3, map: { pois } }, version: 11 })).toThrow(message);
	});

	it('gives a version 10 run out no recruits, since nothing found anyone new then', () => {
		expect(upgradeCampaignJson({ campaign: { day: 3, supplyRun: { stop: 1 } }, version: 10 })).toEqual({ day: 3, supplyRun: { stop: 1, recruits: [] } });
		expect(upgradeCampaignJson({ campaign: { day: 3, supplyRun: null }, version: 10 })).toEqual({ day: 3, supplyRun: null });
	});

	it.each([
		['not an object', 'campaign'],
		['a list', [1]],
		['null', null],
	])('passes %s through for the campaign reader to refuse', (_label, campaign) => {
		expect(upgradeCampaignJson({ campaign, version: 8 })).toEqual(campaign);
		expect(upgradeCampaignJson({ campaign, version: 9 })).toEqual(campaign);
		expect(upgradeCampaignJson({ campaign, version: 10 })).toEqual(campaign);
		expect(upgradeCampaignJson({ campaign, version: 11 })).toEqual(campaign);
	});

	it.each([
		['a campaign whose map isn\'t an object', { day: 3, map: [] }],
		['a campaign with no map', { day: 3 }],
	])('passes %s through version 8\'s step for the campaign reader to refuse', (_label, campaign) => {
		expect(upgradeCampaignJson({ campaign, version: 8 })).toEqual({ ...campaign, buildings: ['bunkhouse'] });
	});
});
