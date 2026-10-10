import { Rng } from '../core/Rng';
import cardsFile from '../data/cards.json';
import { Card, CardData } from '../mechanics/Card';
import type { DriverArchetype } from '../mechanics/Driver';
import { createEscort } from '../mechanics/Escort';
import { RAIDER_PROFILES } from '../mechanics/Raiders';
import { Campaign, CampaignJson } from './Campaign';
import { CampaignOverError } from './CampaignEnd';
import { CAMPAIGN_START } from './CampaignStart';
import { CampaignStore } from './CampaignStore';
import { ENCOUNTER_IDS, ENCOUNTERS, encounterFor, encounterTeam } from './Encounters';
import { foundCampaign } from './Founding';
import type { DriverRecord } from './DriverRecord';
import { getCrewRule, getSeatBlocker } from './Seating';
import { REWARD_CHOICES, rollRewardCards } from './RunRewards';
import { MemorySaveStorage } from './SaveStorage';
import * as SupplyRoutes from './SupplyRoutes';
import { RunRoute, readRunRoute, routeStops, supplyRoutes } from './SupplyRoutes';
import type { SupplyRun } from './SupplyRunState';
import {
	DepartRuleError, arriveHome, atDestination, currentStop, departRun, finishStopFight, getDepartBlocker, getPlanBlocker, passQuietStop, quickLoadOut,
	cargoText, rewardOffer, routesOnOffer, runParty, startStopFight, takeReward, yieldResources
} from './SupplyRun';
import { fightOut, pushovers, snipers } from './__fixtures__/runFixtures';
import { CAMPAIGN_FIXTURE } from './__fixtures__/storeFixtures';

/** DDB-454: the MVP supply run, from the route pick to home or a failed run. */

const SEED = 20261009;

const CARDS: ReadonlyMap<string, Card> = new Map(
	(cardsFile as unknown as { cards: CardData[] }).cards.map(data => [data.type, new Card(data)])
);

/** A compound founded with only these archetypes unlocked, so its pool is one of each, and fuel to spare. */
function newCampaign(archetypes: DriverArchetype[] = ['road_warrior', 'interceptor', 'mechanic']): Campaign {
	return foundCampaign({ seed: SEED, unlockedArchetypes: archetypes, start: { ...CAMPAIGN_START, resources: { ...CAMPAIGN_START.resources, fuel: 20 } } });
}

/** Today's route with the most stops. */
function longestRoute(campaign: Campaign): RunRoute {
	return [...routesOnOffer({ campaign })].sort((a, b) => routeStops(b).length - routeStops(a).length)[0];
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

describe('the mock routes', () => {
	const DAYS = Array.from({ length: 40 }, (_, index) => index + 1);

	it('offers the same routes for a seed and a day however often it is asked, and others on other days', () => {
		for (const day of DAYS) expect(supplyRoutes({ seed: SEED, day })).toEqual(supplyRoutes({ seed: SEED, day }));
		expect(new Set(DAYS.map(day => JSON.stringify(supplyRoutes({ seed: SEED, day })))).size).toBe(DAYS.length);
	});

	it('pins one day\'s routes, since the draws are the contract', () => {
		const summary = supplyRoutes({ seed: SEED, day: 1 }).map(route => [
			route.destination.name, route.name, route.fuel, route.legs.map(leg => leg.roadClass).join(' '),
			routeStops(route).map(stop => (stop.kind === 'fight' ? stop.skulls : stop.kind)).join(' ')
		]);
		expect(summary).toEqual([
			['Red Mesa Silos', 'Canyon trail', 3, 'highway trail trail', 'quiet 1'],
			['Red Mesa Silos', 'Route 38 highway', 2, 'highway highway', '1'],
			['Halfway Truck Stop', 'Old county road', 4, 'highway backRoad backRoad', 'quiet 3'],
			['Halfway Truck Stop', 'Route 90 highway', 2, 'highway highway', 'quiet 3'],
		]);
	});

	it.each(DAYS)('offers two or three POIs on day %i, each a tier of its own with two routes that split after their first leg', (day) => {
		const routes = supplyRoutes({ seed: SEED, day });
		const destinations = [...new Map(routes.map(route => [route.destination.id, route.destination])).values()];
		expect(destinations.length).toBeGreaterThanOrEqual(2);
		expect(destinations.length).toBeLessThanOrEqual(3);
		expect(destinations.map(destination => destination.tier)).toEqual([...new Set(destinations.map(destination => destination.tier))].sort());
		expect(destinations[0].tier).toBe(1);
		expect(new Set(destinations.map(destination => destination.name)).size).toBe(destinations.length);
		for (const destination of destinations) {
			const [first, second, ...more] = routes.filter(route => route.destination === destination);
			expect(more).toEqual([]);
			expect(second.legs[0]).toBe(first.legs[0]);
			const ownLegs = (route: RunRoute): string[] => route.legs.slice(1).map(leg => leg.id);
			expect(ownLegs(first).some(id => ownLegs(second).includes(id))).toBe(false);
			expect(first.name).not.toBe(second.name);
		}
		const stopIds = routes.flatMap(route => routeStops(route).map(stop => stop.id));
		expect(new Set(stopIds).size).toBe(stopIds.length);
	});

	it.each(DAYS)('keeps each route on day %i to the stop rules: one or two fights, the last at the POI\'s tier and none worse, and a quiet stop in any three', (day) => {
		for (const route of supplyRoutes({ seed: SEED, day })) {
			const stops = routeStops(route);
			const fights = stops.flatMap(stop => (stop.kind === 'fight' ? [stop.skulls] : []));
			expect(route.risk).toBe(route.destination.tier);
			expect(fights[fights.length - 1]).toBe(route.risk);
			expect(Math.max(...fights)).toBe(route.risk);
			expect(fights.length).toBeLessThanOrEqual(route.risk === 1 ? 1 : 2);
			expect(stops.length).toBeLessThanOrEqual(3);
			if (stops.length === 3) expect(stops.some(stop => stop.kind === 'quiet')).toBe(true);
			for (const leg of route.legs) {
				const at = leg.stops.map(stop => stop.at);
				expect(at).toEqual([...at].sort((a, b) => a - b));
				at.forEach(fraction => expect(fraction > 0 && fraction < 1).toBe(true));
			}
			const length = route.legs.reduce((total, leg) => total + leg.length, 0);
			expect(route.fuel).toBe(Math.ceil(length / 150));
			expect(route.hours.out).toBeGreaterThan(route.hours.home);
			expect(readRunRoute(JSON.parse(JSON.stringify(route)), 'route')).toEqual(route);
		}
	});

	it.each(DAYS)('gives each POI on day %i a yield of food, water, fuel, and scrap in its tier\'s ranges, more further out', (day) => {
		const ranges: Record<number, Record<string, [number, number]>> = {
			1: { food: [3, 5], water: [3, 5], fuel: [1, 3], scrap: [5, 15] },
			2: { food: [5, 8], water: [5, 8], fuel: [2, 4], scrap: [10, 25] },
			3: { food: [7, 11], water: [7, 11], fuel: [3, 6], scrap: [20, 40] },
		};
		for (const { destination } of supplyRoutes({ seed: SEED, day })) {
			expect(Object.keys(destination.yield)).toEqual(['food', 'water', 'fuel', 'scrap']);
			for (const [resource, [min, max]] of Object.entries(ranges[destination.tier])) {
				const amount = destination.yield[resource as keyof typeof destination.yield];
				expect(amount).toBeGreaterThanOrEqual(min);
				expect(amount).toBeLessThanOrEqual(max);
			}
		}
	});

	it.each([
		['no legs', (route: Record<string, unknown>) => { route.legs = []; }, 'route.legs is empty; a route has a leg at least'],
		['a stop of no kind it knows', (route: Record<string, unknown>) => { (route.legs as { stops: unknown[] }[])[1].stops = [{ id: 's', kind: 'garage', at: 0.5 }]; },
			'route.legs[1].stops[0].kind must be one of fight, quiet, got "garage"'],
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
		const route = JSON.parse(JSON.stringify(supplyRoutes({ seed: SEED, day: 1 })[0])) as Record<string, unknown>;
		change(route);
		expect(() => readRunRoute(route, 'route')).toThrow(message);
	});
});

describe('the raider encounters', () => {
	it('fields the combat screen\'s own Rust Buggy, one shared profile, refilling to 10 adrenaline a turn', () => {
		const [buggy] = encounterTeam({ encounter: 'scavengers', cards: CARDS }).vehicles;
		expect([buggy.name, buggy.driver?.metadata.name, buggy.driver?.adrenaline, buggy.driver?.maxAdrenaline, buggy.raiderArchetype])
			.toEqual(['Rust Buggy', 'Wasteland Raider', 3, 10, 'looter']);
		expect(RAIDER_PROFILES.rust_buggy.maxAdrenaline).toBe(10);
	});

	it('rolls one encounter for each skull count', () => {
		expect([1, 2, 3].map(skulls => encounterFor(skulls as 1 | 2 | 3))).toEqual(ENCOUNTER_IDS);
	});

	it.each(ENCOUNTER_IDS)('builds %s as a fight the bridge starts', (encounter) => {
		const campaign = newCampaign();
		quickLoadOut({ campaign });
		departRun({ campaign, route: longestRoute(campaign), escorts: [] });
		toNextFight(campaign);
		const team = encounterTeam({ encounter, cards: CARDS });
		expect(team.vehicles).toHaveLength(ENCOUNTERS[encounter].raiders.length);
		const fight = startStopFight({ campaign, cards: CARDS, raiders: () => team });
		expect(fight.battle.enemyTeam).toBe(team);
		expect(fight.battle.turn).toBe(1);
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
		expect(getPlanBlocker({ campaign: newCampaign() })).toBeNull();
	});

	it('says why not: a run out, nobody fit to go, no routes, too little fuel, or a campaign that\'s over', () => {
		const out = newCampaign();
		quickLoadOut({ campaign: out });
		expect(getPlanBlocker({ campaign: out })).toEqual({ reason: 'run_out', run: 'run-1' });

		const hurt = newCampaign();
		hurt.drivers.forEach(driver => driver.set({ status: 'injured', injuredDays: 2, hitpoints: 5 }));
		expect(getPlanBlocker({ campaign: hurt })).toEqual({ reason: 'no_crew' });

		const roadless = newCampaign();
		jest.spyOn(SupplyRoutes, 'supplyRoutes').mockReturnValueOnce([]);
		expect(getPlanBlocker({ campaign: roadless })).toEqual({ reason: 'no_routes' });

		const dry = newCampaign();
		const cheapest = Math.min(...routesOnOffer({ campaign: dry }).map(route => route.fuel));
		dry.set({ resources: { ...dry.resources, fuel: cheapest - 1 } });
		expect(getPlanBlocker({ campaign: dry })).toEqual({ reason: 'too_little_fuel', needed: cheapest, held: cheapest - 1 });

		expect(getPlanBlocker({ campaign: overCampaign() })?.reason).toBe('campaign_over');
	});

	it('stays open with one driver fit to go, or only drivers of one archetype (DDB-432 #35)', () => {
		const lone = newCampaign();
		lone.drivers.slice(1).forEach(driver => driver.set({ status: 'injured', injuredDays: 2, hitpoints: 5 }));
		expect(getPlanBlocker({ campaign: lone })).toBeNull();

		const twins = newCampaign(['road_warrior', 'interceptor']);
		twins.recruitDriver({ archetype: 'road_warrior' });
		twins.drivers.filter(driver => driver.archetype === 'interceptor').forEach(driver => driver.set({ status: 'missing' }));
		expect(getPlanBlocker({ campaign: twins })).toBeNull();
	});
});

describe('the crew rule (DDB-432 #35)', () => {
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
		const route = longestRoute(campaign);
		departRun({ campaign, route, escorts });
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
		expect(() => departRun({ campaign, route: longestRoute(campaign), escorts })).not.toThrow();
	});

});

describe('departing', () => {
	it('pays the fuel and puts the run on the road at its first stop, with the seats and escorts load out sent and nothing in the cargo', () => {
		const campaign = newCampaign();
		const hauler = createEscort({ type: 'fuel_hauler' });
		campaign.convoy.add(hauler);
		const { seats, escorts } = quickLoadOut({ campaign });
		const route = longestRoute(campaign);

		const run = departRun({ campaign, route, escorts });

		expect(campaign.resources.fuel).toBe(20 - route.fuel);
		expect(run).toEqual({ route, stop: 0, phase: 'driving', escorts: [hauler], cargo: { food: 0, water: 0, fuel: 0, meds: 0, scrap: 0, people: 0 }, cargoCards: {} });
		expect(campaign.supplyRun).toBe(run);
		expect(runParty({ campaign })).toEqual({ seats, escorts: [hauler], cargo: run.cargo, cargoCards: {}, run: 'run-1' });
	});

	it('refuses a route that costs more fuel than the stores hold, changing nothing', () => {
		const campaign = newCampaign();
		quickLoadOut({ campaign });
		const route = longestRoute(campaign);
		campaign.set({ resources: { ...campaign.resources, fuel: route.fuel - 1 } });
		const before = campaign.toSaveText();

		expect(getDepartBlocker({ campaign, route })).toEqual({ reason: 'too_little_fuel', needed: route.fuel, held: route.fuel - 1 });
		let error: unknown = null;
		try {
			departRun({ campaign, route, escorts: [] });
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
		const route = longestRoute(campaign);
		departRun({ campaign, route, escorts: [] });

		expect(getDepartBlocker({ campaign, route })).toEqual({ reason: 'run_out', run: 'run-1' });
		expect(() => departRun({ campaign, route, escorts: [] })).toThrow("run-1 is on the road, so no other run sets off until it's home");
	});

	it('pays what today\'s route costs, whatever the route handed in says', () => {
		const campaign = newCampaign();
		const { escorts } = quickLoadOut({ campaign });
		const route = longestRoute(campaign);
		departRun({ campaign, route: { ...route, fuel: 0 }, escorts });
		expect(campaign.resources.fuel).toBe(20 - route.fuel);
		expect(onRoad(campaign).route).toEqual(route);
	});

	it('refuses a run with no run decks started, since load out starts them', () => {
		const campaign = newCampaign();
		expect(() => departRun({ campaign, route: longestRoute(campaign), escorts: [] })).toThrow('Load out starts the run decks before a run sets off');
	});

	it("refuses a route that isn't on offer today", () => {
		const campaign = newCampaign();
		const yesterday = supplyRoutes({ seed: SEED, day: campaign.day })[0];
		campaign.set({ day: campaign.day + 1 });
		quickLoadOut({ campaign });
		expect(() => departRun({ campaign, route: yesterday, escorts: [] })).toThrow(`${yesterday.id} isn't on offer on day 2`);
	});

	it('refuses escorts that aren\'t the ones whose cards load out dealt', () => {
		const campaign = newCampaign();
		const [hauler, outrider] = (['fuel_hauler', 'outrider'] as const).map(type => createEscort({ type }));
		[hauler, outrider].forEach(escort => campaign.convoy.add(escort));
		campaign.startRunDecks({ seats: [campaign.drivers[0], campaign.drivers[1]], escorts: [hauler] });
		const route = longestRoute(campaign);

		expect(() => departRun({ campaign, route, escorts: [] })).toThrow("A run deck holds the card escort-1 brought, and it isn't coming");
		expect(() => departRun({ campaign, route, escorts: [hauler, outrider] })).toThrow('Outrider (escort-2) is coming, and no run deck holds its run_ahead');
		expect(() => departRun({ campaign, route, escorts: [hauler, hauler] })).toThrow('Fuel Hauler (escort-1) is listed twice');
		expect(campaign.supplyRun).toBeNull();
	});

	it('refuses once the campaign is over', () => {
		const over = overCampaign();
		expect(() => departRun({ campaign: over, route: routesOnOffer({ campaign: over })[0], escorts: [] })).toThrow(CampaignOverError);
	});
});

describe('a whole run, scripted through the real APIs and saved after every step', () => {
	it('drives every stop, wins each fight, takes each reward, and comes home with the cargo', async () => {
		const store = newStore();
		let campaign = newCampaign();
		sharpshooters(campaign);
		await store.save(campaign);
		const day = campaign.day;
		const route = longestRoute(campaign);
		const stops = routeStops(route);
		const { seats } = quickLoadOut({ campaign });
		departRun({ campaign, route, escorts: [] });
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
		departRun({ campaign, route: longestRoute(campaign), escorts });
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
		departRun({ campaign, route: longestRoute(campaign), escorts: [] });
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

describe('a failed run', () => {
	it('loses the run and its cargo, then the day ends, and the campaign goes on with the drivers at home', async () => {
		const store = newStore();
		let campaign = newCampaign();
		const day = campaign.day;
		const { seats } = quickLoadOut({ campaign });
		departRun({ campaign, route: longestRoute(campaign), escorts: [] });
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
		const route = longestRoute(campaign);
		departRun({ campaign, route, escorts: [] });
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
		departRun({ campaign, route: longestRoute(campaign), escorts: [] });
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
			"Campaign.supplyRun.phase is reward, and stop 1 isn't a fight"],
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
