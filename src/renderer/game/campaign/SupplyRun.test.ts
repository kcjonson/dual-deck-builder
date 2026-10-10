import { Rng } from '../core/Rng';
import cardsFile from '../data/cards.json';
import { Card, CardData, CardEffect } from '../mechanics/Card';
import { Deck } from '../mechanics/Deck';
import { Driver, DriverArchetype, DriverRole } from '../mechanics/Driver';
import { createEscort } from '../mechanics/Escort';
import { Team, TeamType } from '../mechanics/Team';
import { Vehicle, createDrivenVehicle } from '../mechanics/Vehicle';
import { Campaign, CampaignJson } from './Campaign';
import { CampaignOverError } from './CampaignEnd';
import { CAMPAIGN_START } from './CampaignStart';
import { CampaignStore } from './CampaignStore';
import type { CampaignFight } from './CombatBridge';
import { ENCOUNTER_IDS, ENCOUNTERS, encounterFor, encounterTeam } from './Encounters';
import { foundCampaign } from './Founding';
import { REWARD_CHOICES, rollRewardCards } from './RunRewards';
import { MemorySaveStorage } from './SaveStorage';
import { RunRoute, legOfStop, readRunRoute, routeStops, supplyRoutes } from './SupplyRoutes';
import type { SupplyRun } from './SupplyRunState';
import {
	DepartRuleError, arriveHome, currentStop, departRun, finishStopFight, getDepartBlocker, getPlanBlocker, passQuietStop, quickLoadOut,
	rewardOffer, routesOnOffer, runParty, startStopFight, takeReward
} from './SupplyRun';
import { CAMPAIGN_FIXTURE } from './__fixtures__/storeFixtures';

/** DDB-454: the MVP supply run, from the route pick to home or a failed run. */

const SEED = 20261009;

const CARDS: ReadonlyMap<string, Card> = new Map(
	(cardsFile as unknown as { cards: CardData[] }).cards.map(data => [data.type, new Card(data)])
);

/** A raider's card that always lands where its AI aims it. */
const raiderCard = (name: string, effect: CardEffect): Card => new Card({
	type: name.toLowerCase(),
	name,
	summary: name,
	description: name,
	rarity: 'common',
	cost: 1,
	targetType: 'enemy_single',
	effects: [{ ...effect, always_hits: true }],
	tags: ['attack']
});

/** Takes down the driver it hits. */
const snipe = (): Card => raiderCard('Snipe', { type: 'damage', value: 500, target: 'driver' });

/** A raider any hit finishes, playing its deck's cards at its first legal target. */
function raider(deck: Card[] = []): Vehicle {
	const driver = new Driver({
		archetype: 'raider',
		metadata: { name: 'Scrapper', vehicleName: 'Scrap Buggy', specialty: 'TEST RAIDER', flavorText: 'Built to lose.', unlocked: true },
		skills: { ramming: 0, gunnery: 0, evade: 0, speed: 1 },
		vehicleStats: { maxStructure: 1, weight: 1, armor: 0, speed: 1, gunnery: 0, evade: 0 },
		startingDeck: { cards: [] },
		hitpoints: 1,
		maxHitpoints: 1,
		adrenaline: 3,
		maxAdrenaline: 3,
		handLimit: 7,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: new Deck('scrapper', "Scrapper's deck", deck)
	});
	return createDrivenVehicle({ driver });
}

const pushovers = (): Team => new Team({ type: TeamType.ENEMY, vehicles: [raider()] });
const snipers = (): Team => new Team({ type: TeamType.ENEMY, vehicles: [raider(Array.from({ length: 10 }, snipe))] });

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

/** The fight played to its end: each turn, both seats shoot the first raider still in it unless told to hold fire, until one side is out. */
function fightOut(fight: CampaignFight, { shoot = true }: { shoot?: boolean } = {}): void {
	const { battle } = fight;
	for (let turn = 1; turn <= 10 && !battle.isBattleOver(); turn++) {
		for (const driver of shoot ? fight.drivers : []) {
			const target = battle.enemyTeam.vehicles.find(vehicle => vehicle.isAlive());
			const cardIndex = driver.hand.findIndex(card => card.type === 'precision_shot');
			if (target && cardIndex >= 0 && driver.isAlive() && !battle.isBattleOver()) battle.playCard({ driver, cardIndex, targetVehicle: target });
		}
		if (!battle.isBattleOver()) battle.endPlayerTurn();
	}
	expect(battle.isBattleOver()).toBe(true);
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
			['Red Mesa Silos', 'Route 11 highway', 2, 'highway highway', 'quiet 1'],
			['Red Mesa Silos', 'Dry wash trail', 2, 'highway trail', '1'],
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
			stops.forEach((stop, index) => expect(legOfStop({ route, stop: index })?.stops).toContain(stop));
			expect(readRunRoute(JSON.parse(JSON.stringify(route)), 'route')).toEqual(route);
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

	it('says why not: a run out, no pair to send, too little fuel, or a campaign that\'s over', () => {
		const out = newCampaign();
		quickLoadOut({ campaign: out });
		expect(getPlanBlocker({ campaign: out })).toEqual({ reason: 'run_out', run: 'run-1' });

		const hurt = newCampaign();
		hurt.drivers.slice(1).forEach(driver => driver.set({ status: 'injured', injuredDays: 2, hitpoints: 5 }));
		expect(getPlanBlocker({ campaign: hurt })).toEqual({ reason: 'no_crew' });

		const dry = newCampaign();
		const cheapest = Math.min(...routesOnOffer({ campaign: dry }).map(route => route.fuel));
		dry.set({ resources: { ...dry.resources, fuel: cheapest - 1 } });
		expect(getPlanBlocker({ campaign: dry })).toEqual({ reason: 'too_little_fuel', needed: cheapest, held: cheapest - 1 });

		expect(getPlanBlocker({ campaign: overCampaign() })?.reason).toBe('campaign_over');
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

	it('refuses with no pair to send', () => {
		const campaign = newCampaign(['road_warrior', 'interceptor']);
		campaign.drivers[0].set({ status: 'injured', injuredDays: 1, hitpoints: 10 });
		expect(() => quickLoadOut({ campaign })).toThrow('No two drivers at the compound can go out together');
		expect(campaign.runDecks).toEqual([]);
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
		const won = Object.fromEntries([...new Set(taken)].map(type => [type, taken.filter(card => card === type).length]));
		expect(onRoad(campaign).cargoCards).toEqual(won);
		const locker = campaign.locker;

		const arrival = arriveHome({ campaign });

		expect(arrival.cargo.cards).toEqual(won);
		expect(arrival.seats.map(seat => seat.id)).toEqual(seats.map(seat => seat.id));
		expect(campaign.supplyRun).toBeNull();
		expect(campaign.currentRun).toBeNull();
		expect(arrival.dayEnd.day).toBe(day);
		expect(campaign.day).toBe(day + 1);
		expect(campaign.tally.runsHome).toBe(1);
		expect(campaign.tally.fightsWon).toBe(stops.filter(stop => stop.kind === 'fight').length);
		expect(arrival.seats.map(seat => seat.runsCompleted)).toEqual([1, 1]);
		expect(campaign.resources.fuel).toBe(20 - route.fuel);
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
		expect(campaign.log.some(entry => entry.message === 'Cargo lost with the run: Headshot.')).toBe(true);
		expect(campaign.locker.headshot).toBeUndefined();
		expect(await store.checkpoint(campaign)).toBe('saved');
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
