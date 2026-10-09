import { Rng } from '../core/Rng';
import cardsFile from '../data/cards.json';
import { Card, CardData, CardEffect } from '../mechanics/Card';
import { Deck } from '../mechanics/Deck';
import { Driver, DriverRole } from '../mechanics/Driver';
import { createEscort } from '../mechanics/Escort';
import { RoadLane, RoadRow } from '../mechanics/Road';
import { Team, TeamType } from '../mechanics/Team';
import { Vehicle, createDrivenVehicle } from '../mechanics/Vehicle';
import { Campaign, NO_RESOURCES } from './Campaign';
import { NO_CARDS, addCards, startingDeckCounts } from './CardCounts';
import { CampaignFight, FailedRun, FightWriteBack, LIMP_STRUCTURE, RunParty, WonFight, startCampaignFight, writeBackFight } from './CombatBridge';
import { DriverRecord } from './DriverRecord';
import { foundCampaign } from './Founding';
import { RunDeck } from './RunDeck';

/**
 * DDB-166: a run down to its last driver fights with one seat, the driver
 * and whatever escorts came along, and the bridge writes it back the same
 * way it writes back a pair.
 */

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

/** 20 damage: on the Bike, which has no armor, 10 to structure and 10 to the driver. */
const jab = (): Card => raiderCard('Jab', { type: 'damage', value: 20, target: 'target' });
/** Wrecks the Bike outright, and its driver takes the half that went to structure. */
const wreck = (): Card => raiderCard('Wreck', { type: 'damage', value: 170, target: 'target' });
/** Takes the driver it hits down. */
const snipe = (): Card => raiderCard('Snipe', { type: 'damage', value: 500, target: 'driver' });

/** A raider any hit finishes, playing its first card at its first legal target, which is the Bike: driven vehicles come first. */
function raider(card: () => Card): Vehicle {
	const driver = new Driver({
		archetype: 'raider',
		metadata: { name: 'Scrapper', vehicleName: 'Scrap Buggy', specialty: 'TEST RAIDER', flavorText: 'Built to lose.', unlocked: true },
		skills: { ramming: 0, gunnery: 0, evade: 0, speed: 1 },
		vehicleStats: { maxStructure: 1, weight: 1, armor: 0, speed: 1, gunnery: 0, evade: 0 },
		startingDeck: { cards: [] },
		hitpoints: 1,
		maxHitpoints: 1,
		adrenaline: 1,
		maxAdrenaline: 1,
		handLimit: 7,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: new Deck('scrapper', "Scrapper's deck", Array.from({ length: 10 }, card))
	});
	return createDrivenVehicle({ driver });
}

/** A compound founded with only the Road Warrior and the Interceptor unlocked; the Road Warrior is gone, and the Interceptor is the last driver. */
function lastDriver(): { campaign: Campaign; interceptor: DriverRecord } {
	const campaign = foundCampaign({ seed: SEED, unlockedArchetypes: ['road_warrior', 'interceptor'] });
	const interceptor = campaign.drivers.find(driver => driver.archetype === 'interceptor');
	const warrior = campaign.drivers.find(driver => driver.archetype === 'road_warrior');
	if (!interceptor || !warrior) throw new Error('founding should have dealt one of each');
	warrior.set({ status: 'dead', hitpoints: 0, defaultDeck: NO_CARDS });
	return { campaign, interceptor };
}

/**
 * Load out for one seat, as `startRunDecks` will start it once load out
 * seats a lone driver (DDB-320): the driver's whole default deck goes, and
 * each escort that came along brings its card into it.
 */
function loadOutAlone({ campaign, seat, escorts = [] }: { campaign: Campaign; seat: DriverRecord; escorts?: Vehicle[] }): RunParty {
	const own = seat.defaultDeck;
	seat.set({ defaultDeck: NO_CARDS });
	campaign.set({ runDecks: [new RunDeck({ driver: seat, own })], nextRunNumber: campaign.nextRunNumber + 1 });
	campaign.addEscortCards({ escorts });
	return { seats: [seat], escorts, cargo: NO_RESOURCES, cargoCards: NO_CARDS, run: campaign.currentRun ?? 'none' };
}

/** Escorts of these types, in the campaign's convoy. */
function convoyOf(campaign: Campaign, types: ('outrider' | 'fuel_hauler' | 'med_truck')[]): Vehicle[] {
	return types.map(type => {
		const escort = createEscort({ type });
		campaign.convoy.add(escort);
		return escort;
	});
}

function startFight({ campaign, party, enemy }: { campaign: Campaign; party: RunParty; enemy: Vehicle }): CampaignFight {
	return startCampaignFight({
		campaign,
		party,
		enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [enemy] }),
		rng: new Rng({ seed: SEED }),
		cards: CARDS,
		enemyAI: null
	});
}

/** Plays each player turn with `plays`, from turn 1, then ends it, until the fight is over. */
function fightOut(fight: CampaignFight, plays: (turn: number) => void = () => undefined): void {
	const { battle } = fight;
	for (let turn = 1; turn <= 10 && !battle.isBattleOver(); turn++) {
		plays(turn);
		battle.endPlayerTurn();
	}
	expect(battle.isBattleOver()).toBe(true);
}

/** The lone driver plays the first card of a type in their hand. */
function play({ fight, cardType, target }: { fight: CampaignFight; cardType: string; target: Vehicle }): void {
	const [driver] = fight.drivers;
	const cardIndex = driver.hand.findIndex(card => card.type === cardType);
	expect(cardIndex).toBeGreaterThanOrEqual(0);
	expect(fight.battle.playCard({ driver, cardIndex, targetVehicle: target })).toBe(true);
}

/** Every card a combat driver holds, wherever it is. */
function cardsHeld(driver: Driver): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const card of [...(driver.deck?.cards ?? []), ...driver.hand, ...driver.discard]) counts[card.type] = (counts[card.type] ?? 0) + 1;
	return counts;
}

function won(result: FightWriteBack): WonFight {
	if (result.outcome !== 'won') throw new Error('the run should go on');
	return result;
}

function failed(result: FightWriteBack): FailedRun {
	if (result.outcome !== 'run_failed') throw new Error('the run should have failed');
	return result;
}

describe('the combat bridge with one seat', () => {
	beforeEach(() => {
		// Drivers log every draw
		jest.spyOn(console, 'log').mockImplementation(() => undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('seats the lone driver at the wheel of their own vehicle, with the escorts that came along and their cards', () => {
		const { campaign, interceptor } = lastDriver();
		const [outrider, hauler] = convoyOf(campaign, ['outrider', 'fuel_hauler']);
		const party = loadOutAlone({ campaign, seat: interceptor, escorts: [outrider, hauler] });

		const fight = startFight({ campaign, party, enemy: raider(jab) });
		const [driver] = fight.drivers;
		const [bike] = fight.vehicles;

		expect(fight.drivers.map(seated => seated.metadata.name)).toEqual(['Interceptor 1']);
		expect(fight.vehicles).toHaveLength(1);
		expect(fight.battle.playerTeam.drivenVehicles).toEqual([bike]);
		expect(fight.battle.playerTeam.escorts).toEqual([outrider, hauler]);
		expect([bike.driver, bike.name, bike.slot]).toEqual([driver, 'Lightning Bike', { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.CENTER }]);
		expect(cardsHeld(driver)).toEqual(addCards(addCards(startingDeckCounts('interceptor'), 'run_ahead'), 'top_off'));
		expect(fight.party.seats).toEqual([interceptor]);
	});

	it('holds the lone seat to load out\'s own check', () => {
		const { campaign, interceptor } = lastDriver();
		const party = loadOutAlone({ campaign, seat: interceptor });
		interceptor.set({ status: 'injured', injuredDays: 2, hitpoints: 20 });

		expect(() => startFight({ campaign, party, enemy: raider(jab) }))
			.toThrow(`${interceptor.name} (${interceptor.id}) is injured, so they can't fight`);
	});

	it('writes a won fight back to the lone seat, who carries their HP and damage on into the next fight and home', () => {
		const { campaign, interceptor } = lastDriver();
		interceptor.set({ defaultDeck: { precision_shot: 10 } });
		const party = loadOutAlone({ campaign, seat: interceptor });
		const scrapper = raider(jab);
		const fight = startFight({ campaign, party, enemy: scrapper });

		// The raider jabs the Bike on its turn, and the Interceptor finishes it on the next
		fightOut(fight, turn => {
			if (turn === 2) play({ fight, cardType: 'precision_shot', target: scrapper });
		});
		const result = won(writeBackFight({ fight }));

		expect(result).toEqual({ outcome: 'won', party, revived: [], pickedUp: [], escortsLost: [] });
		expect([interceptor.hitpoints, interceptor.status, interceptor.vehicle]).toEqual([15, 'ready', { structure: 40, armor: 0 }]);

		const nextRaider = raider(jab);
		const next = startFight({ campaign, party: result.party, enemy: nextRaider });
		expect(next.drivers.map(driver => driver.hitpoints)).toEqual([15]);
		expect(next.vehicles.map(vehicle => vehicle.structure)).toEqual([40]);
		fightOut(next, turn => {
			if (turn === 1) play({ fight: next, cardType: 'precision_shot', target: nextRaider });
		});

		campaign.unloadRun({ party: won(writeBackFight({ fight: next })).party });
		expect(campaign.runDecks).toEqual([]);
		expect(interceptor.defaultDeck).toEqual({ precision_shot: 10 });
	});

	it('fails the run when the lone driver goes down, and the driver is dead', () => {
		const { campaign, interceptor } = lastDriver();
		const party = loadOutAlone({ campaign, seat: interceptor });
		const fight = startFight({ campaign, party, enemy: raider(snipe) });

		fightOut(fight);
		const result = failed(writeBackFight({ fight }));

		expect(fight.battle.isBattleWon()).toBe(false);
		expect([result.dead, result.missing]).toEqual([[interceptor], []]);
		expect([interceptor.status, interceptor.hitpoints]).toEqual(['dead', 0]);
		campaign.loseRun({ result });
		expect(campaign.runDecks).toEqual([]);
	});

	it('fails the run when the lone driver\'s vehicle is wrecked with no escort to ride in, and the driver is missing', () => {
		const { campaign, interceptor } = lastDriver();
		interceptor.set({ maxHitpoints: 200, hitpoints: 200 });
		const party = loadOutAlone({ campaign, seat: interceptor });
		const fight = startFight({ campaign, party, enemy: raider(wreck) });

		fightOut(fight);
		const result = failed(writeBackFight({ fight }));

		expect([result.dead, result.missing]).toEqual([[], [interceptor]]);
		expect([interceptor.status, interceptor.hitpoints]).toEqual(['missing', 115]);
	});

	it('lets the lone driver ride on in an escort when their vehicle is wrecked, win with an order, and limp home in the wreck', () => {
		const { campaign, interceptor } = lastDriver();
		interceptor.set({ maxHitpoints: 200, hitpoints: 200, defaultDeck: { covering_fire: 10 } });
		const [outrider] = convoyOf(campaign, ['outrider']);
		const party = loadOutAlone({ campaign, seat: interceptor, escorts: [outrider] });
		const scrapper = raider(wreck);
		const fight = startFight({ campaign, party, enemy: scrapper });
		const [driver] = fight.drivers;

		fightOut(fight, turn => {
			if (turn !== 2) return;
			// No partner's vehicle to jump to, so the Interceptor took the Outrider's seat
			expect(outrider.passenger).toBe(driver);
			expect(fight.battle.isBattleOver()).toBe(false);
			play({ fight, cardType: 'covering_fire', target: scrapper });
		});
		const result = won(writeBackFight({ fight }));

		expect(result).toEqual({ outcome: 'won', party, revived: [], pickedUp: [], escortsLost: [] });
		expect([interceptor.hitpoints, interceptor.vehicle]).toEqual([115, { structure: LIMP_STRUCTURE, armor: 0 }]);
		expect(outrider.passenger).toBeNull();
	});

	it('saves and loads a run out with one seat', () => {
		const { campaign, interceptor } = lastDriver();
		const [hauler] = convoyOf(campaign, ['fuel_hauler']);
		loadOutAlone({ campaign, seat: interceptor, escorts: [hauler] });

		const loaded = Campaign.fromJSON(JSON.parse(campaign.toSaveText()));

		expect(loaded.toJSON()).toEqual(campaign.toJSON());
		expect(loaded.runDecks.map(deck => [deck.driver.id, deck.escortCards])).toEqual([[interceptor.id, [{ cardType: 'top_off', broughtBy: 'escort-1' }]]]);
	});
});
