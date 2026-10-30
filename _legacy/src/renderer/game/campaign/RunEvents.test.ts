import { Rng } from '../core/Rng';
import { DRIVER_CONFIGS } from '../mechanics/Driver';
import { CAMPAIGN_START } from './CampaignStart';
import { Campaign, NO_RESOURCES, Resources } from './Campaign';
import type { EventGains } from './Events';
import { foundTestCampaign } from './__fixtures__/mapFixtures';
import { applyEventGains, payEventCost, recruitArchetype } from './RunEvents';
import { quickLoadOut, routesOnOffer, runParty } from './SupplyRun';
import type { SupplyRun } from './SupplyRunState';
import { meshMap, randomMesh } from '../map/meshTesting';

/** DDB-535: what an event does to a run on the road. */

const MAP = meshMap(randomMesh({ seed: 900, spacing: 85 }), { seed: 0 });

const NO_GAINS: EventGains = { resources: NO_RESOURCES, cards: {}, cardPick: false, escort: null, drivers: 0, structure: 0, hp: 0 };

function onTheRoad(): { campaign: Campaign; run: SupplyRun } {
	const campaign = foundTestCampaign({ seed: 20261019, unlockedArchetypes: ['road_warrior', 'interceptor'], start: CAMPAIGN_START });
	quickLoadOut({ campaign });
	const route = routesOnOffer({ map: MAP, campaign })[0];
	const run: SupplyRun = { route, stop: 0, phase: 'driving', escorts: [], cargo: NO_RESOURCES, cargoCards: {}, recruits: [], escortsFound: [], handOff: null };
	campaign.set({ supplyRun: run });
	return { campaign, run };
}

const resources = (amounts: Partial<Resources>): Resources => ({ ...NO_RESOURCES, ...amounts });

beforeEach(() => {
	jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
	jest.restoreAllMocks();
});

describe('an event on the road', () => {
	it('pays a cost from the cargo first and the rest from the stores', () => {
		const { campaign, run } = onTheRoad();
		campaign.set({ resources: resources({ fuel: 10, scrap: 2 }) });
		const paid = payEventCost({ campaign, run: { ...run, cargo: resources({ fuel: 2 }) }, cost: resources({ fuel: 5, scrap: 2 }) });
		expect(paid.run.cargo).toEqual(resources({}));
		expect(paid.resources).toEqual(resources({ fuel: 7 }));
	});

	it('puts gains in the cargo and takes losses from the cargo, then the stores, never below 0', () => {
		const { campaign, run } = onTheRoad();
		const gained = applyEventGains({
			campaign,
			run: { ...run, cargo: resources({ food: 1 }) },
			stores: resources({ food: 2, water: 4 }),
			party: runParty({ campaign }),
			gains: { ...NO_GAINS, resources: resources({ food: -5, water: -1, scrap: 6, people: 3 }) },
			rng: new Rng({ seed: 1 }),
		});
		expect(gained.run.cargo).toEqual(resources({ scrap: 6, people: 3 }));
		expect(gained.resources).toEqual(resources({ food: 0, water: 3 }));
	});

	it('hurts every seated driver and their vehicle down to 1 at worst, and mends them up to their most', () => {
		const { campaign, run } = onTheRoad();
		const party = runParty({ campaign });
		const apply = (gains: Partial<EventGains>): void => {
			applyEventGains({ campaign, run, stores: campaign.resources, party, gains: { ...NO_GAINS, ...gains }, rng: new Rng({ seed: 1 }) });
		};
		apply({ hp: -1000, structure: -1000 });
		for (const seat of party.seats) expect([seat.hitpoints, seat.vehicle.structure]).toEqual([1, 1]);
		apply({ hp: 1000, structure: 1000 });
		for (const seat of party.seats) expect([seat.hitpoints, seat.vehicle.structure]).toEqual([seat.maxHitpoints, DRIVER_CONFIGS[seat.archetype].vehicleStats.maxStructure]);
	});

	it('gives cards, an escort, and drivers to ride home with the run, each driver of the archetype the compound has fewest of', () => {
		const { campaign, run } = onTheRoad();
		const gained = applyEventGains({
			campaign,
			run,
			stores: campaign.resources,
			party: runParty({ campaign }),
			gains: { ...NO_GAINS, cards: { medical_kit: 1 }, escort: 'outrider', drivers: 2 },
			rng: new Rng({ seed: 1 }),
		});
		expect(gained.run.cargoCards).toEqual({ medical_kit: 1 });
		expect(gained.run.escortsFound).toEqual(['outrider']);
		// The pool is a Road Warrior and an Interceptor, so the first is a Mechanic
		expect(gained.run.recruits).toHaveLength(2);
		expect(gained.run.recruits[0]).toBe('mechanic');
		expect(campaign.convoy.escorts).toHaveLength(0);
	});

	it('picks a new driver\'s archetype among those tied for fewest, counting recruits riding home', () => {
		const { campaign } = onTheRoad();
		expect(recruitArchetype({ campaign, recruits: ['mechanic', 'mechanic', 'road_warrior'], rng: new Rng({ seed: 3 }) })).toBe('interceptor');
	});
});
