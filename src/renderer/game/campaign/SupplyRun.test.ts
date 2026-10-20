import { Rng } from '../core/Rng';
import cardsFile from '../data/cards.json';
import { meshMap, randomMesh } from '../map/meshTesting';
import { STRONGHOLD_TYPE } from '../map/PoiData';
import { Card, CardData } from '../mechanics/Card';
import type { DriverArchetype } from '../mechanics/Driver';
import { assertDriverSeats } from '../mechanics/DriverPair';
import { createEscort } from '../mechanics/Escort';
import { Campaign, CampaignJson, NO_RESOURCES } from './Campaign';
import { CampaignOverError } from './CampaignEnd';
import { CAMPAIGN_START } from './CampaignStart';
import { CampaignStore } from './CampaignStore';
import { withdrawFight } from './CombatBridge';
import { encounterForces } from './Encounters';
import { foundTestCampaign } from './__fixtures__/mapFixtures';
import type { DriverRecord } from './DriverRecord';
import { getCrewRule, getSeatBlocker } from './Seating';
import { REWARD_CHOICES, rollRewardCards } from './RunRewards';
import { endDay } from './DayClock';
import { destinationId, poiOf, routeOffers, routeStop, stopOf } from './MapRoutes';
import { STOP_COOLDOWN_DAYS, clearPoi, clearStop, clearedPois, stopState, stopStates } from './MapClearing';
import { rollStop } from '../map/Stops';
import { MemorySaveStorage } from './SaveStorage';
import { FindStop, RouteStop, RunRoute, everyStop, readRunRoute, routeStops } from './SupplyRoutes';
import type { SupplyRun } from './SupplyRunState';
import {
	DepartRuleError, arriveHome, atDestination, currentStop, departRun, finishStopFight, foundDriver, getDepartBlocker, getPlanBlocker, leaveFind, passQuietStop,
	quickLoadOut, cargoText, rewardOffer, routesOnOffer, runParty, runStream, startStopFight, takeFind, takeReward, yieldResources
} from './SupplyRun';
import { fightOut, pushovers, snipers } from './__fixtures__/runFixtures';
import { CAMPAIGN_FIXTURE } from './__fixtures__/storeFixtures';

/** DDB-454: the MVP supply run, from departure to home or a failed run, on the area map's routes (DDB-479). */

const SEED = 20261009;

/** The area map these runs set off on: a mesh with POIs, strongholds, routes, and stops, as a generated map has (meshTesting.ts). */
const MAP = meshMap(randomMesh({ seed: 900, spacing: 85 }), { seed: 0 });

/** A map with no POIs, so no routes. */
const EMPTY_MAP = {
	...MAP,
	products: { pois: { ...MAP.products.pois, pois: [], legs: [], strongholds: [] }, stops: { ...MAP.products.stops, stops: [], legs: [] } },
};

const CARDS: ReadonlyMap<string, Card> = new Map(
	(cardsFile as unknown as { cards: CardData[] }).cards.map(data => [data.type, new Card(data)])
);

/** A compound founded with only these archetypes unlocked, so its pool is one of each, and fuel to spare. */
function newCampaign(archetypes: DriverArchetype[] = ['road_warrior', 'interceptor', 'mechanic']): Campaign {
	return foundTestCampaign({ seed: SEED, unlockedArchetypes: archetypes, start: { ...CAMPAIGN_START, resources: { ...CAMPAIGN_START.resources, fuel: 20 } } });
}

/**
 * The route these runs take: the shortest on offer, by stops, with a fight
 * and a quiet stretch on it, so a run meets both and stays quick to drive.
 */
function testRoute(): RunRoute {
	const mixed = routesOnOffer({ map: MAP, campaign: newCampaign() }).filter(route => {
		const kinds = routeStops(route).map(stop => stop.kind);
		return kinds.includes('fight') && kinds.includes('quiet');
	});
	const route = [...mixed].sort((a, b) => routeStops(a).length - routeStops(b).length)[0];
	if (!route) throw new Error('the map should offer a route with a fight and a quiet stretch');
	return route;
}

/** Precision Shots in every seat, so a seat's opening hand finishes any raider here. */
function sharpshooters(campaign: Campaign): void {
	campaign.drivers.forEach(driver => driver.set({ defaultDeck: { precision_shot: 10 } }));
}

/** The run on the road, which a test has just put there. */
function onRoad(campaign: Campaign): SupplyRun {
	const run = campaign.supplyRun;
	if (!run) throw new Error('a run should be on the road');
	return run;
}

/** Quiet stretches passed until the run is driving to a fight. */
function toNextFight(campaign: Campaign): void {
	while (currentStop(onRoad(campaign))?.kind === 'quiet') passQuietStop({ campaign });
}

/** A save and a load through the store, as quitting and Continue would. */
async function reload(store: CampaignStore, campaign: Campaign): Promise<Campaign> {
	expect(await store.checkpoint(campaign)).toBe('saved');
	const loaded = await store.load();
	if (!loaded) throw new Error('the save should load');
	expect(loaded.toSaveText()).toBe(campaign.toSaveText());
	return loaded;
}

const newStore = (): CampaignStore => new CampaignStore({ storage: new MemorySaveStorage(), namespace: 'test', onWarning: () => undefined });

/** The fixture home and lost to a night with no People. */
function overCampaign(): Campaign {
	return Campaign.fromJSON({
		...JSON.parse(JSON.stringify(CAMPAIGN_FIXTURE)), runDecks: [], foundOnRun: [], supplyRun: null,
		resources: { ...CAMPAIGN_FIXTURE.resources, people: 0 }, end: { ending: 'disbanded', cause: 'no_people' }
	} as CampaignJson, { onWarning: () => undefined });
}

beforeEach(() => {
	// Drivers log every draw
	jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
	jest.restoreAllMocks();
});

describe('the routes on offer (DDB-479)', () => {
	it('offers every route the area map has, POI by POI, but a stronghold\'s, worked out once a map', () => {
		const offered = routesOnOffer({ map: MAP, campaign: newCampaign() });
		const strongholds = new Set(MAP.products.pois.strongholds.map(({ poi }) => destinationId(poi)));
		expect(strongholds.size).toBeGreaterThan(0);
		expect(offered).toEqual(routeOffers(MAP).filter(route => !strongholds.has(route.destination.id)));
		expect(routesOnOffer({ map: MAP, campaign: newCampaign() })).toBe(offered);
	});

	it('offers every POI that isn\'t a stronghold, at any tier, whether or not a route is home by dark', () => {
		const offered = routesOnOffer({ map: MAP, campaign: newCampaign() });
		const destinations = new Set(offered.map(route => route.destination.id));
		MAP.products.pois.pois.forEach((poi, index) => expect(destinations.has(destinationId(index))).toBe(poi.type !== STRONGHOLD_TYPE));
		expect(new Set(offered.map(route => route.destination.tier)).size).toBeGreaterThan(1);
		const pastDark = offered.filter(({ hours }) => hours.out + hours.objective + hours.home > MAP.params.daylightHours);
		expect(pastDark.length).toBeGreaterThan(0);
	});

	it('offers nothing on a map with no POIs', () => {
		expect(routesOnOffer({ map: EMPTY_MAP, campaign: newCampaign() })).toEqual([]);
	});

	it.each([
		['no legs', (route: Record<string, unknown>) => { route.legs = []; }, 'route.legs is empty; a route has a leg at least'],
		['a stop of no kind it knows', (route: Record<string, unknown>) => { (route.legs as { stops: unknown[] }[])[1].stops = [{ id: 's', kind: 'garage', at: 0.5 }]; },
			'route.legs[1].stops[0].kind must be one of fight, quiet, find, got "garage"'],
		['a fight past three skulls', (route: Record<string, unknown>) => { (route.legs as { stops: unknown[] }[])[1].stops = [{ id: 's', kind: 'fight', at: 0.5, skulls: 4 }]; },
			'route.legs[1].stops[0].skulls must be an integer from 1 to 3, got 4'],
		['stops out of driving order', (route: Record<string, unknown>) => {
			(route.legs as { stops: unknown[] }[])[1].stops = [{ id: 'a', kind: 'quiet', at: 0.6 }, { id: 'b', kind: 'quiet', at: 0.2 }];
		}, "route.legs[1].stops[1].at 0.2 comes before the stop above it; a leg's stops are in driving order"],
		['a stop off the end of its leg', (route: Record<string, unknown>) => { (route.legs as { stops: unknown[] }[])[1].stops = [{ id: 's', kind: 'quiet', at: 1.5 }]; },
			'route.legs[1].stops[0].at must be from 0 to 1, got 1.5'],
		['a road class it doesn\'t know', (route: Record<string, unknown>) => { (route.legs as { roadClass: string }[])[0].roadClass = 'canal'; },
			'route.legs[0].roadClass must be one of highway, backRoad, trail, got "canal"'],
	])('refuses a saved route with %s', (_name, change, message) => {
		const twoLegs = routesOnOffer({ map: MAP, campaign: newCampaign() }).find(offered => offered.legs.length > 1);
		const route = JSON.parse(JSON.stringify(twoLegs)) as Record<string, unknown>;
		expect(readRunRoute(JSON.parse(JSON.stringify(route)), 'route')).toEqual(twoLegs);
		change(route);
		expect(() => readRunRoute(route, 'route')).toThrow(message);
	});
});

describe('the raider encounters', () => {
	it('fields an encounter template for the stop\'s skulls at the destination\'s tier, picked on the stop\'s fight stream', () => {
		const campaign = newCampaign();
		quickLoadOut({ campaign });
		const route = testRoute();
		departRun({ campaign, map: MAP, route, escorts: [] });
		toNextFight(campaign);
		const run = onRoad(campaign);
		const stop = currentStop(run);
		if (stop?.kind !== 'fight') throw new Error('the run should be driving to a fight');
		const expected = encounterForces({ skulls: stop.skulls, tier: route.destination.tier, cards: CARDS, seats: 2, rng: runStream({ campaign }).fork('fight', run.stop) });

		const fight = startStopFight({ campaign, cards: CARDS });

		expect(fight.battle.enemyTeam.vehicles.map(raider => raider.name)).toEqual(expected.team.vehicles.map(raider => raider.name));
		expect(fight.battle.waves).toMatchObject({ number: 1, total: expected.template.waves.length });
	});

	it('takes the raiders a caller hands it instead', () => {
		const campaign = newCampaign();
		quickLoadOut({ campaign });
		departRun({ campaign, map: MAP, route: testRoute(), escorts: [] });
		toNextFight(campaign);
		const team = pushovers();
		const fight = startStopFight({ campaign, cards: CARDS, raiders: () => team });
		expect(fight.battle.enemyTeam).toBe(team);
		expect(fight.battle.turn).toBe(1);
	});
});

describe('a fight the raiders break off', () => {
	it('carries the run on past the stop with no reward, and counts no fight won', () => {
		const campaign = newCampaign();
		quickLoadOut({ campaign });
		departRun({ campaign, map: MAP, route: testRoute(), escorts: [] });
		toNextFight(campaign);
		const before = onRoad(campaign);
		const mapBefore = campaign.map;
		const fight = startStopFight({ campaign, cards: CARDS, raiders: pushovers, enemyAI: null });
		// Nobody fires: three quiet turns break it off
		for (let turn = 0; turn < 3; turn += 1) fight.battle.endPlayerTurn();
		expect(fight.battle.isBattleBrokenOff()).toBe(true);

		const result = finishStopFight({ campaign, fight });

		expect(result.outcome).toBe('broken_off');
		const run = onRoad(campaign);
		expect([run.stop, run.phase]).toEqual([before.stop + 1, 'driving']);
		expect(run.cargo).toEqual(before.cargo);
		expect(campaign.tally.fightsWon).toBe(0);
		// Resolved, so it clears with the rest once the run is home; nothing clears on the road
		expect(campaign.map).toBe(mapBefore);
		expect(campaign.log.map(entry => entry.message)).toContain(`The raiders broke off at stop ${before.stop + 1} on the run to ${before.route.destination.name}.`);
	});
});

describe('the reward', () => {
	it('offers three different cards from the reward pool, never an escort\'s own, and order cards only with an escort', () => {
		const signature = new Set((cardsFile.cards as { type: string; rarity: string }[]).filter(card => card.rarity === 'signature').map(card => card.type));
		const orders = new Set((cardsFile.cards as { type: string; tags?: string[] }[]).filter(card => card.tags?.includes('order')).map(card => card.type));
		for (let roll = 0; roll < 50; roll += 1) {
			const offer = rollRewardCards({ rng: new Rng({ seed: SEED }).fork('reward', roll), ownsEscort: false });
			expect(new Set(offer).size).toBe(REWARD_CHOICES);
			expect(offer.some(card => signature.has(card) || orders.has(card))).toBe(false);
		}
		const withEscort = Array.from({ length: 50 }, (_, roll) => rollRewardCards({ rng: new Rng({ seed: SEED }).fork('reward', roll), ownsEscort: true })).flat();
		expect(withEscort.some(card => orders.has(card))).toBe(true);
		expect(withEscort.some(card => signature.has(card))).toBe(false);
	});
});

describe('planning a run', () => {
	it('is open with a pair to send and fuel for the cheapest route', () => {
		expect(getPlanBlocker({ map: MAP, campaign: newCampaign() })).toBeNull();
	});

	it('says why not: a run out, nobody fit to go, no routes, too little fuel, or a campaign that\'s over', () => {
		const out = newCampaign();
		quickLoadOut({ campaign: out });
		expect(getPlanBlocker({ map: MAP, campaign: out })).toEqual({ reason: 'run_out', run: 'run-1' });

		const hurt = newCampaign();
		hurt.drivers.forEach(driver => driver.set({ status: 'injured', injuredDays: 2, hitpoints: 5 }));
		expect(getPlanBlocker({ map: MAP, campaign: hurt })).toEqual({ reason: 'no_crew' });

		expect(getPlanBlocker({ map: EMPTY_MAP, campaign: newCampaign() })).toEqual({ reason: 'no_routes' });

		const dry = newCampaign();
		const cheapest = Math.min(...routesOnOffer({ map: MAP, campaign: newCampaign() }).map(route => route.fuel));
		dry.set({ resources: { ...dry.resources, fuel: cheapest - 1 } });
		expect(getPlanBlocker({ map: MAP, campaign: dry })).toEqual({ reason: 'too_little_fuel', needed: cheapest, held: cheapest - 1 });

		expect(getPlanBlocker({ map: MAP, campaign: overCampaign() })?.reason).toBe('campaign_over');
	});

	it('stays open with one driver fit to go, or only drivers of one archetype (gameplay call 35)', () => {
		const lone = newCampaign();
		lone.drivers.slice(1).forEach(driver => driver.set({ status: 'injured', injuredDays: 2, hitpoints: 5 }));
		expect(getPlanBlocker({ map: MAP, campaign: lone })).toBeNull();

		const twins = newCampaign(['road_warrior', 'interceptor']);
		twins.recruitDriver({ archetype: 'road_warrior' });
		twins.drivers.filter(driver => driver.archetype === 'interceptor').forEach(driver => driver.set({ status: 'missing' }));
		expect(getPlanBlocker({ map: MAP, campaign: twins })).toBeNull();
	});
});

describe('the crew rule (gameplay call 35)', () => {
	it('seats a pair of different archetypes while two such are fit, and refuses a same-archetype pair then', () => {
		const campaign = newCampaign();
		const second = campaign.recruitDriver({ archetype: campaign.drivers[0].archetype });
		expect(getCrewRule({ campaign })).toBe('pair');
		expect(getSeatBlocker({ campaign, driver: second, partner: campaign.drivers[0] })?.reason).toBe('same_archetype');
		expect(() => campaign.startRunDecks({ seats: [campaign.drivers[0]] })).toThrow('A run seats two drivers, not 1');
	});

	it('lets a same-archetype pair go when every fit driver shares an archetype, and seats them through the quick load out', () => {
		const campaign = newCampaign(['road_warrior', 'interceptor']);
		const warrior = campaign.drivers.find(driver => driver.archetype === 'road_warrior') as DriverRecord;
		const interceptor = campaign.drivers.find(driver => driver.archetype === 'interceptor') as DriverRecord;
		const second = campaign.recruitDriver({ archetype: 'road_warrior' });
		interceptor.set({ status: 'injured', injuredDays: 3, hitpoints: 5 });

		expect(getCrewRule({ campaign })).toBe('same_archetype');
		expect(getSeatBlocker({ campaign, driver: second, partner: warrior })).toBeNull();
		expect(quickLoadOut({ campaign }).seats).toEqual([warrior, second]);
		expect(campaign.runDecks.map(deck => deck.driver)).toEqual([warrior, second]);
	});

	it('sends one driver alone when only one is fit, with every escort\'s card in their deck', () => {
		const campaign = newCampaign(['road_warrior', 'interceptor']);
		const hauler = createEscort({ type: 'fuel_hauler' });
		campaign.convoy.add(hauler);
		const [first, second] = campaign.drivers;
		second.set({ status: 'injured', injuredDays: 2, hitpoints: 5 });

		expect(getCrewRule({ campaign })).toBe('solo');
		const { seats } = quickLoadOut({ campaign });
		expect(seats).toEqual([first]);
		expect(campaign.runDecks).toHaveLength(1);
		expect(campaign.runDecks[0].escortCards.map(card => card.broughtBy)).toEqual(['escort-1']);
	});

	it('seats nobody with nobody fit, or once the campaign is over', () => {
		const campaign = newCampaign(['road_warrior', 'interceptor']);
		campaign.drivers.forEach(driver => driver.set({ status: 'injured', injuredDays: 2, hitpoints: 5 }));
		expect(getCrewRule({ campaign })).toBe('none');
		expect(() => quickLoadOut({ campaign })).toThrow('Nobody at the compound can go out on a run');
		expect(campaign.runDecks).toEqual([]);
		expect(getCrewRule({ campaign: overCampaign() })).toBe('none');
	});

	it('takes a lone driver through a whole run: the fight alone, then home', () => {
		const campaign = newCampaign(['road_warrior', 'interceptor']);
		sharpshooters(campaign);
		const [first, second] = campaign.drivers;
		second.set({ status: 'injured', injuredDays: 2, hitpoints: 5 });
		const { escorts } = quickLoadOut({ campaign });
		const route = testRoute();
		departRun({ campaign, map: MAP, route, escorts });
		while (!atDestination(onRoad(campaign))) {
			if (currentStop(onRoad(campaign))?.kind === 'quiet') {
				passQuietStop({ campaign });
				continue;
			}
			const fight = startStopFight({ campaign, cards: CARDS, raiders: pushovers, enemyAI: null });
			expect(fight.drivers).toHaveLength(1);
			fightOut(fight);
			expect(finishStopFight({ campaign, fight }).outcome).toBe('won');
			takeReward({ campaign, cardType: null });
		}

		const arrival = arriveHome({ campaign });

		expect(arrival.seats).toEqual([first]);
		expect(first.runsCompleted).toBe(1);
		expect(campaign.supplyRun).toBeNull();
	});
});

describe('a run of two drivers of one archetype (DDB-539)', () => {
	/**
	 * The playtest's third run: the Interceptor comes home hurt, then the
	 * Road Warrior does, and the two Mechanics are all that's fit.
	 */
	function mechanicsOnly(): Campaign {
		const campaign = newCampaign();
		campaign.recruitDriver({ archetype: 'mechanic' });
		const byArchetype = (archetype: DriverArchetype): DriverRecord => campaign.drivers.find(driver => driver.archetype === archetype) as DriverRecord;
		byArchetype('interceptor').set({ status: 'injured', injuredDays: 2, hitpoints: 5 });
		byArchetype('road_warrior').set({ status: 'injured', injuredDays: 3, hitpoints: 5 });
		return campaign;
	}

	it('seats Mechanic 1 and Mechanic 2, departs, and starts the fight with both in the seats', () => {
		const campaign = mechanicsOnly();
		expect(getCrewRule({ campaign })).toBe('same_archetype');

		const { seats } = quickLoadOut({ campaign });
		expect(seats.map(seat => seat.name)).toEqual(['Mechanic 1', 'Mechanic 2']);
		departRun({ campaign, map: MAP, route: testRoute(), escorts: [] });
		toNextFight(campaign);
		const fight = startStopFight({ campaign, cards: CARDS, raiders: pushovers, enemyAI: null });

		expect(fight.party.seats).toEqual(seats);
		expect(() => assertDriverSeats(fight.battle.playerSeats)).not.toThrow();
		expect(fight.battle.playerSeats.map(driver => driver.metadata.name)).toEqual(['Mechanic 1', 'Mechanic 2']);
	});

	it('starts the fight from a save made at it, as the stuck saves were', async () => {
		const campaign = mechanicsOnly();
		quickLoadOut({ campaign });
		departRun({ campaign, map: MAP, route: testRoute(), escorts: [] });
		toNextFight(campaign);
		const loaded = await reload(newStore(), campaign);

		const fight = startStopFight({ campaign: loaded, cards: CARDS, raiders: pushovers, enemyAI: null });

		expect(() => assertDriverSeats(fight.battle.playerSeats)).not.toThrow();
		expect(fight.party.seats.map(seat => seat.name)).toEqual(['Mechanic 1', 'Mechanic 2']);
	});

	it('gives up a fight that never showed, so the run can start it again, and refuses one already over', () => {
		const campaign = mechanicsOnly();
		quickLoadOut({ campaign });
		departRun({ campaign, map: MAP, route: testRoute(), escorts: [] });
		toNextFight(campaign);
		const before = campaign.toSaveText();
		const fight = startStopFight({ campaign, cards: CARDS, raiders: pushovers, enemyAI: null });
		expect(() => startStopFight({ campaign, cards: CARDS })).toThrow("This campaign's last fight hasn't been written back");

		withdrawFight({ fight });

		expect(campaign.toSaveText()).toBe(before);
		expect(() => withdrawFight({ fight })).toThrow("This fight isn't the campaign's open one");
		const again = startStopFight({ campaign, cards: CARDS, raiders: pushovers, enemyAI: null });
		for (let turn = 0; turn < 3; turn += 1) again.battle.endPlayerTurn();
		expect(() => withdrawFight({ fight: again })).toThrow("This fight is over, so it's written back, not withdrawn");
	});
});

describe('the quick load out', () => {
	it('seats the first pair that can go, Driver 1 first, and takes every escort, their cards to Driver 1', () => {
		const campaign = newCampaign();
		campaign.drivers[0].set({ status: 'injured', injuredDays: 1, hitpoints: 10 });
		const [hauler, outrider] = (['fuel_hauler', 'outrider'] as const).map(type => createEscort({ type }));
		[hauler, outrider].forEach(escort => campaign.convoy.add(escort));

		const { seats, escorts } = quickLoadOut({ campaign });

		expect(seats).toEqual([campaign.drivers[1], campaign.drivers[2]]);
		expect(escorts).toEqual([hauler, outrider]);
		expect(campaign.runDecks[0].escortCards.map(card => card.broughtBy)).toEqual(['escort-1', 'escort-2']);
		expect(() => departRun({ campaign, map: MAP, route: testRoute(), escorts })).not.toThrow();
	});

});

describe('departing', () => {
	it('pays the fuel and puts the run on the road at its first stop, with the seats and escorts load out sent and nothing in the cargo', () => {
		const campaign = newCampaign();
		const hauler = createEscort({ type: 'fuel_hauler' });
		campaign.convoy.add(hauler);
		const { seats, escorts } = quickLoadOut({ campaign });
		const route = testRoute();

		const run = departRun({ campaign, map: MAP, route, escorts });

		expect(campaign.resources.fuel).toBe(20 - route.fuel);
		expect(run).toEqual({ route, stop: 0, phase: 'driving', escorts: [hauler], cargo: { food: 0, water: 0, fuel: 0, meds: 0, scrap: 0, people: 0 }, cargoCards: {}, recruits: [] });
		expect(campaign.supplyRun).toBe(run);
		expect(runParty({ campaign })).toEqual({ seats, escorts: [hauler], cargo: run.cargo, cargoCards: {}, run: 'run-1' });
	});

	it('refuses a route that costs more fuel than the stores hold, changing nothing', () => {
		const campaign = newCampaign();
		quickLoadOut({ campaign });
		const route = testRoute();
		campaign.set({ resources: { ...campaign.resources, fuel: route.fuel - 1 } });
		const before = campaign.toSaveText();

		expect(getDepartBlocker({ campaign, route })).toEqual({ reason: 'too_little_fuel', needed: route.fuel, held: route.fuel - 1 });
		let error: unknown = null;
		try {
			departRun({ campaign, map: MAP, route, escorts: [] });
		} catch (thrown) {
			error = thrown;
		}
		expect(error).toBeInstanceOf(DepartRuleError);
		expect((error as DepartRuleError).blocker.reason).toBe('too_little_fuel');
		expect(campaign.toSaveText()).toBe(before);
	});

	it('refuses a second departure while the run is on the road: one run a day', () => {
		const campaign = newCampaign();
		quickLoadOut({ campaign });
		const route = testRoute();
		departRun({ campaign, map: MAP, route, escorts: [] });

		expect(getDepartBlocker({ campaign, route })).toEqual({ reason: 'run_out', run: 'run-1' });
		expect(() => departRun({ campaign, map: MAP, route, escorts: [] })).toThrow("run-1 is on the road, so no other run sets off until it's home");
	});

	it('pays what the map\'s route costs, whatever the route handed in says', () => {
		const campaign = newCampaign();
		const { escorts } = quickLoadOut({ campaign });
		const route = testRoute();
		departRun({ campaign, map: MAP, route: { ...route, fuel: 0 }, escorts });
		expect(campaign.resources.fuel).toBe(20 - route.fuel);
		expect(onRoad(campaign).route).toEqual(route);
	});

	it('refuses a run with no run decks started, since load out starts them', () => {
		const campaign = newCampaign();
		expect(() => departRun({ campaign, map: MAP, route: testRoute(), escorts: [] })).toThrow('Load out starts the run decks before a run sets off');
	});

	it("refuses a route the map doesn't offer: a stronghold's, which waits for assaults, or one it hasn't got", () => {
		const campaign = newCampaign();
		quickLoadOut({ campaign });
		const strongholds = new Set(MAP.products.pois.strongholds.map(({ poi }) => destinationId(poi)));
		const assault = routeOffers(MAP).find(route => strongholds.has(route.destination.id)) as RunRoute;
		expect(() => departRun({ campaign, map: MAP, route: assault, escorts: [] })).toThrow(`${assault.id} isn't a route the area map offers`);
		const elsewhere = { ...testRoute(), id: 'route-999-0' };
		expect(() => departRun({ campaign, map: MAP, route: elsewhere, escorts: [] })).toThrow("route-999-0 isn't a route the area map offers");
		expect(campaign.supplyRun).toBeNull();
	});

	it('refuses escorts that aren\'t the ones whose cards load out dealt', () => {
		const campaign = newCampaign();
		const [hauler, outrider] = (['fuel_hauler', 'outrider'] as const).map(type => createEscort({ type }));
		[hauler, outrider].forEach(escort => campaign.convoy.add(escort));
		campaign.startRunDecks({ seats: [campaign.drivers[0], campaign.drivers[1]], escorts: [hauler] });
		const route = testRoute();

		expect(() => departRun({ campaign, map: MAP, route, escorts: [] })).toThrow("A run deck holds the card escort-1 brought, and it isn't coming");
		expect(() => departRun({ campaign, map: MAP, route, escorts: [hauler, outrider] })).toThrow('Outrider (escort-2) is coming, and no run deck holds its run_ahead');
		expect(() => departRun({ campaign, map: MAP, route, escorts: [hauler, hauler] })).toThrow('Fuel Hauler (escort-1) is listed twice');
		expect(campaign.supplyRun).toBeNull();
	});

	it('refuses once the campaign is over', () => {
		const over = overCampaign();
		expect(() => departRun({ campaign: over, map: MAP, route: routesOnOffer({ map: MAP, campaign: newCampaign() })[0], escorts: [] })).toThrow(CampaignOverError);
	});
});

describe('a whole run, scripted through the real APIs and saved after every step', () => {
	it('drives every stop, wins each fight, takes each reward, and comes home with the cargo', async () => {
		const store = newStore();
		let campaign = newCampaign();
		sharpshooters(campaign);
		await store.save(campaign);
		const day = campaign.day;
		const route = testRoute();
		const stops = routeStops(route);
		const { seats } = quickLoadOut({ campaign });
		departRun({ campaign, map: MAP, route, escorts: [] });
		campaign = await reload(store, campaign);
		const taken: string[] = [];

		for (let stop = 0; stop < stops.length; stop += 1) {
			expect([onRoad(campaign).stop, onRoad(campaign).phase]).toEqual([stop, 'driving']);
			if (currentStop(onRoad(campaign))?.kind === 'quiet') {
				passQuietStop({ campaign });
				campaign = await reload(store, campaign);
				continue;
			}
			const fight = startStopFight({ campaign, cards: CARDS, raiders: pushovers, enemyAI: null });
			fightOut(fight);
			expect(finishStopFight({ campaign, fight }).outcome).toBe('won');
			expect(onRoad(campaign).phase).toBe('reward');
			campaign = await reload(store, campaign);

			const offer = rewardOffer({ campaign });
			expect(offer).toHaveLength(REWARD_CHOICES);
			// A load offers the same cards
			campaign = await reload(store, campaign);
			expect(rewardOffer({ campaign })).toEqual(offer);
			takeReward({ campaign, cardType: offer[0] });
			taken.push(offer[0]);
			campaign = await reload(store, campaign);
		}

		expect([onRoad(campaign).stop, onRoad(campaign).phase]).toEqual([stops.length, 'driving']);
		expect(atDestination(onRoad(campaign))).toBe(true);
		const won = Object.fromEntries([...new Set(taken)].map(type => [type, taken.filter(card => card === type).length]));
		expect(onRoad(campaign).cargoCards).toEqual(won);
		// The destination's yield loaded on reaching it, ahead of the drive home
		const loaded = yieldResources(route.destination.yield);
		expect(onRoad(campaign).cargo).toEqual(loaded);
		const locker = campaign.locker;
		const scrap = campaign.resources.scrap;

		const arrival = arriveHome({ campaign });

		expect(arrival.cargo.cards).toEqual(won);
		expect(arrival.cargo.resources).toEqual(loaded);
		expect(campaign.resources.scrap).toBe(scrap + loaded.scrap);
		expect(campaign.log.map(entry => entry.message)).toContain(`Home from ${route.destination.name} with ${cargoText({ cargo: loaded, cards: won })}.`);
		expect(arrival.seats.map(seat => seat.id)).toEqual(seats.map(seat => seat.id));
		expect(campaign.supplyRun).toBeNull();
		expect(campaign.currentRun).toBeNull();
		expect(arrival.dayEnd.day).toBe(day);
		expect(campaign.day).toBe(day + 1);
		expect(campaign.tally.runsHome).toBe(1);
		expect(campaign.tally.fightsWon).toBe(stops.filter(stop => stop.kind === 'fight').length);
		expect(arrival.seats.map(seat => seat.runsCompleted)).toEqual([1, 1]);
		expect(campaign.resources.fuel).toBe(20 - route.fuel + loaded.fuel);
		for (const [type, count] of Object.entries(won)) expect(campaign.locker[type]).toBe((locker[type] ?? 0) + count);
		await reload(store, campaign);
	});

	it('skips a reward, and carries the haulers\' cargo home', () => {
		const campaign = newCampaign();
		sharpshooters(campaign);
		const hauler = createEscort({ type: 'fuel_hauler' });
		campaign.convoy.add(hauler);
		const { escorts } = quickLoadOut({ campaign });
		departRun({ campaign, map: MAP, route: testRoute(), escorts });
		toNextFight(campaign);
		const fight = startStopFight({ campaign, cards: CARDS, raiders: pushovers, enemyAI: null });
		fightOut(fight);
		finishStopFight({ campaign, fight });
		expect(onRoad(campaign).cargo.fuel).toBe(1);

		takeReward({ campaign, cardType: null });

		expect(onRoad(campaign).cargoCards).toEqual({});
		expect(onRoad(campaign).phase).toBe('driving');
		expect(() => takeReward({ campaign, cardType: null })).toThrow('The run is driving, with no reward to pick');
	});

	it('refuses a card that isn\'t on offer', () => {
		const campaign = Campaign.fromJSON(CAMPAIGN_FIXTURE);
		const card = ['headshot', 'caltrops', 'ram', 'flank'].find(type => !rewardOffer({ campaign }).includes(type));
		expect(() => takeReward({ campaign, cardType: card as string })).toThrow(`${card} isn't on offer at stop 2`);
	});

	it('resumes a fight left mid-way at the stop before it, and the fight replays from the same stream', async () => {
		const store = newStore();
		let campaign = newCampaign();
		quickLoadOut({ campaign });
		departRun({ campaign, map: MAP, route: testRoute(), escorts: [] });
		toNextFight(campaign);
		await store.checkpoint(campaign);
		const saved = campaign.toSaveText();

		const fight = startStopFight({ campaign, cards: CARDS });
		expect(campaign.toSaveText()).toBe(saved);
		const hands = fight.drivers.map(driver => driver.hand.map(card => card.type));

		// Quit mid-fight, then Continue
		campaign = await reload(store, campaign);
		const replay = startStopFight({ campaign, cards: CARDS });
		expect(replay.battle.seed).toBe(fight.battle.seed);
		expect(replay.drivers.map(driver => driver.hand.map(card => card.type))).toEqual(hands);
	});
});

describe('clearing (DDB-336)', () => {
	/** The run to `route`'s POI driven out to the destination, fights won and rewards skipped, finds left. */
	function driveOut(campaign: Campaign, route: RunRoute): void {
		quickLoadOut({ campaign });
		departRun({ campaign, map: MAP, route: offerFor(campaign, route), escorts: [] });
		driveOn(campaign);
	}

	/** The run on the road driven on to its destination, fights won and rewards skipped, finds left. */
	function driveOn(campaign: Campaign): void {
		while (!atDestination(onRoad(campaign))) {
			const stop = currentStop(onRoad(campaign));
			if (stop?.kind === 'quiet') passQuietStop({ campaign });
			else if (stop?.kind === 'find') leaveFind({ campaign });
			else {
				const fight = startStopFight({ campaign, cards: CARDS, raiders: pushovers, enemyAI: null });
				fightOut(fight);
				finishStopFight({ campaign, fight });
				takeReward({ campaign, cardType: null });
			}
		}
	}

	/** The route as the campaign's offer has it now. */
	function offerFor(campaign: Campaign, route: RunRoute): RunRoute {
		return routesOnOffer({ map: MAP, campaign }).find(offered => offered.id === route.id) as RunRoute;
	}

	/** A compound with fuel and food for many runs, every seat a sharpshooter. */
	function stocked(): Campaign {
		const campaign = newCampaign();
		sharpshooters(campaign);
		campaign.set({ resources: { ...campaign.resources, food: 200, water: 200, fuel: 200 } });
		return campaign;
	}

	const mapStop = (stop: RouteStop): number => stopOf(stop.id) as number;

	it('loads the whole yield on reaching the POI and clears nothing on the road; home, it clears every stop it resolved, on the day, and its POI', () => {
		const campaign = stocked();
		const route = testRoute();
		const poi = poiOf(route.destination.id) as number;
		const before = campaign.map;
		driveOut(campaign, route);

		expect(onRoad(campaign).cargo).toEqual(yieldResources(route.destination.yield));
		expect(campaign.map).toBe(before);
		const day = campaign.day;
		arriveHome({ campaign });
		expect(clearedPois(campaign.map)).toEqual([poi]);
		expect(stopStates(campaign.map)).toEqual(routeStops(route).map(stop => ({ stop: mapStop(stop), roll: 0, cleared: day })).sort((a, b) => a.stop - b.stop));
	});

	it('clears each kind of stop it resolved once home: a find taken or left, a quiet stretch, and a won fight', () => {
		const campaign = stocked();
		quickLoadOut({ campaign });
		const base = testRoute();
		const stops: RouteStop[] = [
			{ id: 'stop-1', kind: 'find', at: 0.1, find: 'supplies', supplies: { resource: 'food', amount: 2 } },
			{ id: 'stop-2', kind: 'find', at: 0.2, find: 'cards' },
			{ id: 'stop-3', kind: 'quiet', at: 0.3 },
			{ id: 'stop-4', kind: 'find', at: 0.4, find: 'driver' },
			{ id: 'stop-5', kind: 'fight', at: 0.5, skulls: 1 },
		];
		const route: RunRoute = { ...base, legs: [{ ...base.legs[0], stops }] };
		campaign.set({ supplyRun: { route, stop: 0, phase: 'driving', escorts: [], cargo: NO_RESOURCES, cargoCards: {}, recruits: [] } });
		const day = campaign.day;

		takeFind({ campaign });
		takeFind({ campaign });
		takeReward({ campaign, cardType: null });
		passQuietStop({ campaign });
		leaveFind({ campaign });
		const fight = startStopFight({ campaign, cards: CARDS, raiders: pushovers, enemyAI: null });
		fightOut(fight);
		finishStopFight({ campaign, fight });
		takeReward({ campaign, cardType: null });
		expect(stopStates(campaign.map)).toEqual([]);
		arriveHome({ campaign });
		expect(stopStates(campaign.map).map(({ stop, cleared }) => [stop, cleared])).toEqual([1, 2, 3, 4, 5].map(stop => [stop, day]));
	});

	it('clears nothing when the run fails, neither the stops it got past nor its POI (call 260)', () => {
		const campaign = stocked();
		quickLoadOut({ campaign });
		const base = testRoute();
		const stops: RouteStop[] = [{ id: 'stop-1', kind: 'quiet', at: 0.2 }, { id: 'stop-2', kind: 'fight', at: 0.4, skulls: 1 }, { id: 'stop-3', kind: 'fight', at: 0.6, skulls: 1 }];
		const route: RunRoute = { ...base, legs: [{ ...base.legs[0], stops }] };
		campaign.set({ supplyRun: { route, stop: 0, phase: 'driving', escorts: [], cargo: NO_RESOURCES, cargoCards: {}, recruits: [] } });
		const before = campaign.map;
		passQuietStop({ campaign });
		const won = startStopFight({ campaign, cards: CARDS, raiders: pushovers, enemyAI: null });
		fightOut(won);
		finishStopFight({ campaign, fight: won });
		takeReward({ campaign, cardType: null });
		const lost = startStopFight({ campaign, cards: CARDS, raiders: snipers, enemyAI: null });
		fightOut(lost, { shoot: false });
		expect(finishStopFight({ campaign, fight: lost }).outcome).toBe('run_failed');
		expect(campaign.map).toBe(before);
	});

	it('offers a failed run\'s route the next day as it was, so a retry meets the same fights', () => {
		const campaign = stocked();
		const route = testRoute();
		const full = offerFor(campaign, route);
		quickLoadOut({ campaign });
		departRun({ campaign, map: MAP, route: full, escorts: [] });
		toNextFight(campaign);
		const fight = startStopFight({ campaign, cards: CARDS, raiders: snipers, enemyAI: null });
		fightOut(fight, { shoot: false });
		expect(finishStopFight({ campaign, fight }).outcome).toBe('run_failed');
		expect(stopStates(campaign.map)).toEqual([]);
		expect(offerFor(campaign, route)).toBe(full);
	});

	it('clears what the run resolved before a save and after it alike, once it\'s home from a load mid-road', async () => {
		const store = newStore();
		let campaign = stocked();
		const route = testRoute();
		quickLoadOut({ campaign });
		departRun({ campaign, map: MAP, route: offerFor(campaign, route), escorts: [] });
		toNextFight(campaign);
		const fight = startStopFight({ campaign, cards: CARDS, raiders: pushovers, enemyAI: null });
		fightOut(fight);
		finishStopFight({ campaign, fight });
		takeReward({ campaign, cardType: null });
		campaign = await reload(store, campaign);
		expect(stopStates(campaign.map)).toEqual([]);
		driveOn(campaign);
		const day = campaign.day;
		arriveHome({ campaign });
		expect(stopStates(campaign.map)).toEqual(routeStops(route).map(stop => ({ stop: mapStop(stop), roll: 0, cleared: day })).sort((a, b) => a.stop - b.stop));
		expect(clearedPois(campaign.map)).toEqual([poiOf(route.destination.id)]);
	});

	it('takes a cleared POI off the offer for good, and leaves every other POI\'s routes as they were', () => {
		const campaign = stocked();
		const route = testRoute();
		campaign.set({ map: clearPoi({ map: campaign.map, poi: poiOf(route.destination.id) as number }) });
		const full = new Map(routesOnOffer({ map: MAP, campaign: newCampaign() }).map(offered => [offered.id, offered]));

		const offered = routesOnOffer({ map: MAP, campaign });
		expect(offered.some(each => each.destination.id === route.destination.id)).toBe(false);
		offered.forEach(each => expect(each).toBe(full.get(each.id)));
		expect(() => departRun({ campaign, map: MAP, route, escorts: [] })).toThrow(`${route.id} isn't a route the area map offers`);
		for (let night = 0; night < 30; night += 1) endDay({ campaign });
		expect(offerFor(campaign, route)).toBeUndefined();
	});

	it('drives past a stop still cleared, and its route\'s risk is the fights it still meets', () => {
		const campaign = stocked();
		const route = testRoute();
		const fights = routeStops(route).filter(stop => stop.kind === 'fight');
		const cleared = fights.map(mapStop).reduce((map, stop) => clearStop({ map, stop, day: campaign.day }), campaign.map);
		campaign.set({ map: cleared });

		const offered = offerFor(campaign, route);
		expect(routeStops(offered)).toEqual(routeStops(route).filter(stop => stop.kind !== 'fight'));
		expect(everyStop(offered).filter(stop => stop.cleared).map(stop => stop.id)).toEqual(fights.map(stop => stop.id));
		expect(offered.risk).toBe(1);

		// Out on the cleared road, the run never meets those fights
		driveOut(campaign, route);
		expect(onRoad(campaign).route).toEqual(offered);
	});

	it('brings the stops back after their cooldown, rerolled, through the day end\'s own hook', () => {
		const campaign = stocked();
		const route = testRoute();
		const stop = mapStop(routeStops(route)[0]);
		campaign.set({ map: clearStop({ map: campaign.map, stop, day: campaign.day }) });
		for (let night = 1; night < STOP_COOLDOWN_DAYS; night += 1) endDay({ campaign });
		expect(routeStops(offerFor(campaign, route))).toHaveLength(routeStops(route).length - 1);
		endDay({ campaign });
		expect(stopState({ map: campaign.map, stop })).toEqual({ stop, roll: 1, cleared: null });
		expect(routeStops(offerFor(campaign, route))).toHaveLength(routeStops(route).length);
	});

	it('rolls a Find: supplies that came back at its new roll', () => {
		const supplies = routeOffers(MAP).flatMap(offered => routeStops(offered)).find(stop => stop.kind === 'find' && stop.find === 'supplies') as RouteStop;
		const id = mapStop(supplies);
		const campaign = stocked();
		campaign.set({ map: { stops: [{ stop: id, roll: 3, cleared: null }] } });
		const back = routesOnOffer({ map: MAP, campaign }).flatMap(offered => routeStops(offered)).find(stop => stop.id === supplies.id);
		expect(back).toEqual(routeStop({ map: MAP, id, roll: 3 }));
		expect(back).toMatchObject({ supplies: rollStop(MAP, id, 3).supplies });
	});

	it('works the offer out once for each map state', () => {
		const campaign = stocked();
		const route = testRoute();
		campaign.set({ map: clearPoi({ map: campaign.map, poi: poiOf(route.destination.id) as number }) });
		const offered = routesOnOffer({ map: MAP, campaign });
		expect(routesOnOffer({ map: MAP, campaign })).toBe(offered);
		campaign.set({ map: clearStop({ map: campaign.map, stop: 0, day: 1 }) });
		expect(routesOnOffer({ map: MAP, campaign })).not.toBe(offered);
	});

	it('clears nothing whose id the map doesn\'t name, as in a run saved before the real map', () => {
		const campaign = Campaign.fromJSON(CAMPAIGN_FIXTURE);
		const before = campaign.map;
		takeReward({ campaign, cardType: null });
		expect(atDestination(onRoad(campaign))).toBe(true);
		arriveHome({ campaign });
		expect(campaign.map).toBe(before);
	});
});

describe('a failed run', () => {
	it('loses the run and its cargo, then the day ends, and the campaign goes on with the drivers at home', async () => {
		const store = newStore();
		let campaign = newCampaign();
		const day = campaign.day;
		const { seats } = quickLoadOut({ campaign });
		departRun({ campaign, map: MAP, route: testRoute(), escorts: [] });
		toNextFight(campaign);
		campaign.set({ supplyRun: { ...onRoad(campaign), cargoCards: { headshot: 1 } } });
		const onRoadRoute = onRoad(campaign).route;
		campaign = await reload(store, campaign);

		const fight = startStopFight({ campaign, cards: CARDS, raiders: snipers, enemyAI: null });
		fightOut(fight, { shoot: false });
		const result = finishStopFight({ campaign, fight });

		if (result.outcome !== 'run_failed') throw new Error('the run should fail');
		expect([...result.fight.dead, ...result.fight.missing].map(driver => driver.id).sort()).toEqual(seats.map(seat => seat.id).sort());
		expect(campaign.supplyRun).toBeNull();
		expect(campaign.runDecks).toEqual([]);
		expect(campaign.isOver).toBe(false);
		expect(result.dayEnd?.day).toBe(day);
		expect(campaign.day).toBe(day + 1);
		expect(campaign.tally.runsFailed).toBe(1);
		// Who was lost, by name, then the cargo, both dated the day it failed
		const fates = [
			...(result.fight.dead.length > 0 ? [`${result.fight.dead.map(driver => driver.name).join(' and ')} died`] : []),
			...(result.fight.missing.length > 0 ? [`${result.fight.missing.map(driver => driver.name).join(' and ')} went missing`] : []),
		].join(' and ');
		const lines = campaign.log.slice(-2).map(entry => [entry.day, entry.message]);
		expect(lines).toEqual([[day, `${fates} when the run to ${onRoadRoute.destination.name} failed.`], [day, 'Cargo lost with the run: Headshot.']]);
		expect(campaign.locker.headshot).toBeUndefined();
		expect(await store.checkpoint(campaign)).toBe('saved');
	});

	it('is what abandoning a fight comes to: the crew flees and goes missing, the cargo is lost, and the day ends', () => {
		const campaign = newCampaign();
		const day = campaign.day;
		const { seats } = quickLoadOut({ campaign });
		const route = testRoute();
		departRun({ campaign, map: MAP, route, escorts: [] });
		toNextFight(campaign);
		const fight = startStopFight({ campaign, cards: CARDS, raiders: pushovers, enemyAI: null });

		fight.battle.forfeit();
		const result = finishStopFight({ campaign, fight });

		if (result.outcome !== 'run_failed') throw new Error('the run should fail');
		expect([result.fight.dead, result.fight.missing]).toEqual([[], [...seats]]);
		expect(seats.map(seat => seat.status)).toEqual(['missing', 'missing']);
		expect(campaign.supplyRun).toBeNull();
		expect(campaign.day).toBe(day + 1);
		expect(campaign.log.map(entry => entry.message)).toContain(`${seats.map(seat => seat.name).join(' and ')} went missing when the run to ${route.destination.name} failed.`);
	});

	it('ends the campaign when it takes the last drivers, without ending the day', async () => {
		const store = newStore();
		const campaign = newCampaign(['road_warrior', 'interceptor']);
		await store.save(campaign);
		const day = campaign.day;
		quickLoadOut({ campaign });
		departRun({ campaign, map: MAP, route: testRoute(), escorts: [] });
		toNextFight(campaign);

		const fight = startStopFight({ campaign, cards: CARDS, raiders: snipers, enemyAI: null });
		fightOut(fight, { shoot: false });
		const result = finishStopFight({ campaign, fight });

		expect(result.outcome).toBe('run_failed');
		expect(result.outcome === 'run_failed' && result.dayEnd).toBeNull();
		expect(campaign.isOver).toBe(true);
		expect(campaign.end?.cause).toBe('last_driver');
		expect(campaign.day).toBe(day);
		expect(await store.checkpoint(campaign)).toBe('ended');
	});
});

describe('finds (DDB-523)', () => {
	const SUPPLIES: FindStop = { id: 'stop-a', kind: 'find', at: 0.2, find: 'supplies', supplies: { resource: 'water', amount: 6 } };
	const CARDS_FOUND: FindStop = { id: 'stop-b', kind: 'find', at: 0.4, find: 'cards' };
	const DRIVER: FindStop = { id: 'stop-c', kind: 'find', at: 0.6, find: 'driver' };

	/** The compound's run on the road, loaded out, its route the test route's first leg holding only `finds` (and any other stops given). */
	function onFinds(campaign: Campaign, finds: readonly RouteStop[]): void {
		quickLoadOut({ campaign });
		const base = testRoute();
		const route: RunRoute = { ...base, legs: [{ ...base.legs[0], stops: finds }] };
		campaign.set({ supplyRun: { route, stop: 0, phase: 'driving', escorts: [], cargo: NO_RESOURCES, cargoCards: {}, recruits: [] } });
	}

	it('names every map find the run resolves, and leaves the other calm types quiet', () => {
		const kinds = new Set(routeOffers(MAP).flatMap(route => routeStops(route).map(stop => (stop.kind === 'find' ? stop.find : stop.kind))));
		expect(kinds).toEqual(new Set(['fight', 'quiet', 'cards', 'supplies', 'driver']));
	});

	it('loads a Find: supplies haul into the cargo when taken, and drives on', async () => {
		const store = newStore();
		let campaign = newCampaign();
		onFinds(campaign, [SUPPLIES, CARDS_FOUND]);
		takeFind({ campaign });
		expect(onRoad(campaign)).toMatchObject({ stop: 1, phase: 'driving', cargo: { ...NO_RESOURCES, water: 6 } });
		campaign = await reload(store, campaign);
		expect(onRoad(campaign).cargo.water).toBe(6);
	});

	it('leaves a find by the road, taking nothing, when the run drives on', () => {
		const campaign = newCampaign();
		onFinds(campaign, [SUPPLIES, DRIVER]);
		leaveFind({ campaign });
		leaveFind({ campaign });
		// Only the POI's yield, loaded at the destination
		expect(onRoad(campaign)).toMatchObject({ stop: 2, phase: 'driving', cargo: yieldResources(onRoad(campaign).route.destination.yield), recruits: [] });
		expect(atDestination(onRoad(campaign))).toBe(true);
	});

	it('opens the reward picker for a Find: cards, the same cards after a load, and drives on once one is picked or they\'re left', async () => {
		const store = newStore();
		let campaign = newCampaign();
		onFinds(campaign, [CARDS_FOUND, CARDS_FOUND]);
		takeFind({ campaign });
		expect(onRoad(campaign)).toMatchObject({ stop: 0, phase: 'reward' });
		const offer = rewardOffer({ campaign });
		expect(offer).toHaveLength(REWARD_CHOICES);
		campaign = await reload(store, campaign);
		expect(rewardOffer({ campaign })).toEqual(offer);
		takeReward({ campaign, cardType: offer[1] });
		expect(onRoad(campaign)).toMatchObject({ stop: 1, phase: 'driving', cargoCards: { [offer[1]]: 1 } });
		takeFind({ campaign });
		takeReward({ campaign, cardType: null });
		expect(onRoad(campaign)).toMatchObject({ stop: 2, cargoCards: { [offer[1]]: 1 } });
	});

	it('turns up someone new when nobody is missing, and they join the pool when the run gets home', async () => {
		const store = newStore();
		let campaign = newCampaign(['road_warrior', 'mechanic']);
		onFinds(campaign, [DRIVER]);
		const found = foundDriver({ campaign });
		expect(found.kind).toBe('recruit');
		// An unlocked archetype the pool doesn't have yet
		const archetype = (found as { archetype: DriverArchetype }).archetype;
		expect(['road_warrior', 'mechanic']).not.toContain(archetype);
		campaign = await reload(store, campaign);
		expect(foundDriver({ campaign })).toEqual(found);
		takeFind({ campaign });
		expect(onRoad(campaign).recruits).toEqual([archetype]);
		campaign = await reload(store, campaign);
		const pool = campaign.drivers.length;

		const arrival = arriveHome({ campaign });
		expect(arrival.recruits.map(driver => driver.archetype)).toEqual([archetype]);
		expect(campaign.drivers).toHaveLength(pool + 1);
		expect(campaign.drivers[pool]).toBe(arrival.recruits[0]);
		expect(campaign.drivers[pool].status).toBe('ready');
		expect(campaign.log.map(entry => entry.message)).toContain(`${arrival.recruits[0].name} joined the compound, found on the road.`);
	});

	it('loses someone new with the run when it fails, so they never join the pool', async () => {
		const store = newStore();
		let campaign = newCampaign();
		const fight: RouteStop = { id: 'stop-d', kind: 'fight', at: 0.8, skulls: 1 };
		onFinds(campaign, [DRIVER, fight]);
		const pool = campaign.drivers.map(driver => driver.id);
		takeFind({ campaign });
		expect(onRoad(campaign).recruits).toHaveLength(1);

		const lost = startStopFight({ campaign, cards: CARDS, raiders: snipers, enemyAI: null });
		fightOut(lost, { shoot: false });
		expect(finishStopFight({ campaign, fight: lost }).outcome).toBe('run_failed');
		campaign = await reload(store, campaign);
		expect(campaign.drivers.map(driver => driver.id)).toEqual(pool);
	});

	it('turns up the first missing driver, who rides home with the run and is back in the pool there', () => {
		const campaign = newCampaign();
		const missing = campaign.drivers[2];
		missing.set({ status: 'missing' });
		onFinds(campaign, [DRIVER, DRIVER]);
		expect(foundDriver({ campaign })).toEqual({ kind: 'missing', driver: missing });
		takeFind({ campaign });
		expect(campaign.foundOnRun).toEqual([missing]);
		// Nobody else is missing, so the next one is someone new
		expect(foundDriver({ campaign }).kind).toBe('recruit');
		leaveFind({ campaign });
		const arrival = arriveHome({ campaign });
		expect(arrival.cargo.found).toEqual([missing]);
		expect(arrival.recruits).toEqual([]);
		expect(missing.status).toBe('ready');
	});

	it('refuses a find step anywhere but at its find', () => {
		const campaign = newCampaign();
		onFinds(campaign, [SUPPLIES]);
		expect(() => passQuietStop({ campaign })).toThrow("The run isn't driving to a quiet stop");
		expect(() => foundDriver({ campaign })).toThrow('The run is driving to a Find: supplies, not a Find: driver');
		takeFind({ campaign });
		expect(() => takeFind({ campaign })).toThrow("The run isn't driving to a find stop");
		expect(() => leaveFind({ campaign })).toThrow("The run isn't driving to a find stop");
	});
});

describe('the saved run', () => {
	/** The fixture, its run on the road, as a save holds it, changed first. */
	const fixtureWith = (change: (run: NonNullable<CampaignJson['supplyRun']>, save: CampaignJson) => void): CampaignJson => {
		const save = JSON.parse(JSON.stringify(CAMPAIGN_FIXTURE)) as CampaignJson;
		change(save.supplyRun as NonNullable<CampaignJson['supplyRun']>, save);
		return save;
	};

	it('loads and writes back the same, at a reward with its escorts and cargo', () => {
		const campaign = Campaign.fromJSON(CAMPAIGN_FIXTURE);
		expect(onRoad(campaign).escorts.map(escort => escort.convoyId)).toEqual(['escort-1', 'escort-3']);
		expect(onRoad(campaign).phase).toBe('reward');
		expect(campaign.toJSON()).toEqual(CAMPAIGN_FIXTURE);
		expect(runParty({ campaign }).seats.map(seat => seat.id)).toEqual(['driver-1', 'driver-5']);
	});

	it.each([
		['a run on the road with no run decks', (_run: NonNullable<CampaignJson['supplyRun']>, save: CampaignJson) => { save.runDecks = []; save.foundOnRun = []; },
			"Campaign.supplyRun is on the road with no run out; the run's end clears it with the run decks"],
		['a reward at a quiet stop', (run: NonNullable<CampaignJson['supplyRun']>) => { run.stop = 1; },
			"Campaign.supplyRun.phase is reward, and stop 1 is neither a fight nor a Find: cards"],
		['a stop past the route', (run: NonNullable<CampaignJson['supplyRun']>) => { run.stop = 4; },
			"Campaign.supplyRun.stop must be an integer from 0 to the route's 3 stops, got 4"],
		['an escort the convoy doesn\'t have', (run: NonNullable<CampaignJson['supplyRun']>) => { run.escorts = ['escort-2']; },
			'Campaign.supplyRun.escorts[0] "escort-2" isn\'t an escort in the convoy'],
		['an escort listed twice', (run: NonNullable<CampaignJson['supplyRun']>) => { run.escorts = ['escort-1', 'escort-1']; },
			'Campaign.supplyRun.escorts[1] Fuel Hauler (escort-1) is listed twice'],
		['cargo the stores can\'t count', (run: NonNullable<CampaignJson['supplyRun']>) => { run.cargo.scrap = -1; },
			'Campaign.supplyRun.cargo.scrap must be an integer >= 0, got -1'],
	])('refuses a save holding %s', (_name, change, message) => {
		expect(() => Campaign.fromJSON(fixtureWith(change), { onWarning: () => undefined })).toThrow(message);
	});

	it('won\'t save a run whose escort has left the convoy', () => {
		const campaign = Campaign.fromJSON(CAMPAIGN_FIXTURE);
		const [hauler] = campaign.convoy.escorts;
		campaign.removeEscortCards({ escorts: [hauler] });
		campaign.convoy.afterFight({ lost: [hauler] });
		expect(() => campaign.toSaveText()).toThrow("Campaign.supplyRun.escorts[0] Fuel Hauler (escort-1) isn't in the convoy any more");
	});

	it('goes with the run decks however the run ends, a load out given up included', () => {
		const campaign = Campaign.fromJSON(CAMPAIGN_FIXTURE);
		campaign.unwindRunDecks();
		expect(campaign.supplyRun).toBeNull();
	});
});
