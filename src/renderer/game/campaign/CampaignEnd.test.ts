import { Rng } from '../core/Rng';
import { resolveMapParams } from '../map/MapParams';
import { DriverArchetype } from '../mechanics/Driver';
import { createEscort } from '../mechanics/Escort';
import type { Team } from '../mechanics/Team';
import type { Vehicle } from '../mechanics/Vehicle';
import { Campaign, CampaignJson, CampaignOptions, NO_RESOURCES, RETURN_STRUCTURE, Resources, isAtCompound } from './Campaign';
import { CampaignOverError, campaignStats, fallOf } from './CampaignEnd';
import { CampaignHistoryEntry } from './CampaignHistory';
import { NO_CARDS, startingDeckCounts, totalCards } from './CardCounts';
import { CampaignFight, FailedRun, RunParty, startCampaignFight, writeBackFight } from './CombatBridge';
import { COMPOUND_RULES, CompoundRules } from './CompoundRules';
import { endDay } from './DayClock';
import { DriverRecord } from './DriverRecord';
import { foundCampaign } from './Founding';
import { injureOnArrival, treatDriver } from './Infirmary';
import { setOpenFight } from './OpenFights';
import { RunDeck } from './RunDeck';
import { MemorySaveStorage } from './SaveStorage';
import { CAMPAIGN_FIXTURE, FaultyStorage, KEYS, failure, saveText, storageWith, storeOver } from './__fixtures__/storeFixtures';

/**
 * DDB-305: death and missing drivers, and the campaign's end. A campaign is
 * lost when a failed run leaves nobody at the compound, or a night leaves no
 * People; it falls as its stores and unrest say, keeps that end through a
 * save, refuses every change after it, and goes into the history once.
 * Fights are scripted in CombatBridge.test.ts; here a failed run is load
 * out's run decks and the records as the bridge leaves them.
 */

const SEED = 20261010;

const STORES: Resources = { food: 20, water: 20, fuel: 6, meds: 3, scrap: 40, people: 8 };

const ARCHETYPES: readonly DriverArchetype[] = ['road_warrior', 'interceptor', 'mechanic', 'raider'];

const newCampaign = (options: Partial<CampaignOptions> = {}): Campaign => new Campaign({
	seed: SEED,
	generatorVersion: 1,
	mapParams: resolveMapParams({ seed: SEED, environment: 'mixed' }).params,
	resources: STORES,
	...options
});

const rulesWith = (fall: Partial<CompoundRules['fall']>): CompoundRules => ({ ...COMPOUND_RULES, fall: { ...COMPOUND_RULES.fall, ...fall } });

/** Load out's run decks for these two, and the party that sets off with them. */
function setOff({ campaign, seats, cargo = NO_RESOURCES }: { campaign: Campaign; seats: [DriverRecord, DriverRecord]; cargo?: Readonly<Resources> }): RunParty {
	campaign.startRunDecks({ seats });
	return { seats, escorts: [], cargo, cargoCards: NO_CARDS, run: campaign.currentRun as string };
}

/** The run failed, as the bridge leaves its seats: the missing ones crashed out alive, the rest dead. */
function failed({ party, missing = [] }: { party: RunParty; missing?: readonly DriverRecord[] }): FailedRun {
	party.seats.forEach(seat => seat.set(missing.includes(seat) ? { status: 'missing' } : { status: 'dead', hitpoints: 0, defaultDeck: {} }));
	return {
		outcome: 'run_failed',
		party: null,
		dead: party.seats.filter(seat => !missing.includes(seat)),
		missing: [...missing],
		escortsLost: [],
		cargoLost: party.cargo,
		cargoCardsLost: party.cargoCards,
		run: party.run
	};
}

interface Fallen {
	campaign: Campaign;
	warrior: DriverRecord;
	interceptor: DriverRecord;
	hauler: Vehicle;
	party: RunParty;
	/** The Road Warrior's run deck, as it stood on the run that lost the campaign */
	runDeck: RunDeck;
}

/** A campaign lost when its only two drivers went out and didn't come back: the Road Warrior dead, the Interceptor missing. */
function fallen(): Fallen {
	const campaign = newCampaign({ locker: { headshot: 2 } });
	const hauler = createEscort({ type: 'fuel_hauler' });
	campaign.convoy.add(hauler);
	const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
	const interceptor = campaign.recruitDriver({ archetype: 'interceptor' });
	const party = setOff({ campaign, seats: [warrior, interceptor] });
	const [runDeck] = campaign.runDecks;
	campaign.loseRun({ result: failed({ party, missing: [interceptor] }) });
	return { campaign, warrior, interceptor, hauler, party, runDeck };
}

/** The fixture as a fresh object to damage. */
const savedCampaign = (): CampaignJson => JSON.parse(JSON.stringify(CAMPAIGN_FIXTURE));

/** The fixture home from its run with nobody left at the compound: Road Warrior 1 dead, Interceptor 2 missing, and Mechanic 1 already lost. */
function fallenFixture(): CampaignJson {
	const save = savedCampaign();
	save.runDecks = [];
	save.drivers[0] = { ...save.drivers[0], status: 'dead', hitpoints: 0 };
	save.drivers[2] = { ...save.drivers[2], status: 'missing', injuredDays: 0 };
	save.drivers[4] = { ...save.drivers[4], status: 'missing', defaultDeck: startingDeckCounts('interceptor') };
	save.end = { ending: 'disbanded', cause: 'last_driver' };
	return save;
}

/** Two ready drivers of different archetypes to send out, or null when there aren't two. */
function pairFrom(rng: Rng, drivers: readonly DriverRecord[]): [DriverRecord, DriverRecord] | null {
	const ready = drivers.filter(driver => driver.status === 'ready');
	if (ready.length < 2) return null;
	const first = rng.pick(ready);
	const partners = ready.filter(driver => driver.archetype !== first.archetype);
	return partners.length === 0 ? null : [first, rng.pick(partners)];
}

describe('how a compound falls', () => {
	it.each([
		['starves with no food, however restless', 0, 40, 'starved'],
		['starves with no food and no unrest', 0, 0, 'starved'],
		['riots at 10 unrest with food left', 1, 10, 'rioted'],
		['disbands just short of rioting', 5, 9, 'disbanded'],
		['disbands, fed and calm', 20, 0, 'disbanded']
	] as const)('%s', (_label, food, unrest, ending) => {
		expect(fallOf({ resources: { ...STORES, food }, unrest })).toBe(ending);
	});

	it('reads its thresholds from the compound rules', () => {
		const rules = rulesWith({ starveAtFood: 3, riotAtUnrest: 4 });

		expect(fallOf({ resources: { ...STORES, food: 3 }, unrest: 4, rules })).toBe('starved');
		expect(fallOf({ resources: { ...STORES, food: 4 }, unrest: 4, rules })).toBe('rioted');
		expect(fallOf({ resources: { ...STORES, food: 4 }, unrest: 3, rules })).toBe('disbanded');
		expect(() => fallOf({ resources: STORES, unrest: 0, rules: rulesWith({ riotAtUnrest: 0 }) }))
			.toThrow('CompoundRules.fall.riotAtUnrest must be an integer from 1 to 1000, got 0');
	});
});

describe('losing the last driver', () => {
	it('ends the campaign when a failed run leaves nobody at the compound: the end, the log, and the tally in one set, on the day it fell', () => {
		const campaign = newCampaign({ locker: { headshot: 2 }, day: 7, unrest: 3 });
		const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
		const interceptor = campaign.recruitDriver({ archetype: 'interceptor' });
		const party = setOff({ campaign, seats: [warrior, interceptor] });
		campaign.moveCards({ cardType: 'headshot', from: 'locker', to: campaign.runDecks[0] });
		const owned = totalCards(campaign.cardsOwned);
		const lostWithTheDead = campaign.runDecks[0];
		const heard = jest.fn();
		campaign.on('change', heard);

		const { lost } = campaign.loseRun({ result: failed({ party, missing: [interceptor] }) });

		expect(heard).toHaveBeenCalledTimes(1);
		expect(campaign.isOver).toBe(true);
		expect(campaign.end).toEqual({ ending: 'disbanded', cause: 'last_driver' });
		expect(campaign.day).toBe(7);
		expect(campaign.log).toEqual([{ day: 7, message: 'No drivers are left, and the compound disbanded.' }]);
		expect(campaign.tally).toEqual({ runsHome: 0, runsFailed: 1, fightsWon: 0 });
		// Death takes the dead driver's run deck, the Headshot they borrowed included; the missing driver's comes home with nobody to hold it
		expect(lost).toEqual([lostWithTheDead]);
		expect(owned - totalCards(campaign.cardsOwned)).toBe(lostWithTheDead.deckSize);
		expect([warrior.defaultDeck, interceptor.defaultDeck]).toEqual([{}, startingDeckCounts('interceptor')]);
		expect(campaign.locker).toEqual({ headshot: 1 });
	});

	it('counts the missing as lost too: a missing driver only comes back on a run, and there\'s nobody left to drive one', () => {
		const campaign = newCampaign();
		const [warrior, interceptor, mechanic, raider] = ARCHETYPES.map(archetype => campaign.recruitDriver({ archetype }));

		campaign.loseRun({ result: failed({ party: setOff({ campaign, seats: [warrior, interceptor] }), missing: [interceptor] }) });
		expect(campaign.isOver).toBe(false);
		campaign.loseRun({ result: failed({ party: setOff({ campaign, seats: [mechanic, raider] }), missing: [mechanic, raider] }) });

		expect(campaign.drivers.map(driver => driver.status)).toEqual(['dead', 'missing', 'missing', 'missing']);
		expect(campaign.end).toEqual({ ending: 'disbanded', cause: 'last_driver' });
		expect(campaign.tally.runsFailed).toBe(2);
	});

	it('goes on while anyone is at the compound, an injured driver included', () => {
		const campaign = newCampaign();
		const [warrior, interceptor, mechanic] = ARCHETYPES.slice(0, 3).map(archetype => campaign.recruitDriver({ archetype }));
		mechanic.set({ status: 'injured', hitpoints: 10, injuredDays: 2 });

		campaign.loseRun({ result: failed({ party: setOff({ campaign, seats: [warrior, interceptor] }) }) });

		expect(campaign.end).toBeNull();
		expect(campaign.log).toEqual([]);
		expect(() => endDay({ campaign })).not.toThrow();
	});

	it.each([
		['starves with no food left', { ...STORES, food: 0 }, 12, COMPOUND_RULES, 'starved'],
		['riots with food left and unrest high', STORES, 12, COMPOUND_RULES, 'rioted'],
		['disbands with food left and unrest low', STORES, 9, COMPOUND_RULES, 'disbanded'],
		['falls by the rules it\'s given', STORES, 2, rulesWith({ riotAtUnrest: 2 }), 'rioted']
	] as const)('%s', (_label, resources, unrest, rules, ending) => {
		const campaign = newCampaign({ resources, unrest });
		const seats = ARCHETYPES.slice(0, 2).map(archetype => campaign.recruitDriver({ archetype })) as [DriverRecord, DriverRecord];

		campaign.loseRun({ result: failed({ party: setOff({ campaign, seats }) }), rules });

		expect(campaign.end).toEqual({ ending, cause: 'last_driver' });
	});
});

describe('People reaching 0', () => {
	it.each([
		['starves when the larder ran dry', { food: 0, water: 0, people: 1 }, 0, 'starved'],
		['riots when thirst pushed unrest to the edge, with food left', { food: 10, water: 0, people: 1 }, 9, 'rioted'],
		['disbands when the last of them walked off fed', { food: 5, water: 5, people: 0 }, 0, 'disbanded']
	] as const)('ends the campaign the night the last People go, in the day end\'s own set: it %s', (_label, stores, unrest, ending) => {
		const campaign = newCampaign({ resources: { ...STORES, ...stores }, unrest, day: 4 });
		campaign.recruitDriver({ archetype: 'road_warrior' });
		const heard = jest.fn();
		campaign.on('change', heard);

		const night = endDay({ campaign });

		expect(heard).toHaveBeenCalledTimes(1);
		expect(night.outcome).toBe('abandoned');
		expect(campaign.end).toEqual({ ending, cause: 'no_people' });
		expect(campaign.day).toBe(4);
		expect(campaign.log[campaign.log.length - 1]).toEqual({ day: 4, message: `No people are left, and the compound ${ending === 'rioted' ? 'rioted over what was left' : ending}.` });
	});

	it('waits for a run that\'s out to come home before it ends the campaign', () => {
		const campaign = newCampaign({ resources: { ...STORES, people: 0 } });
		const seats = ARCHETYPES.slice(0, 2).map(archetype => campaign.recruitDriver({ archetype })) as [DriverRecord, DriverRecord];
		const party = setOff({ campaign, seats });

		// People is 0 at dawn, so the night says the compound is abandoned, and the campaign waits for the run
		expect(endDay({ campaign }).outcome).toBe('abandoned');
		expect([campaign.end, campaign.day]).toEqual([null, 2]);
		campaign.unloadRun({ party });
		expect(campaign.end).toBeNull();
		endDay({ campaign });

		expect(campaign.end).toEqual({ ending: 'disbanded', cause: 'no_people' });
		expect(campaign.day).toBe(2);
		expect(campaign.tally.runsHome).toBe(1);
	});
});

describe('death is permanent', () => {
	it('refuses to bring a dead driver back, and stores the same death again, as a write-back tried twice does', () => {
		const record = new DriverRecord({ id: 'driver-1', archetype: 'mechanic', name: 'Mechanic 1' });
		record.set({ status: 'dead', hitpoints: 0, defaultDeck: {} });

		expect(() => record.set({ status: 'ready', hitpoints: 30 })).toThrow('Mechanic 1 (driver-1) is dead, and death is permanent, so they can\'t be "ready"');
		expect(() => record.set({ status: 'missing', hitpoints: 30 })).toThrow('death is permanent');
		expect(() => record.set({ status: 'dead', hitpoints: 0, defaultDeck: {} })).not.toThrow();
		expect([record.status, record.hitpoints]).toEqual(['dead', 0]);
	});
});

describe('a missing driver coming back', () => {
	/** The Road Warrior dead and the Interceptor missing at 13 of 25 HP, their vehicle as the crash left it, with the Mechanic and the Raider at home. */
	function lostOne(): { campaign: Campaign; warrior: DriverRecord; interceptor: DriverRecord; mechanic: DriverRecord; raider: DriverRecord } {
		const campaign = newCampaign({ locker: { headshot: 1 } });
		const [warrior, interceptor, mechanic, raider] = ARCHETYPES.map(archetype => campaign.recruitDriver({ archetype }));
		const party = setOff({ campaign, seats: [warrior, interceptor] });
		interceptor.set({ hitpoints: 13, vehicle: { structure: 20, armor: 2 } });
		campaign.loseRun({ result: failed({ party, missing: [interceptor] }) });
		return { campaign, warrior, interceptor, mechanic, raider };
	}

	it('comes back injured for the HP they\'re missing, with their deck as they left it and their vehicle at 1 structure', () => {
		const { campaign, interceptor } = lostOne();
		const heard = jest.fn();
		campaign.on('change', heard);
		expect(campaign.getCardMoveBlocker({ cardType: 'headshot', from: 'locker', to: interceptor })).toEqual({ reason: 'driver_away', place: interceptor });

		campaign.returnMissingDriver({ driver: interceptor });

		// 12 HP down at 10 HP a day
		expect([interceptor.status, interceptor.injuredDays, interceptor.hitpoints]).toEqual(['injured', 2, 13]);
		expect(interceptor.vehicle).toEqual({ structure: RETURN_STRUCTURE, armor: 2 });
		expect(interceptor.defaultDeck).toEqual(startingDeckCounts('interceptor'));
		expect(heard).toHaveBeenCalledTimes(1);
		expect(campaign.getCardMoveBlocker({ cardType: 'headshot', from: 'locker', to: interceptor })).toBeNull();
		endDay({ campaign });
		endDay({ campaign });
		expect([interceptor.status, interceptor.hitpoints]).toEqual(['ready', 25]);
	});

	it('comes back ready at full HP when they weren\'t hurt, on a run that\'s out, as a Find: driver stop on the road finds them', () => {
		const { campaign, interceptor, mechanic, raider } = lostOne();
		interceptor.set({ hitpoints: 25 });
		setOff({ campaign, seats: [mechanic, raider] });

		campaign.returnMissingDriver({ driver: interceptor });

		expect([interceptor.status, interceptor.injuredDays, interceptor.vehicle.structure]).toEqual(['ready', 0, 1]);
	});

	it('refuses anyone who isn\'t missing, the dead most of all, and anyone outside the pool, changing nothing', () => {
		const { campaign, warrior, mechanic } = lostOne();
		const stranger = new DriverRecord({ id: 'driver-9', archetype: 'mechanic', name: 'Mechanic 9', status: 'missing' });
		const before = JSON.stringify(campaign);

		expect(() => campaign.returnMissingDriver({ driver: warrior })).toThrow('Road Warrior 1 (driver-1) is dead, not missing, so they can\'t come back');
		expect(() => campaign.returnMissingDriver({ driver: mechanic })).toThrow('Mechanic 1 (driver-3) is ready, not missing, so they can\'t come back');
		expect(() => campaign.returnMissingDriver({ driver: stranger })).toThrow('Mechanic 9 (driver-9) isn\'t in this campaign\'s pool');
		expect(JSON.stringify(campaign)).toBe(before);
	});

	it('refuses a driver whose failed run hasn\'t been settled, with their run deck still out', () => {
		const { campaign, mechanic, raider } = lostOne();
		setOff({ campaign, seats: [mechanic, raider] });
		// As the bridge leaves a seat who crashed out of a lost fight, before the run is lost
		raider.set({ status: 'missing' });

		expect(() => campaign.returnMissingDriver({ driver: raider }))
			.toThrow("Raider 1 (driver-4)'s run deck is still out; the failed run is settled (loseRun) before they can be found");
		expect(raider.status).toBe('missing');
	});

	it('can\'t save a campaign already lost, since nobody was left to find them', () => {
		const { campaign, interceptor } = fallen();

		expect(interceptor.status).toBe('missing');
		expect(() => campaign.returnMissingDriver({ driver: interceptor }))
			.toThrow("Can't bring a missing driver back: the campaign is over, since the compound disbanded");
		expect(interceptor.status).toBe('missing');
	});
});

describe('a campaign that\'s over', () => {
	it.each([
		['change the campaign', ({ campaign }: Fallen) => campaign.set({ day: 9 })],
		['recruit a driver', ({ campaign }: Fallen) => campaign.recruitDriver({ archetype: 'mechanic' })],
		['move cards', ({ campaign, interceptor }: Fallen) => campaign.moveCards({ cardType: 'headshot', from: 'locker', to: interceptor })],
		['scrap cards', ({ campaign }: Fallen) => campaign.scrapCards({ cardType: 'headshot' })],
		['add cards to the locker', ({ campaign }: Fallen) => campaign.addToLocker({ cardType: 'headshot' })],
		['add to the log', ({ campaign }: Fallen) => campaign.addLogEntry({ message: 'Anyone?' })],
		['start run decks', ({ campaign, warrior, interceptor }: Fallen) => campaign.startRunDecks({ seats: [warrior, interceptor] })],
		['reset a run deck', ({ campaign, runDeck }: Fallen) => campaign.resetRunDeck({ runDeck })],
		['move an escort card', ({ campaign }: Fallen) => campaign.moveEscortCard({ broughtBy: 'escort-1', to: 'locker' })],
		['add escort cards', ({ campaign, hauler }: Fallen) => campaign.addEscortCards({ escorts: [hauler] })],
		['remove escort cards', ({ campaign, hauler }: Fallen) => campaign.removeEscortCards({ escorts: [hauler] })],
		['unwind run decks', ({ campaign }: Fallen) => campaign.unwindRunDecks()],
		['unload a run', ({ campaign, party }: Fallen) => campaign.unloadRun({ party })],
		['lose a run', ({ campaign, party }: Fallen) => campaign.loseRun({
			result: { outcome: 'run_failed', party: null, dead: [party.seats[0]], missing: [party.seats[1]], escortsLost: [], cargoLost: NO_RESOURCES, cargoCardsLost: NO_CARDS, run: party.run }
		})],
		['bring a missing driver back', ({ campaign, interceptor }: Fallen) => campaign.returnMissingDriver({ driver: interceptor })],
		['end the day', ({ campaign }: Fallen) => endDay({ campaign })],
		['injure drivers coming home', ({ campaign }: Fallen) => injureOnArrival({ campaign, drivers: [] })],
		['treat a driver', ({ campaign, interceptor }: Fallen) => treatDriver({ campaign, driver: interceptor })],
		['start a fight', ({ campaign, party }: Fallen) => startCampaignFight({ campaign, party, enemyTeam: {} as Team, rng: new Rng({ seed: 1 }), cards: new Map() })],
		['write a fight back', ({ campaign, party }: Fallen) => {
			const battle = { isBattleOver: () => true, isBattleTied: () => false, isBattleWon: () => true, afterFight: { escorts: [], lost: [], dividends: [] } };
			const fight = { campaign, battle, drivers: [], vehicles: [], scrap: 0, fuel: 0, party } as unknown as CampaignFight;
			setOpenFight({ campaign, fight });
			return writeBackFight({ fight });
		}]
	])('refuses to %s, changing nothing', (action, change) => {
		const lost = fallen();
		const before = JSON.stringify(lost.campaign);
		let refusal: unknown = null;

		try {
			change(lost);
		} catch (error) {
			refusal = error;
		}

		expect(refusal).toBeInstanceOf(CampaignOverError);
		expect((refusal as CampaignOverError).message).toBe(`Can't ${action}: the campaign is over, since the compound disbanded`);
		expect((refusal as CampaignOverError).end).toEqual({ ending: 'disbanded', cause: 'last_driver' });
		expect(JSON.stringify(lost.campaign)).toBe(before);
	});

	it('keeps its end through a save and a load, and the campaign it loads refuses every change too', () => {
		const { campaign } = fallen();

		const loaded = Campaign.fromJSON(JSON.parse(campaign.toSaveText()));

		expect(loaded.toJSON()).toEqual(campaign.toJSON());
		expect([loaded.isOver, loaded.end]).toEqual([true, { ending: 'disbanded', cause: 'last_driver' }]);
		expect(Object.isFrozen(loaded.end)).toBe(true);
		expect(() => loaded.addLogEntry({ message: 'Anyone?' })).toThrow(CampaignOverError);
		expect(() => endDay({ campaign: loaded })).toThrow(CampaignOverError);
	});

	it('loads the fixture lost, home from its run with nobody left', () => {
		const campaign = Campaign.fromJSON(fallenFixture());

		expect(campaign.end).toEqual({ ending: 'disbanded', cause: 'last_driver' });
		expect(campaign.drivers.some(isAtCompound)).toBe(false);
	});

	it.each([
		['an end with a run still out', (save: CampaignJson) => { save.runDecks = savedCampaign().runDecks; save.drivers[0].status = 'ready'; save.drivers[0].hitpoints = 40; save.drivers[4].status = 'ready'; save.drivers[4].defaultDeck = {}; },
			"Campaign.end can't be set with a run out; the run ends first"],
		['People lost with People left', (save: CampaignJson) => { save.end = { ending: 'disbanded', cause: 'no_people' }; },
			'Campaign.end.cause is no_people, and the compound has 18 People'],
		['the last driver lost with a driver at the compound', (save: CampaignJson) => { save.drivers[2] = { ...save.drivers[2], status: 'ready' }; },
			'Campaign.end.cause is last_driver, and Mechanic 1 (driver-3) is ready'],
		['the last driver lost from a pool that never had one', (save: CampaignJson) => { save.drivers = []; save.nextDriverNumber = 1; },
			'Campaign.end.cause is last_driver, and the pool has never had a driver'],
		['a fall that doesn\'t exist', (save: CampaignJson) => { (save.end as unknown as Record<string, unknown>).ending = 'abandoned'; },
			'Campaign.end.ending must be one of starved, rioted, disbanded, got "abandoned"'],
		['a cause that doesn\'t exist', (save: CampaignJson) => { (save.end as unknown as Record<string, unknown>).cause = 'boredom'; },
			'Campaign.end.cause must be one of last_driver, no_people, got "boredom"'],
		['an end with more to it', (save: CampaignJson) => { (save.end as unknown as Record<string, unknown>).day = 9; },
			'Campaign.end has an unknown field "day"'],
		['no end at all', (save: CampaignJson) => { delete (save as Partial<CampaignJson>).end; }, 'Campaign.end is missing'],
		['a tally counting more runs than set off', (save: CampaignJson) => { save.tally.runsHome = 3; },
			'Campaign.tally counts 4 runs home or failed, and only 3 could have ended, with 3 run ids handed out'],
		['a tally that isn\'t whole numbers', (save: CampaignJson) => { save.tally.fightsWon = -1; },
			'Campaign.tally.fightsWon must be an integer >= 0, got -1']
	])('won\'t load %s', (_label, damage, message) => {
		const save = fallenFixture();
		damage(save);

		expect(() => Campaign.fromJSON(save)).toThrow(message);
	});

	it('can\'t be ended by hand with a run out', () => {
		const campaign = Campaign.fromJSON(CAMPAIGN_FIXTURE);
		const before = JSON.stringify(campaign);

		expect(() => campaign.set({ end: { ending: 'starved', cause: 'last_driver' } })).toThrow("Campaign.end can't be set with a run out; the run ends first");
		expect(JSON.stringify(campaign)).toBe(before);
	});
});

describe('the tally', () => {
	it('counts runs home and failed as they end, and never goes back', () => {
		const campaign = newCampaign();
		const [warrior, interceptor, mechanic, raider] = ARCHETYPES.map(archetype => campaign.recruitDriver({ archetype }));

		campaign.unloadRun({ party: setOff({ campaign, seats: [warrior, interceptor] }) });
		expect(campaign.tally).toEqual({ runsHome: 1, runsFailed: 0, fightsWon: 0 });
		// A load out given up uses a run id and ends no run
		setOff({ campaign, seats: [mechanic, raider] });
		campaign.unwindRunDecks();
		campaign.loseRun({ result: failed({ party: setOff({ campaign, seats: [warrior, interceptor] }), missing: [interceptor] }) });

		expect(campaign.tally).toEqual({ runsHome: 1, runsFailed: 1, fightsWon: 0 });
		expect(campaign.nextRunNumber).toBe(4);
		expect(() => campaign.set({ tally: { runsHome: 0, runsFailed: 1, fightsWon: 0 } })).toThrow("Campaign.tally.runsHome can't go back, from 1 to 0");
	});
});

describe('the defeat screen\'s numbers', () => {
	it('come from the campaign: days held, runs and fights by outcome, drivers lost, and strongholds taken', () => {
		const campaign = newCampaign({ unrest: 11 });
		const [warrior, interceptor, mechanic, raider] = ARCHETYPES.map(archetype => campaign.recruitDriver({ archetype }));
		campaign.unloadRun({ party: setOff({ campaign, seats: [warrior, interceptor] }) });
		campaign.set({ day: 6, strongholdsTaken: ['stronghold-2'], tally: { ...campaign.tally, fightsWon: 4 } });
		campaign.loseRun({ result: failed({ party: setOff({ campaign, seats: [warrior, interceptor] }), missing: [interceptor] }) });
		expect(campaignStats({ campaign })).toMatchObject({ daysHeld: 6, driversDead: 1, driversMissing: 1 });
		campaign.set({ day: 9 });
		campaign.loseRun({ result: failed({ party: setOff({ campaign, seats: [mechanic, raider] }) }) });

		expect(campaign.end).toEqual({ ending: 'rioted', cause: 'last_driver' });
		expect(campaignStats({ campaign })).toEqual({
			daysHeld: 9,
			runs: 3,
			runsHome: 1,
			runsFailed: 2,
			fightsWon: 4,
			fightsLost: 2,
			driversDead: 3,
			driversMissing: 1,
			strongholdsTaken: 1
		});
		expect(Object.isFrozen(campaignStats({ campaign }))).toBe(true);
	});
});

describe('the history', () => {
	/** A campaign one hungry night from the end, saved as founding saves it, over this storage. */
	async function lastNight(storage: MemorySaveStorage) {
		const store = storeOver(storage);
		const campaign = newCampaign({ resources: { ...STORES, food: 0, water: 0, people: 1 }, day: 5, strongholdsTaken: ['stronghold-1'] });
		campaign.recruitDriver({ archetype: 'road_warrior' });
		await store.save(campaign);
		return { store, campaign };
	}

	it('gets the lost campaign\'s line once, from the checkpoint after the step that lost it, which removes the save', async () => {
		const storage = new MemorySaveStorage();
		const { store, campaign } = await lastNight(storage);

		endDay({ campaign });
		expect(await store.checkpoint(campaign)).toBe(true);

		const line: CampaignHistoryEntry = { seed: SEED, day: 5, strongholdsTaken: 1, ending: 'starved' };
		expect(await store.history()).toEqual([line]);
		expect(await store.saveStatus()).toBe('none');
		expect(storage.keys).toEqual([KEYS.history]);
		// Every later checkpoint, end, or save of it records nothing more
		expect(await store.checkpoint(campaign)).toBe(false);
		expect((await failure(store.end({ campaign }))).reason).toBe('retired');
		expect((await failure(store.save(campaign))).reason).toBe('retired');
		expect(await store.history()).toEqual([line]);
	});

	it('puts a lost campaign in with its own fall, even ended as abandoned from the menu, and an end of one the store never saw leaves the save alone', async () => {
		const storage = new MemorySaveStorage();
		const { store } = await lastNight(storage);
		const { campaign } = fallen();

		expect(await store.end({ campaign, ending: 'abandoned' })).toEqual({ seed: SEED, day: 1, strongholdsTaken: 0, ending: 'disbanded' });
		expect(await store.saveStatus()).toBe('saved');
		expect(await store.checkpoint(campaign)).toBe(false);
		expect(await store.history()).toHaveLength(1);
	});

	it('finishes the end at the next checkpoint when removing the save failed, without a second line', async () => {
		const storage = new FaultyStorage();
		const { store, campaign } = await lastNight(storage);
		const failures = jest.fn();
		store.onSaveFailed(failures);
		endDay({ campaign });
		storage.fault = { method: 'removeItem', key: KEYS.slots.a, times: 1 };

		expect(await store.checkpoint(campaign)).toBe(false);
		expect(failures.mock.calls.map(([error]) => error.reason)).toEqual(['storage']);
		expect(await store.checkpoint(campaign)).toBe(true);

		expect(await store.history()).toHaveLength(1);
		expect(storage.keys).toEqual([KEYS.history]);
	});

	it('records the fall once after a crash between its line and the save\'s removal, when the night is played again', async () => {
		const storage = new FaultyStorage();
		const { store: crashed, campaign } = await lastNight(storage);
		endDay({ campaign });
		storage.fault = { method: 'removeItem', key: KEYS.slots.a };
		expect(await crashed.checkpoint(campaign)).toBe(false);
		storage.fault = null;

		// A new session finds the save from before the night, and the night goes the same way
		const store = storeOver(storage);
		const again = await store.load() as Campaign;
		expect(again.isOver).toBe(false);
		endDay({ campaign: again });
		expect(await store.checkpoint(again)).toBe(true);

		expect((await store.history()).map(entry => entry.ending)).toEqual(['starved']);
		expect(await store.saveStatus()).toBe('none');
	});

	it.each(['checkpoint', 'save'] as const)('ends a save that holds a campaign already over, as a hand-made save could, at its next %s', async (call) => {
		const storage = storageWith(saveText({ campaign: JSON.stringify(fallenFixture()) }));
		const store = storeOver(storage);

		const loaded = await store.load() as Campaign;
		expect(loaded.isOver).toBe(true);
		await (call === 'checkpoint' ? store.checkpoint(loaded) : store.save(loaded));

		expect(await store.history()).toEqual([{ seed: CAMPAIGN_FIXTURE.seed, day: CAMPAIGN_FIXTURE.day, strongholdsTaken: 1, ending: 'disbanded' }]);
		expect(await store.saveStatus()).toBe('none');
	});
});

describe('a seeded walk to the fall', () => {
	/**
	 * A founded campaign played from its seed until it's lost: each day a run
	 * when two ready drivers of different archetypes can go, or a rest, each
	 * run home with what it hauled (and now and then a missing driver found)
	 * or failed, its seats dead or missing, then the night, and the step's
	 * checkpoint. How often runs fail and how much they haul is drawn per
	 * seed, so some compounds run out of drivers and some starve.
	 */
	async function walk(seed: number) {
		const rng = new Rng({ seed }).fork('walk');
		const campaign = foundCampaign({ seed, unlockedArchetypes: ARCHETYPES });
		const storage = new MemorySaveStorage();
		const store = storeOver(storage);
		await store.save(campaign);
		const failChance = rng.int(5, 60);
		const haul = rng.int(1, 9);
		const everDead = new Set<DriverRecord>();
		let runs = 0;
		let found = 0;
		for (let step = 0; step < 400 && !campaign.isOver; step += 1) {
			const pair = pairFrom(rng, campaign.drivers);
			if (pair !== null && rng.int(0, 3) > 0) {
				const party = setOff({ campaign, seats: pair });
				runs += 1;
				if (rng.int(0, 99) < failChance) {
					campaign.loseRun({ result: failed({ party, missing: pair.filter(() => rng.int(0, 1) === 0) }) });
				} else {
					const missing = campaign.drivers.filter(driver => driver.status === 'missing');
					if (missing.length > 0 && rng.int(0, 2) === 0) {
						campaign.returnMissingDriver({ driver: rng.pick(missing) });
						found += 1;
					}
					pair.forEach(seat => { if (rng.int(0, 2) === 0) seat.set({ hitpoints: rng.int(1, seat.maxHitpoints) }); });
					campaign.unloadRun({ party: { ...party, cargo: { ...NO_RESOURCES, food: rng.int(0, haul), water: rng.int(0, haul) } } });
					injureOnArrival({ campaign, drivers: pair });
				}
			}
			if (!campaign.isOver) endDay({ campaign });

			// Lost exactly when nobody is left at the compound or no People are, and only then
			const nobodyHere = !campaign.drivers.some(isAtCompound);
			expect(campaign.isOver).toBe(nobodyHere || campaign.resources.people === 0);
			campaign.drivers.forEach(driver => {
				if (everDead.has(driver)) expect(driver.status).toBe('dead');
				if (driver.status === 'dead') everDead.add(driver);
			});
			expect(await store.checkpoint(campaign)).toBe(true);
		}
		return { campaign, store, storage, runs, found };
	}

	it('ends campaigns both ways across seeds, each the way its state says, saved, closed, and in the history once', async () => {
		const causes = new Set<string>();
		const endings = new Set<string>();
		let found = 0;
		for (let seed = 1; seed <= 12; seed += 1) {
			const walked = await walk(seed);
			const { campaign, store, storage } = walked;
			const end = campaign.end;
			if (end === null) throw new Error(`seed ${seed}: the walk should end in a fall`);
			causes.add(end.cause);
			endings.add(end.ending);
			found += walked.found;

			expect(end.cause).toBe(campaign.drivers.some(isAtCompound) ? 'no_people' : 'last_driver');
			expect(end.ending).toBe(fallOf({ resources: campaign.resources, unrest: campaign.unrest }));
			expect(campaign.log[campaign.log.length - 1]).toEqual({ day: campaign.day, message: expect.stringMatching(/^No (drivers|people) are left, and the compound /) });
			expect(campaignStats({ campaign })).toMatchObject({ daysHeld: campaign.day, runs: walked.runs, fightsLost: campaign.tally.runsFailed });
			const loaded = Campaign.fromJSON(JSON.parse(campaign.toSaveText()));
			expect(loaded.toJSON()).toEqual(campaign.toJSON());
			expect(() => loaded.recruitDriver({ archetype: 'mechanic' })).toThrow(CampaignOverError);
			expect(await store.history()).toEqual([{ seed, day: campaign.day, strongholdsTaken: 0, ending: end.ending }]);
			expect(storage.keys).toEqual([KEYS.history]);
			expect(await store.checkpoint(campaign)).toBe(false);
			expect(await store.history()).toHaveLength(1);
		}

		expect([...causes].sort()).toEqual(['last_driver', 'no_people']);
		expect(endings.size).toBeGreaterThan(1);
		expect(found).toBeGreaterThan(0);
	});
});
