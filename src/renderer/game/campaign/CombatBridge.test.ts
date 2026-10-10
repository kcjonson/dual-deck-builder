import { Rng } from '../core/Rng';
import cardsFile from '../data/cards.json';
import { Card, CardData, CardEffect } from '../mechanics/Card';
import { Deck } from '../mechanics/Deck';
import { DRIVER_CONFIGS, Driver, DriverArchetype, DriverRole } from '../mechanics/Driver';
import { EscortProfile, createEscort } from '../mechanics/Escort';
import type { RaiderArchetype } from '../mechanics/RaiderArchetype';
import { RoadLane, RoadRow } from '../mechanics/Road';
import { Team, TeamType } from '../mechanics/Team';
import { Vehicle, createDrivenVehicle } from '../mechanics/Vehicle';
import { Campaign, NO_RESOURCES, Resources } from './Campaign';
import { CampaignStore } from './CampaignStore';
import { CardCounts, NO_CARDS, addCards, startingDeckCounts, totalCards } from './CardCounts';
import { addCardsWon, getDebrief } from './CardsWon';
import { CampaignFight, FailedRun, FightWriteBack, LIMP_STRUCTURE, REVIVE_HP, RunParty, WonFight, startCampaignFight, writeBackFight } from './CombatBridge';
import { endDay } from './DayClock';
import { DriverRecord } from './DriverRecord';
import { foundCampaign } from './Founding';
import { injureOnArrival, treatDriver } from './Infirmary';
import { RunDeck } from './RunDeck';
import { MemorySaveStorage } from './SaveStorage';
import { getSeatBlocker } from './Seating';

/**
 * DDB-286 and DDB-158: fights built from the campaign's records and
 * convoy, played to the end on a seeded stream, and written back.
 */

const SEED = 20261008;

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

/** 20 damage: through a Rig's 10 armor, 5 to structure and 5 to the driver. */
const jab = (): Card => raiderCard('Jab', { type: 'damage', value: 20, target: 'target' });
/** Wrecks a Rig or a Bike outright, and whoever's aboard takes the half that went to structure. */
const wreck = (): Card => raiderCard('Wreck', { type: 'damage', value: 170, target: 'target' });
/** Takes the driver it hits down, or the passenger riding in an escort. */
const snipe = (): Card => raiderCard('Snipe', { type: 'damage', value: 500, target: 'driver' });

const cardsOf = (count: number, card: () => Card): Card[] => Array.from({ length: count }, card);

/**
 * A raider any hit finishes, playing `adrenaline` cards a turn. With no AI,
 * it plays its first card at its first legal target: the Rig, unless its
 * archetype prefers another. Every deck here holds one kind of card, so no
 * fight depends on the order a deck deals in.
 */
function raider({ deck, adrenaline, archetype = null }: { deck: Card[]; adrenaline: number; archetype?: RaiderArchetype | null }): Vehicle {
	const driver = new Driver({
		archetype: 'raider',
		metadata: { name: 'Scrapper', vehicleName: 'Scrap Buggy', specialty: 'TEST RAIDER', flavorText: 'Built to lose.', unlocked: true },
		skills: { ramming: 0, gunnery: 0, evade: 0, speed: 1 },
		vehicleStats: { maxStructure: 1, weight: 1, armor: 0, speed: 1, gunnery: 0, evade: 0 },
		startingDeck: { cards: [] },
		hitpoints: 1,
		maxHitpoints: 1,
		adrenaline,
		maxAdrenaline: adrenaline,
		handLimit: 7,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: new Deck('scrapper', "Scrapper's deck", deck)
	});
	const buggy = createDrivenVehicle({ driver });
	buggy.raiderArchetype = archetype;
	return buggy;
}

/** A compound founded with only the Road Warrior and the Interceptor unlocked, so its pool is one of each. */
function newCampaign(): { campaign: Campaign; warrior: DriverRecord; interceptor: DriverRecord } {
	const campaign = foundCampaign({ seed: SEED, unlockedArchetypes: ['road_warrior', 'interceptor'] });
	const recordOf = (archetype: DriverArchetype): DriverRecord => {
		const record = campaign.drivers.find(driver => driver.archetype === archetype);
		if (!record) throw new Error(`founding should have dealt a ${archetype}`);
		return record;
	};
	return { campaign, warrior: recordOf('road_warrior'), interceptor: recordOf('interceptor') };
}

/** How a record is named in the bridge's errors. */
const named = (record: DriverRecord): string => `${record.name} (${record.id})`;

/** The ids escorts have in the convoy, which a save names them by. */
const idsOf = (escorts: readonly Vehicle[]): (string | null)[] => escorts.map(escort => escort.convoyId);

/** A run party: these drivers and escorts, carrying `cargo` and no cards won, nothing when left out, on a campaign's first run unless it says otherwise. */
const partyOf = (seats: DriverRecord[], escorts: Vehicle[] = [], cargo: Readonly<Resources> = NO_RESOURCES, run = 'run-1'): RunParty =>
	({ seats, escorts, cargo, cargoCards: NO_CARDS, run });

/** Load out: run decks for these drivers, with these escorts' cards, and the party that sets off with them on the run they start. */
function loadOut({ campaign, seats, escorts = [], cargo }: { campaign: Campaign; seats: DriverRecord[]; escorts?: Vehicle[]; cargo?: Readonly<Resources> }): RunParty {
	campaign.startRunDecks({ seats, escorts });
	return partyOf(seats, escorts, cargo, campaign.currentRun ?? 'none');
}

/** A seat's run deck, which every fight on a run deals from. */
function runDeckOf(campaign: Campaign, record: DriverRecord): RunDeck {
	const deck = campaign.runDeckOf(record);
	if (deck === null) throw new Error(`${record.name} should have a run deck`);
	return deck;
}

/** Drivers tough enough to walk away from two wrecks. */
const toughen = (...records: DriverRecord[]): void => records.forEach(record => record.set({ maxHitpoints: 200, hitpoints: 200 }));

/** Precision Shots finish any raider here, so a deck of them wins the fight on the turn they're played. */
const shooter = (record: DriverRecord): void => record.set({ defaultDeck: { precision_shot: 10 } });

/**
 * A hauler paying the spec's Salvage Rig dividend of +15 scrap, under its
 * name. The type isn't built, so it stands in as a Fuel Hauler: the convoy
 * only takes hired types.
 */
function salvageRig(): Vehicle {
	const rig = createEscort({ type: 'fuel_hauler' });
	rig.set({
		name: 'Salvage Rig',
		escort: { ...(rig.escort as EscortProfile), signatureCard: null, dividend: { kind: 'scrap', amount: 15 } }
	});
	return rig;
}

function startFight({ campaign, party, enemy, seed = SEED }: { campaign: Campaign; party: RunParty; enemy: Vehicle | Vehicle[]; seed?: number }): CampaignFight {
	return startCampaignFight({
		campaign,
		party,
		enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: Array.isArray(enemy) ? enemy : [enemy] }),
		rng: new Rng({ seed }),
		cards: CARDS,
		enemyAI: null
	});
}

/** A raider with nothing to play, for a fight that only has to start. */
const idle = (): Vehicle => raider({ deck: [], adrenaline: 1 });

/** Plays each player turn with `plays`, from turn 1, then ends it, until the fight is over. */
function fightOut(fight: CampaignFight, plays: (turn: number) => void = () => undefined): void {
	const { battle } = fight;
	for (let turn = 1; turn <= 10 && !battle.isBattleOver(); turn++) {
		plays(turn);
		battle.endPlayerTurn();
	}
	expect(battle.isBattleOver()).toBe(true);
}

/** A seat's driver plays the first card of a type in their hand. */
function play({ fight, seat, cardType, target }: { fight: CampaignFight; seat: 0 | 1; cardType: string; target?: Vehicle }): void {
	const driver = fight.drivers[seat];
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

describe('the combat bridge', () => {
	beforeEach(() => {
		// Drivers log every draw
		jest.spyOn(console, 'log').mockImplementation(() => undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('a fight built from the run party', () => {
		it('seats each record as a combat driver, with their name, HP, hand limit, and run deck, at the wheel of their vehicle as damaged as it was', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			warrior.set({ hitpoints: 31, handLimit: 3, vehicle: { structure: 52, armor: 3 } });
			const [warriorDeck, interceptorDeck] = [warrior.defaultDeck, interceptor.defaultDeck];

			const fight = startFight({ campaign, party: loadOut({ campaign, seats: [warrior, interceptor] }), enemy: idle() });
			const [rigDriver, bikeDriver] = fight.drivers;
			const [rig, bike] = fight.vehicles;

			expect(fight.drivers.map(driver => driver.metadata.name)).toEqual(['Road Warrior 1', 'Interceptor 1']);
			expect([rigDriver.hitpoints, rigDriver.maxHitpoints]).toEqual([31, 40]);
			expect([bikeDriver.hitpoints, bikeDriver.maxHitpoints]).toEqual([25, 25]);
			expect(fight.battle.playerTeam.drivenVehicles).toEqual([rig, bike]);
			expect([rig.driver, bike.driver]).toEqual(fight.drivers);
			expect([rig.name, rig.structure, rig.maxStructure, rig.armor, rig.maxArmor]).toEqual(['Apocalypse Rig', 52, 80, 3, 10]);
			expect([bike.name, bike.structure, bike.armor]).toEqual(['Lightning Bike', 50, 0]);

			// The record's hand limit: the opening five fill three and burn two
			expect(rigDriver.handLimit).toBe(3);
			expect(rigDriver.hand).toHaveLength(3);
			expect(rigDriver.discard).toHaveLength(2);
			expect(bikeDriver.handLimit).toBe(7);
			expect(bikeDriver.hand).toHaveLength(5);

			// Nobody customized, so each run deck is the whole default deck
			expect(cardsHeld(rigDriver)).toEqual(warriorDeck);
			expect(cardsHeld(bikeDriver)).toEqual(interceptorDeck);
			expect(rigDriver.startingDeck.cards).toEqual(Object.entries(warriorDeck).map(([type, quantity]) => ({ type, quantity })));
		});

		it('fights on the stream it is given, with the run\'s cargo on the top bar rather than the stores', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			const cargo = { ...NO_RESOURCES, scrap: 12, fuel: 3 };

			const fight = startFight({ campaign, party: loadOut({ campaign, seats: [warrior, interceptor], cargo }), enemy: idle(), seed: 7 });

			expect(fight.battle.seed).toBe(new Rng({ seed: 7 }).seed);
			expect(fight.battle.turn).toBe(1);
			expect([fight.scrap, fight.fuel]).toEqual([12, 3]);
			expect(fight.campaign).toBe(campaign);
		});

		it('fields the escorts that came along in roster order, and none left at home', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			const [outrider, pilotCar, hauler] = (['outrider', 'pilot_car', 'fuel_hauler'] as const).map(type => createEscort({ type }));
			[outrider, pilotCar, hauler].forEach(escort => campaign.convoy.add(escort));

			const fight = startFight({ campaign, party: loadOut({ campaign, seats: [warrior, interceptor], escorts: [hauler, outrider] }), enemy: idle() });

			expect(fight.battle.playerTeam.escorts).toEqual([outrider, hauler]);
			expect(fight.party.escorts).toEqual([outrider, hauler]);
			expect(pilotCar.slot).toBeNull();
		});

		it('deals each seat their run deck: what they took, what they borrowed, and the escort cards they hold, each carrying its escort (DDB-315)', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			campaign.set({ locker: { medical_kit: 2 } });
			const [outrider, hauler] = (['outrider', 'fuel_hauler'] as const).map(type => createEscort({ type }));
			[outrider, hauler].forEach(escort => campaign.convoy.add(escort));
			const party = loadOut({ campaign, seats: [warrior, interceptor], escorts: [outrider, hauler] });
			// The Road Warrior leaves both Nitro Boosts home and borrows a Medical Kit, and gives the Interceptor the Outrider's Run Ahead
			campaign.moveCards({ cardType: 'nitro_boost', from: runDeckOf(campaign, warrior), to: 'locker', count: 2 });
			campaign.moveCards({ cardType: 'medical_kit', from: 'locker', to: runDeckOf(campaign, warrior) });
			campaign.moveEscortCard({ broughtBy: 'escort-1', to: runDeckOf(campaign, interceptor) });
			const before = campaign.toSaveText();

			const fight = startFight({ campaign, party, enemy: idle() });
			const [rigDriver, bikeDriver] = fight.drivers;
			const brought = (driver: Driver): (string | null | undefined)[][] =>
				[...(driver.deck?.cards ?? []), ...driver.hand, ...driver.discard].filter(card => card.broughtBy).map(card => [card.type, card.broughtBy]);

			expect(cardsHeld(rigDriver)).toEqual({ armor_plating: 3, medical_kit: 1, ramming_speed: 5, repair_kit: 2, top_off: 1 });
			expect(cardsHeld(bikeDriver)).toEqual(addCards(startingDeckCounts('interceptor'), 'run_ahead'));
			expect(brought(rigDriver)).toEqual([['top_off', 'escort-2']]);
			expect(brought(bikeDriver)).toEqual([['run_ahead', 'escort-1']]);
			expect(rigDriver.startingDeck.cards).toEqual([
				{ type: 'armor_plating', quantity: 3 },
				{ type: 'medical_kit', quantity: 1 },
				{ type: 'ramming_speed', quantity: 5 },
				{ type: 'repair_kit', quantity: 2 },
				{ type: 'top_off', quantity: 1 }
			]);
			// Dealing a fight deals copies, and moves nothing in the campaign
			expect(campaign.toSaveText()).toBe(before);
		});

		describe('refuses', () => {
			it('a party without two drivers', () => {
				const { campaign, warrior } = newCampaign();

				expect(() => startFight({ campaign, party: partyOf([warrior]), enemy: idle() }))
					.toThrow('A fight seats two drivers, and this party has 1');
			});

			it('two drivers of one archetype, naming them', () => {
				const { campaign, warrior } = newCampaign();
				const second = campaign.recruitDriver({ archetype: 'road_warrior' });

				expect(() => startFight({ campaign, party: partyOf([warrior, second]), enemy: idle() }))
					.toThrow(`${named(warrior)} and ${named(second)} are both road_warrior; a fight seats two different archetypes`);
			});

			it('a driver from outside the pool', () => {
				const { campaign, warrior } = newCampaign();
				const stranger = new DriverRecord({ id: 'driver-9', archetype: 'mechanic', name: 'Mechanic 1' });

				expect(() => startFight({ campaign, party: partyOf([warrior, stranger]), enemy: idle() }))
					.toThrow("Mechanic 1 (driver-9) isn't in this campaign's pool");
			});

			it.each([
				['dead', { status: 'dead', hitpoints: 0, defaultDeck: {} }],
				['missing', { status: 'missing' }],
				['injured', { status: 'injured', injuredDays: 2 }]
			] as const)('a driver who is %s', (status, changes) => {
				const { campaign, warrior, interceptor } = newCampaign();
				interceptor.set(changes);

				expect(() => startFight({ campaign, party: partyOf([warrior, interceptor]), enemy: idle() }))
					.toThrow(`${named(interceptor)} is ${status}, so they can't fight`);
			});

			it('a seat\'s own reason before the pairing\'s: an injured driver of the other seat\'s archetype is injured', () => {
				const { campaign, warrior } = newCampaign();
				const second = campaign.recruitDriver({ archetype: 'road_warrior' });
				second.set({ status: 'injured', injuredDays: 2, hitpoints: 20 });

				expect(() => startFight({ campaign, party: partyOf([warrior, second]), enemy: idle() }))
					.toThrow(`${named(second)} is injured, so they can't fight`);
			});

			it('the seats in order: an injured driver in the first before a stranger in the second', () => {
				const { campaign, warrior } = newCampaign();
				warrior.set({ status: 'injured', injuredDays: 1, hitpoints: 30 });
				const stranger = new DriverRecord({ id: 'driver-9', archetype: 'mechanic', name: 'Mechanic 1' });

				expect(() => startFight({ campaign, party: partyOf([warrior, stranger]), enemy: idle() }))
					.toThrow(`${named(warrior)} is injured, so they can't fight`);
			});

			it('one driver in both seats', () => {
				const { campaign, warrior } = newCampaign();

				expect(() => startFight({ campaign, party: partyOf([warrior, warrior]), enemy: idle() }))
					.toThrow(`${named(warrior)} is in both seats; a fight seats two different drivers`);
			});

			it('cargo that isn\'t whole numbers from 0', () => {
				const { campaign, warrior, interceptor } = newCampaign();

				expect(() => startFight({ campaign, party: partyOf([warrior, interceptor], [], { ...NO_RESOURCES, fuel: -1 }), enemy: idle() }))
					.toThrow('RunParty.cargo.fuel must be an integer >= 0, got -1');
			});

			it('an escort that isn\'t the campaign\'s', () => {
				const { campaign, warrior, interceptor } = newCampaign();

				expect(() => startFight({ campaign, party: partyOf([warrior, interceptor], [createEscort({ type: 'pilot_car' })]), enemy: idle() }))
					.toThrow("Pilot Car isn't in the campaign's convoy");
			});

			it('a seat with no run deck, since every fight on a run deals from one', () => {
				const { campaign, warrior, interceptor } = newCampaign();

				expect(() => startFight({ campaign, party: partyOf([warrior, interceptor]), enemy: idle() }))
					.toThrow(`${named(warrior)} has no run deck; load out starts them (Campaign.startRunDecks)`);
			});

			it('a run deck holding the card of an escort that stayed home', () => {
				const { campaign, warrior, interceptor } = newCampaign();
				const hauler = createEscort({ type: 'fuel_hauler' });
				campaign.convoy.add(hauler);
				loadOut({ campaign, seats: [warrior, interceptor], escorts: [hauler] });

				expect(() => startFight({ campaign, party: partyOf([warrior, interceptor]), enemy: idle() }))
					.toThrow(`${named(warrior)}'s run deck holds the top_off escort-1 brought, and that escort isn't in the party`);
			});

			it('an escort in the party whose card neither run deck holds, since its order couldn\'t be dealt', () => {
				const { campaign, warrior, interceptor } = newCampaign();
				const hauler = createEscort({ type: 'fuel_hauler' });
				campaign.convoy.add(hauler);
				loadOut({ campaign, seats: [warrior, interceptor] });

				expect(() => startFight({ campaign, party: partyOf([warrior, interceptor], [hauler]), enemy: idle() }))
					.toThrow('Fuel Hauler (escort-1) came along, and neither run deck holds the top_off it brings');
				campaign.addEscortCards({ escorts: [hauler] });
				expect(() => startFight({ campaign, party: partyOf([warrior, interceptor], [hauler]), enemy: idle() })).not.toThrow();
			});

			it('a fight while the campaign\'s last one hasn\'t been written back, ended or not', () => {
				const { campaign, warrior, interceptor } = newCampaign();
				shooter(interceptor);
				const scrapper = raider({ deck: [], adrenaline: 1 });
				const fight = startFight({ campaign, party: loadOut({ campaign, seats: [warrior, interceptor] }), enemy: scrapper });

				expect(() => startFight({ campaign, party: partyOf([warrior, interceptor]), enemy: idle() }))
					.toThrow("This campaign's last fight hasn't been written back");
				fightOut(fight, () => play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper }));
				expect(() => startFight({ campaign, party: partyOf([warrior, interceptor]), enemy: idle() }))
					.toThrow("This campaign's last fight hasn't been written back");

				writeBackFight({ fight });
				expect(() => startFight({ campaign, party: partyOf([warrior, interceptor]), enemy: idle() })).not.toThrow();
			});

			it('a deck holding a card that doesn\'t exist', () => {
				const { campaign, warrior, interceptor } = newCampaign();
				interceptor.set({ defaultDeck: { headshot: 2, lucky_charm: 1 } });

				expect(() => startFight({ campaign, party: loadOut({ campaign, seats: [warrior, interceptor] }), enemy: idle() }))
					.toThrow(`${named(interceptor)}'s run deck holds lucky_charm, which isn't a card`);
			});

			it('an encounter the road won\'t take, moving nobody, so the escorts are free for the next fight', () => {
				const { campaign, warrior, interceptor } = newCampaign();
				const hauler = createEscort({ type: 'fuel_hauler' });
				campaign.convoy.add(hauler);
				const ambusher = idle();
				ambusher.slot = { lane: RoadLane.PLAYER_SHOULDER, row: RoadRow.AHEAD };
				const party = loadOut({ campaign, seats: [warrior, interceptor], escorts: [hauler] });

				expect(() => startFight({ campaign, party, enemy: ambusher })).toThrow("can't ambush in the ahead row");

				expect(hauler.slot).toBeNull();
				expect(startFight({ campaign, party, enemy: idle() }).battle.playerTeam.escorts).toEqual([hauler]);
			});
		});
	});

	describe('a won fight, written back', () => {
		it('carries each driver\'s HP and their vehicle\'s damage into the record and on into the next fight', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			warrior.set({ hitpoints: 31 });
			shooter(interceptor);
			const party = loadOut({ campaign, seats: [warrior, interceptor] });
			const scrapper = raider({ deck: cardsOf(10, jab), adrenaline: 1 });
			const fight = startFight({ campaign, party, enemy: scrapper });
			const heard = jest.fn();
			campaign.on('change', heard);

			// The raider jabs the Rig on its turn, and the Interceptor finishes it on the next
			fightOut(fight, turn => {
				if (turn === 2) play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper });
			});
			const result = writeBackFight({ fight });

			expect(result).toEqual({ outcome: 'won', party, revived: [], pickedUp: [], escortsLost: [] });
			// No escort's card left a run deck, so the campaign itself changed only to count the fight won
			expect(heard).toHaveBeenCalledTimes(1);
			expect(campaign.tally).toEqual({ runsHome: 0, runsFailed: 0, fightsWon: 1 });
			expect([warrior.hitpoints, warrior.status, warrior.vehicle]).toEqual([26, 'ready', { structure: 75, armor: 0 }]);
			expect([interceptor.hitpoints, interceptor.vehicle]).toEqual([25, { structure: 50, armor: 0 }]);

			const next = startFight({ campaign, party: won(result).party, enemy: idle(), seed: SEED + 1 });
			const [rig] = next.vehicles;
			expect(next.drivers.map(driver => driver.hitpoints)).toEqual([26, 25]);
			expect([rig.structure, rig.armor]).toEqual([75, 0]);
		});

		it('picks up a driver who crashed out, so both drivers are in the next fight, their wrecks limping on (DDB-158)', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			toughen(warrior, interceptor);
			interceptor.set({ defaultDeck: { covering_fire: 10 } });
			const outrider = createEscort({ type: 'outrider' });
			campaign.convoy.add(outrider);
			const party = loadOut({ campaign, seats: [warrior, interceptor], escorts: [outrider] });
			const scrapper = raider({ deck: cardsOf(10, wreck), adrenaline: 2 });
			const fight = startFight({ campaign, party, enemy: scrapper });
			const [rigDriver, bikeDriver] = fight.drivers;

			fightOut(fight, turn => {
				if (turn !== 2) return;
				// The raider wrecked the Rig, then the Bike its driver had jumped into. The
				// Interceptor took the Outrider's seat, and the Road Warrior had nowhere left.
				expect(outrider.passenger).toBe(bikeDriver);
				expect(rigDriver.isAlive()).toBe(true);
				expect(fight.battle.playerTeam.isAboard(rigDriver)).toBe(false);
				// The Interceptor wins it from the passenger seat, with an order the Outrider carries out
				play({ fight, seat: 1, cardType: 'covering_fire', target: scrapper });
			});
			expect(fight.battle.isBattleWon()).toBe(true);
			const result = writeBackFight({ fight });

			expect(result).toEqual({ outcome: 'won', party, revived: [], pickedUp: [warrior], escortsLost: [] });
			// 80 from the Rig's wreck and 85 from the Bike's, which the Interceptor took too
			expect([warrior.hitpoints, warrior.status]).toEqual([35, 'ready']);
			expect(interceptor.hitpoints).toBe(115);
			expect([warrior.vehicle, interceptor.vehicle]).toEqual([{ structure: LIMP_STRUCTURE, armor: 0 }, { structure: LIMP_STRUCTURE, armor: 0 }]);
			expect(campaign.convoy.escorts).toEqual([outrider]);
			expect(outrider.passenger).toBeNull();

			const next = startFight({ campaign, party: won(result).party, enemy: idle(), seed: SEED + 1 });
			expect(next.drivers.map(driver => driver.metadata.name)).toEqual(['Road Warrior 1', 'Interceptor 1']);
			expect(next.battle.playerTeam.drivenVehicles.map(vehicle => vehicle.driver)).toEqual(next.drivers);
			expect(next.drivers.map(driver => driver.hitpoints)).toEqual([35, 115]);
			expect(next.vehicles.map(vehicle => [vehicle.structure, vehicle.armor])).toEqual([[LIMP_STRUCTURE, 0], [LIMP_STRUCTURE, 0]]);
			expect(next.battle.playerTeam.escorts).toEqual([outrider]);
		});

		it('revives a driver who went down, past the Med Truck\'s heal, and gives them back the vehicle that carried on without them', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			shooter(interceptor);
			interceptor.set({ hitpoints: 20 });
			const truck = createEscort({ type: 'med_truck' });
			campaign.convoy.add(truck);
			const party = loadOut({ campaign, seats: [warrior, interceptor], escorts: [truck] });
			const scrapper = raider({ deck: cardsOf(10, snipe), adrenaline: 1 });
			const fight = startFight({ campaign, party, enemy: scrapper });
			const [rig] = fight.vehicles;

			fightOut(fight, turn => {
				if (turn !== 2) return;
				// The snipe took the Road Warrior down, and the Rig carried on as an escort
				expect(fight.drivers[0].hitpoints).toBe(0);
				expect(rig.isEscort).toBe(true);
				play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper });
			});
			const result = writeBackFight({ fight });

			expect(result).toEqual({ outcome: 'won', party, revived: [warrior], pickedUp: [], escortsLost: [] });
			expect([warrior.status, warrior.hitpoints, warrior.vehicle]).toEqual(['ready', REVIVE_HP, { structure: 80, armor: 10 }]);
			expect(runDeckOf(campaign, warrior).own).toEqual(startingDeckCounts('road_warrior'));
			// The heal only reached the driver still standing
			expect(interceptor.hitpoints).toBe(23);
			expect(campaign.convoy.escorts).toEqual([truck]);

			const next = startFight({ campaign, party: won(result).party, enemy: idle(), seed: SEED + 1 });
			const [nextRig] = next.vehicles;
			expect(next.drivers[0].hitpoints).toBe(REVIVE_HP);
			expect([nextRig.isEscort, nextRig.driver]).toEqual([false, next.drivers[0]]);
			expect(next.battle.playerTeam.escorts).toEqual([truck]);
		});

		it('loads the haulers\' fuel and scrap into the cargo, not the stores, and heals the records up to their max HP', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			warrior.set({ hitpoints: 30 });
			interceptor.set({ hitpoints: 24 });
			shooter(interceptor);
			const escorts = [createEscort({ type: 'fuel_hauler' }), salvageRig(), createEscort({ type: 'med_truck' })];
			escorts.forEach(escort => campaign.convoy.add(escort));
			const stores = campaign.resources;
			const scrapper = raider({ deck: [], adrenaline: 1 });
			const fight = startFight({ campaign, party: loadOut({ campaign, seats: [warrior, interceptor], escorts, cargo: { ...NO_RESOURCES, fuel: 2 } }), enemy: scrapper });

			fightOut(fight, () => play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper }));
			const result = won(writeBackFight({ fight }));

			expect(result.party.cargo).toEqual({ ...NO_RESOURCES, fuel: 3, scrap: 15 });
			expect(campaign.resources).toBe(stores);
			// 3 each, up to their max HP
			expect([warrior.hitpoints, interceptor.hitpoints]).toEqual([33, 25]);
			expect(campaign.convoy.escorts).toEqual(escorts);
			// The top bar shows what the run carries from the next fight on
			const next = startFight({ campaign, party: result.party, enemy: idle(), seed: SEED + 1 });
			expect([next.fuel, next.scrap]).toEqual([3, 15]);
		});

		it('loses a wrecked escort, and the one that took damage carries its structure on with its armor back', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			shooter(interceptor);
			const hauler = createEscort({ type: 'fuel_hauler' });
			// Hurt in an earlier fight: one more jab wrecks it
			hauler.set({ structure: 10 });
			const truck = createEscort({ type: 'med_truck' });
			[hauler, truck].forEach(escort => campaign.convoy.add(escort));
			// A looter goes for the haulers: the Fuel Hauler first, then the Med Truck once it's gone
			const scrapper = raider({ deck: cardsOf(10, jab), adrenaline: 1, archetype: 'looter' });
			const fight = startFight({ campaign, party: loadOut({ campaign, seats: [warrior, interceptor], escorts: [hauler, truck] }), enemy: scrapper });

			fightOut(fight, turn => {
				if (turn === 3) play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper });
			});
			const result = won(writeBackFight({ fight }));

			expect(result.escortsLost).toEqual([hauler]);
			expect(result.party.escorts).toEqual([truck]);
			expect(campaign.convoy.escorts).toEqual([truck]);
			// The hauler's Top Off left the run deck with it, and the truck's Triage stays
			expect(runDeckOf(campaign, warrior).escortCards).toEqual([{ cardType: 'triage', broughtBy: 'escort-2' }]);
			// 20 past its 4 armor is 16 off its 35 structure
			expect([truck.structure, truck.armor]).toEqual([19, 4]);
			// A wrecked hauler pays nothing
			expect(result.party.cargo).toEqual(NO_RESOURCES);

			const next = startFight({ campaign, party: result.party, enemy: idle(), seed: SEED + 1 });
			expect(next.battle.playerTeam.escorts).toEqual([truck]);
			expect(truck.structure).toBe(19);
		});
	});

	describe('coming home hurt (DDB-304)', () => {
		it('injures each driver by the HP written back, keeps the hurt one out of the next fight until fit, and sends them out at full HP', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			shooter(interceptor);
			interceptor.set({ hitpoints: 20 });
			const truck = createEscort({ type: 'med_truck' });
			campaign.convoy.add(truck);
			const scrapper = raider({ deck: cardsOf(10, snipe), adrenaline: 1 });
			const fight = startFight({ campaign, party: loadOut({ campaign, seats: [warrior, interceptor], escorts: [truck] }), enemy: scrapper });
			fightOut(fight, turn => {
				if (turn === 2) play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper });
			});
			const { party } = won(writeBackFight({ fight }));

			// Revived at REVIVE_HP, and 23 of 25 after the Med Truck's heal
			const injuries = injureOnArrival({ campaign, drivers: party.seats });
			expect(injuries.map(({ driver, missingHitpoints, injuredDays }) => [driver, missingHitpoints, injuredDays])).toEqual([[warrior, 39, 4], [interceptor, 2, 1]]);
			campaign.unloadRun({ party });
			endDay({ campaign });
			expect([interceptor.status, interceptor.hitpoints]).toEqual(['ready', 25]);
			expect([warrior.status, warrior.injuredDays, warrior.hitpoints]).toEqual(['injured', 3, REVIVE_HP]);

			expect(getSeatBlocker({ campaign, driver: warrior, partner: interceptor })).toEqual({ reason: 'injured', injuredDays: 3 });
			expect(() => startFight({ campaign, party: partyOf([warrior, interceptor]), enemy: idle() })).toThrow(`${named(warrior)} is injured, so they can't fight`);

			// The founding stores' 3 meds buy the rest
			treatDriver({ campaign, driver: warrior, days: 3 });
			const next = startFight({ campaign, party: loadOut({ campaign, seats: [warrior, interceptor] }), enemy: idle(), seed: SEED + 1 });
			expect(next.drivers.map(driver => driver.hitpoints)).toEqual([40, 25]);
		});

		it('refuses an arrival while a fight is open, changing nothing, so the fight still writes back', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			toughen(warrior, interceptor);
			// Hurt from an earlier fight, so an arrival would injure them
			interceptor.set({ hitpoints: 190, defaultDeck: { covering_fire: 10 } });
			const outrider = createEscort({ type: 'outrider' });
			campaign.convoy.add(outrider);
			const wrecker = raider({ deck: cardsOf(10, wreck), adrenaline: 2 });
			const sniper = raider({ deck: cardsOf(10, snipe), adrenaline: 1 });
			const fight = startFight({ campaign, party: loadOut({ campaign, seats: [warrior, interceptor], escorts: [outrider] }), enemy: [wrecker, sniper] });
			const before = [warrior.toJSON(), interceptor.toJSON()];

			expect(() => injureOnArrival({ campaign, drivers: [warrior, interceptor] }))
				.toThrow("This campaign's last fight hasn't been written back, so nobody has come home from it yet");
			expect([warrior.toJSON(), interceptor.toJSON()]).toEqual(before);

			// The run fails, as in the failed run below, and the write-back still fits the records
			fightOut(fight, turn => {
				if (turn === 2) play({ fight, seat: 1, cardType: 'covering_fire', target: wrecker });
			});
			const result = writeBackFight({ fight });
			expect(result.outcome).toBe('run_failed');
			expect([warrior.status, interceptor.status]).toEqual(['missing', 'dead']);
		});

		it('refuses, storing nothing, a result that would bring back a driver whose record died under the fight (DDB-305)', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			toughen(warrior, interceptor);
			interceptor.set({ hitpoints: 190, defaultDeck: { covering_fire: 10 } });
			const outrider = createEscort({ type: 'outrider' });
			campaign.convoy.add(outrider);
			const wrecker = raider({ deck: cardsOf(10, wreck), adrenaline: 2 });
			const sniper = raider({ deck: cardsOf(10, snipe), adrenaline: 1 });
			const fight = startFight({ campaign, party: loadOut({ campaign, seats: [warrior, interceptor], escorts: [outrider] }), enemy: [wrecker, sniper] });
			fightOut(fight, turn => {
				if (turn === 2) play({ fight, seat: 1, cardType: 'covering_fire', target: wrecker });
			});
			// The Road Warrior crashed out alive, so the result has them missing, but their record died in the meantime
			warrior.set({ status: 'dead', hitpoints: 0, defaultDeck: {} });
			const interceptorBefore = interceptor.toJSON();

			expect(() => writeBackFight({ fight })).toThrow(`${named(warrior)} is dead, and death is permanent, so they can't be "missing"`);
			expect(interceptor.toJSON()).toEqual(interceptorBefore);
			expect(campaign.convoy.escorts).toContain(outrider);
		});
	});

	describe('a vehicle retuned since the save', () => {
		it('loads, fights at the archetype\'s new maximums, and is written back clamped to them', async () => {
			const { campaign, warrior, interceptor } = newCampaign();
			shooter(interceptor);
			loadOut({ campaign, seats: [warrior, interceptor] });
			const storage = new MemorySaveStorage();
			await new CampaignStore({ storage, namespace: 'retune', onWarning: () => undefined }).save(campaign);
			const stats = DRIVER_CONFIGS.road_warrior.vehicleStats;
			const tuned = { maxStructure: stats.maxStructure, armor: stats.armor };
			try {
				// The Rig retuned down by 5 structure and 2 armor after the save
				Object.assign(stats, { maxStructure: tuned.maxStructure - 5, armor: tuned.armor - 2 });
				const loaded = await new CampaignStore({ storage, namespace: 'retune', onWarning: () => undefined }).load();
				if (!loaded) throw new Error('the save should load');
				const [rigDriver, bikeDriver] = [warrior, interceptor].map(record => loaded.drivers.find(driver => driver.id === record.id) as DriverRecord);
				expect(rigDriver.vehicle).toEqual({ structure: 80, armor: 10 });

				const scrapper = raider({ deck: [], adrenaline: 1 });
				const fight = startFight({ campaign: loaded, party: partyOf([rigDriver, bikeDriver]), enemy: scrapper });
				const [rig] = fight.vehicles;
				expect([rig.structure, rig.maxStructure, rig.armor, rig.maxArmor]).toEqual([75, 75, 8, 8]);

				fightOut(fight, () => play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper }));
				writeBackFight({ fight });
				expect(rigDriver.vehicle).toEqual({ structure: 75, armor: 8 });
			} finally {
				Object.assign(stats, tuned);
			}
		});
	});

	describe('a fight that fails the run, written back', () => {
		/**
		 * A run that fails with both seats customized: the Road Warrior leaves
		 * both Nitro Boosts home and borrows a Medical Kit, the Interceptor
		 * leaves an EMP Blast home and borrows a Covering Fire, and the run has
		 * won a Headshot. The wrecker crashes the Road Warrior out and seats the
		 * Interceptor in the Outrider, as in the pickup. The Interceptor takes
		 * the wrecker down from there, but the sniper takes them down in that
		 * seat, and nobody is left in the fight.
		 */
		function failedRun(): {
			campaign: Campaign;
			warrior: DriverRecord;
			interceptor: DriverRecord;
			outrider: Vehicle;
			home: Vehicle;
			party: RunParty;
			stores: Readonly<Resources>;
			result: FailedRun;
		} {
			const { campaign, warrior, interceptor } = newCampaign();
			toughen(warrior, interceptor);
			interceptor.set({ defaultDeck: { covering_fire: 10, emp_blast: 1 } });
			campaign.set({ locker: { covering_fire: 1, medical_kit: 1 } });
			const outrider = createEscort({ type: 'outrider' });
			const home = createEscort({ type: 'fuel_hauler' });
			[outrider, home].forEach(escort => campaign.convoy.add(escort));
			const party = { ...loadOut({ campaign, seats: [warrior, interceptor], escorts: [outrider], cargo: { ...NO_RESOURCES, fuel: 2, scrap: 30 } }), cargoCards: { headshot: 1 } };
			campaign.moveCards({ cardType: 'nitro_boost', from: runDeckOf(campaign, warrior), to: 'locker', count: 2 });
			campaign.moveCards({ cardType: 'medical_kit', from: 'locker', to: runDeckOf(campaign, warrior) });
			campaign.moveCards({ cardType: 'emp_blast', from: runDeckOf(campaign, interceptor), to: 'locker' });
			campaign.moveCards({ cardType: 'covering_fire', from: 'locker', to: runDeckOf(campaign, interceptor) });
			expect(campaign.locker).toEqual({});
			const stores = campaign.resources;
			const wrecker = raider({ deck: cardsOf(10, wreck), adrenaline: 2 });
			const sniper = raider({ deck: cardsOf(10, snipe), adrenaline: 1 });
			const fight = startFight({ campaign, party, enemy: [wrecker, sniper] });

			fightOut(fight, turn => {
				if (turn === 2) play({ fight, seat: 1, cardType: 'covering_fire', target: wrecker });
			});
			expect(fight.battle.isBattleWon()).toBe(false);
			const result = writeBackFight({ fight });
			if (result.outcome !== 'run_failed') throw new Error('the run should fail');
			return { campaign, warrior, interceptor, outrider, home, party, stores, result };
		}

		it('kills the driver who went down, leaves the one who crashed out missing, and loses the cargo, the cards won, and every escort that came along', () => {
			const { campaign, warrior, interceptor, outrider, home, party, stores, result } = failedRun();

			expect(result).toEqual({
				outcome: 'run_failed',
				party: null,
				dead: [interceptor],
				missing: [warrior],
				escortsLost: [outrider],
				cargoLost: party.cargo,
				cargoCardsLost: { headshot: 1 },
				run: 'run-1'
			});
			expect([warrior.status, warrior.hitpoints, warrior.vehicle]).toEqual(['missing', 35, { structure: LIMP_STRUCTURE, armor: 0 }]);
			expect([interceptor.status, interceptor.hitpoints, interceptor.defaultDeck]).toEqual(['dead', 0, {}]);
			expect(outrider.isAlive()).toBe(true);
			expect(campaign.convoy.escorts).toEqual([home]);
			expect(campaign.resources).toBe(stores);
			// The run decks wait for the run to end, without the card the lost Outrider brought
			expect(runDeckOf(campaign, warrior).escortCards).toEqual([]);
			expect(runDeckOf(campaign, interceptor).cards).toEqual({ covering_fire: 11 });
		});

		it('leaves the run decks to be unwound: the dead lose what went with them, the missing keep their default deck, and borrowed cards of the living go back to the locker (DDB-315)', () => {
			const { campaign, warrior, interceptor } = failedRun();
			const owned = campaign.cardsOwned;
			const lostWithTheDead = runDeckOf(campaign, interceptor);

			expect(campaign.unwindRunDecks()).toEqual({ lost: [lostWithTheDead] });

			expect(campaign.runDecks).toEqual([]);
			expect(warrior.defaultDeck).toEqual(startingDeckCounts('road_warrior'));
			expect(interceptor.defaultDeck).toEqual({});
			// The Road Warrior's Medical Kit is back, and so is the EMP Blast the Interceptor left at home
			expect(campaign.locker).toEqual({ emp_blast: 1, medical_kit: 1 });
			// What the Interceptor took, their own Covering Fires and the one they borrowed, went with them
			const { covering_fire: lost, ...kept } = owned;
			expect(lost).toBe(11);
			expect(campaign.cardsOwned).toEqual(kept);
		});

		it('loses the cards won with the cargo: none reach the locker when the run is settled, and the log says what was lost (DDB-316) before the fall', () => {
			const { campaign, warrior, interceptor, party, stores, result } = failedRun();
			const owned = campaign.cardsOwned;
			const lostWithTheDead = runDeckOf(campaign, interceptor);

			// The party the run set off with can't bring its cargo home
			expect(() => campaign.unloadRun({ party })).toThrow(`${named(warrior)} is missing, so this run didn't come home, and its cargo is lost`);
			expect(campaign.loseRun({ result })).toEqual({ lost: [lostWithTheDead] });

			expect(campaign.runDecks).toEqual([]);
			expect(campaign.resources).toEqual(stores);
			// The unwinding's locker, as above, with no Headshot in it
			expect(campaign.locker).toEqual({ emp_blast: 1, medical_kit: 1 });
			expect(totalCards(owned) - totalCards(campaign.cardsOwned)).toBe(lostWithTheDead.deckSize);
			// The pool was these two, so nobody is left at the compound, and the campaign is over (DDB-305)
			expect(campaign.log.slice(-2)).toEqual([
				{ day: campaign.day, message: 'Cargo lost with the run: 2 fuel, 30 scrap, and Headshot.' },
				{ day: campaign.day, message: 'No drivers are left, and the compound disbanded.' }
			]);
			expect(campaign.end).toEqual({ ending: 'disbanded', cause: 'last_driver' });
			expect(() => campaign.unloadRun({ party })).toThrow("Can't unload a run: the campaign is over, since the compound disbanded");
		});
	});

	describe('cards won, brought home (DDB-316)', () => {
		it('rides a reward through the next fight as cargo, never dealt, then home puts it in the locker beside the haulers\' scrap, and the debrief offers it', async () => {
			const { campaign, warrior, interceptor } = newCampaign();
			shooter(interceptor);
			const rig = salvageRig();
			campaign.convoy.add(rig);
			const stores = campaign.resources;
			const owned = campaign.cardsOwned;
			let party = loadOut({ campaign, seats: [warrior, interceptor], escorts: [rig] });

			const rewards: CardCounts[] = [{ headshot: 1 }, { headshot: 1, repair_kit: 1 }];
			for (const [index, reward] of rewards.entries()) {
				const scrapper = idle();
				const fight = startFight({ campaign, party, enemy: scrapper, seed: SEED + index });
				expect(fight.drivers.map(driver => cardsHeld(driver).headshot)).toEqual([undefined, undefined]);
				fightOut(fight, () => play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper }));
				// The reward screen's pick, after the write-back
				party = addCardsWon({ party: won(writeBackFight({ fight })).party, cardsWon: reward });
			}
			expect([party.cargo, party.cargoCards]).toEqual([{ ...NO_RESOURCES, scrap: 30 }, { headshot: 2, repair_kit: 1 }]);

			const unloaded = campaign.unloadRun({ party });

			expect(unloaded).toEqual({ resources: { ...NO_RESOURCES, scrap: 30 }, cards: { headshot: 2, repair_kit: 1 }, found: [] });
			expect(campaign.resources).toEqual({ ...stores, scrap: stores.scrap + 30 });
			expect(campaign.locker).toEqual({ headshot: 2, repair_kit: 1 });
			expect(campaign.cardsOwned).toEqual(addCards(addCards(owned, 'headshot', 2), 'repair_kit'));
			expect(getDebrief({ campaign, cardsWon: unloaded.cards }).map(({ cardType, takers }) => [cardType, takers.map(({ blocker }) => blocker)]))
				.toEqual([['headshot', [null, null]], ['repair_kit', [null, null]]]);

			campaign.moveCards({ cardType: 'headshot', from: 'locker', to: warrior });
			endDay({ campaign });
			const storage = new MemorySaveStorage();
			await new CampaignStore({ storage, namespace: 'home', onWarning: () => undefined }).save(campaign);
			const loaded = await new CampaignStore({ storage, namespace: 'home', onWarning: () => undefined }).load();
			expect(loaded?.toJSON()).toEqual(campaign.toJSON());
		});

		it('won\'t settle a run while its fight is open or being written back, so a run that fails in it can\'t have brought its cargo home', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			shooter(interceptor);
			const party = { ...loadOut({ campaign, seats: [warrior, interceptor] }), cargoCards: { headshot: 1 } };
			const scrapper = idle();
			const fight = startFight({ campaign, party, enemy: scrapper });
			const lost: FailedRun = { outcome: 'run_failed', party: null, dead: [], missing: [], escortsLost: [], cargoLost: NO_RESOURCES, cargoCardsLost: NO_CARDS, run: party.run };
			const settle = {
				'unload a run': () => campaign.unloadRun({ party }),
				'lose a run': () => campaign.loseRun({ result: lost }),
				'unwind run decks': () => campaign.unwindRunDecks()
			};
			const before = campaign.toSaveText();

			for (const [action, end] of Object.entries(settle)) expect(end).toThrow(`Can't ${action} while the campaign's last fight hasn't been written back`);
			expect(campaign.toSaveText()).toBe(before);

			fightOut(fight, () => play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper }));
			const refused: string[] = [];
			warrior.once('change', () => {
				try {
					campaign.unloadRun({ party });
				} catch (error) {
					refused.push((error as Error).message);
				}
			});
			const result = won(writeBackFight({ fight }));
			expect(refused).toEqual(["Can't unload a run while the campaign's last fight hasn't been written back"]);

			// And the next fight can't start on records the unload has half stored
			interceptor.once('change', () => {
				try {
					startFight({ campaign, party: result.party, enemy: idle(), seed: SEED + 1 });
				} catch (error) {
					refused.push((error as Error).message);
				}
			});
			campaign.unloadRun({ party: result.party });
			expect(refused[1]).toBe("This campaign is partway through storing its records, so a fight can't start on them");
			expect(campaign.locker).toEqual({ headshot: 1 });
		});

		it('won\'t start a fight for a party left over from an earlier run with the same seats', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			shooter(interceptor);
			const first = loadOut({ campaign, seats: [warrior, interceptor] });
			campaign.unloadRun({ party: first });
			const next = loadOut({ campaign, seats: [warrior, interceptor] });

			expect(() => startFight({ campaign, party: first, enemy: idle() })).toThrow('This party set off on "run-1", and the run out is run-2');
			expect(() => startFight({ campaign, party: next, enemy: idle() })).not.toThrow();
		});
	});

	describe('the write-back', () => {
		/** A won fight with a Fuel Hauler wrecked in it, so its write-back has something to drop from the convoy. */
		function wonWithAWreck(): { campaign: Campaign; warrior: DriverRecord; interceptor: DriverRecord; hauler: Vehicle; fight: CampaignFight } {
			const { campaign, warrior, interceptor } = newCampaign();
			shooter(interceptor);
			const hauler = createEscort({ type: 'fuel_hauler' });
			hauler.set({ structure: 10 });
			campaign.convoy.add(hauler);
			const scrapper = raider({ deck: cardsOf(10, jab), adrenaline: 1, archetype: 'looter' });
			const fight = startFight({ campaign, party: loadOut({ campaign, seats: [warrior, interceptor], escorts: [hauler] }), enemy: scrapper });
			fightOut(fight, turn => {
				if (turn === 2) play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper });
			});
			expect(hauler.isAlive()).toBe(false);
			return { campaign, warrior, interceptor, hauler, fight };
		}

		it('stores the records in seat order, then the run deck the wreck\'s card leaves, then the convoy, then the fight won in the tally', () => {
			const { campaign, warrior, interceptor, fight } = wonWithAWreck();
			const stored: string[] = [];
			warrior.on('change', () => stored.push('Road Warrior 1'));
			interceptor.on('change', () => stored.push('Interceptor 1'));
			campaign.convoy.on('change', () => stored.push('convoy'));
			campaign.on('change', () => stored.push('campaign'));

			writeBackFight({ fight });

			expect(stored).toEqual(['Road Warrior 1', 'Interceptor 1', 'campaign', 'convoy', 'campaign']);
			expect(runDeckOf(campaign, warrior).escortCards).toEqual([]);
			expect(campaign.tally.fightsWon).toBe(1);
		});

		it('leaves a wreck in the convoy until the fight is written back, so the step\'s checkpoint saves after it', () => {
			const { campaign, hauler, fight } = wonWithAWreck();

			expect(campaign.convoy.escorts).toContain(hauler);
			expect(() => JSON.stringify(campaign)).toThrow('Campaign.convoy.escorts[0].structure must be an integer from 1 to maxStructure (40), got 0');
			writeBackFight({ fight });
			expect(() => JSON.stringify(campaign)).not.toThrow();
		});

		it('refuses a fight that is still on, and stores nothing', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			const fight = startFight({ campaign, party: loadOut({ campaign, seats: [warrior, interceptor] }), enemy: idle() });

			expect(() => writeBackFight({ fight })).toThrow("The fight isn't over, so there's nothing to write back yet");
			expect(warrior.hitpoints).toBe(40);
		});

		it('refuses a tie, since a campaign fight has no turn limit', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			const fight = startFight({ campaign, party: loadOut({ campaign, seats: [warrior, interceptor] }), enemy: idle() });
			fight.battle.maxTurns = 1;

			fightOut(fight);

			expect(fight.battle.isBattleTied()).toBe(true);
			expect(() => writeBackFight({ fight })).toThrow('The fight ended in a tie at its turn limit; a campaign fight has none, so it ends won or lost');
		});

		it('refuses to write a fight back twice, from inside its own write-back too', () => {
			const { warrior, fight } = wonWithAWreck();
			let nested = '';
			warrior.once('change', () => {
				try {
					writeBackFight({ fight });
					nested = 'written';
				} catch (error) {
					nested = (error as Error).message;
				}
			});

			writeBackFight({ fight });

			expect(nested).toBe('This fight has already been written back');
			expect(() => writeBackFight({ fight })).toThrow('This fight has already been written back');
		});

		it('refuses to start the next fight from inside a write-back, on records and a convoy half stored', () => {
			const { campaign, warrior, interceptor, hauler, fight } = wonWithAWreck();
			const refusals: string[] = [];
			const startNext = (): void => {
				try {
					startFight({ campaign, party: partyOf([warrior, interceptor]), enemy: idle() });
					refusals.push('started');
				} catch (error) {
					refusals.push((error as Error).message);
				}
			};
			// The Road Warrior's record is stored before the Interceptor's, and both before the wreck leaves the convoy
			warrior.once('change', startNext);
			campaign.convoy.once('change', startNext);

			writeBackFight({ fight });

			expect(refusals).toEqual([
				"This campaign's last fight is still being written back",
				"This campaign's last fight is still being written back"
			]);
			expect(campaign.convoy.escorts).not.toContain(hauler);
			expect(() => startFight({ campaign, party: partyOf([warrior, interceptor]), enemy: idle() })).not.toThrow();
		});

		it('refuses an arrival started from inside a write-back, which would injure by HP not yet stored (DDB-304)', () => {
			const { campaign, warrior, interceptor, fight } = wonWithAWreck();
			// Down 5 on the record until the write-back stores the 25 the fight left them with
			interceptor.set({ hitpoints: 20 });
			let arrival = '';
			warrior.once('change', () => {
				try {
					injureOnArrival({ campaign, drivers: [warrior, interceptor] });
					arrival = 'home';
				} catch (error) {
					arrival = (error as Error).message;
				}
			});

			writeBackFight({ fight });

			expect(arrival).toBe("This campaign's last fight hasn't been written back, so nobody has come home from it yet");
			expect([interceptor.status, interceptor.injuredDays, interceptor.hitpoints]).toEqual(['ready', 0, 25]);
			expect(injureOnArrival({ campaign, drivers: [warrior, interceptor] })).toEqual([]);
		});

		it('lets the next fight start only once a write-back that threw part way is finished', () => {
			const { campaign, warrior, interceptor, fight } = wonWithAWreck();
			warrior.once('change', () => interceptor.set({ maxHitpoints: 20, hitpoints: 20 }));

			expect(() => writeBackFight({ fight })).toThrow('DriverRecord.hitpoints must be an integer from 0 to maxHitpoints (20), got 25');
			expect(() => startFight({ campaign, party: partyOf([warrior, interceptor]), enemy: idle() }))
				.toThrow("This campaign's last fight hasn't been written back");

			interceptor.set({ maxHitpoints: 25 });
			writeBackFight({ fight });
			expect(() => startFight({ campaign, party: partyOf([warrior, interceptor]), enemy: idle() })).not.toThrow();
		});

		it('refuses, storing nothing, a result its records no longer fit', () => {
			const { campaign, warrior, interceptor, hauler, fight } = wonWithAWreck();
			// Changed under the fight: the Road Warrior's 40 HP no longer fits
			warrior.set({ maxHitpoints: 30, hitpoints: 30 });
			const interceptorBefore = interceptor.toJSON();

			expect(() => writeBackFight({ fight })).toThrow(`${named(warrior)}.hitpoints must be an integer from 0 to maxHitpoints (30), got 40`);
			expect(interceptor.toJSON()).toEqual(interceptorBefore);
			expect(campaign.convoy.escorts).toContain(hauler);

			warrior.set({ maxHitpoints: 40 });
			writeBackFight({ fight });
			expect(campaign.convoy.escorts).toEqual([]);
		});

		it('can write a fight back again when a store throws part way, and finishes the job, counting the fight once', () => {
			const { campaign, warrior, interceptor, hauler, fight } = wonWithAWreck();
			// A listener on the first record cuts the second's max HP below what the fight left them before their turn comes
			warrior.once('change', () => interceptor.set({ maxHitpoints: 20, hitpoints: 20 }));

			expect(() => writeBackFight({ fight })).toThrow('DriverRecord.hitpoints must be an integer from 0 to maxHitpoints (20), got 25');
			// The Road Warrior's record was stored, setting the listener off, and nothing after the throw was
			expect(interceptor.maxHitpoints).toBe(20);
			expect(campaign.convoy.escorts).toContain(hauler);
			expect(campaign.tally.fightsWon).toBe(0);

			interceptor.set({ maxHitpoints: 25 });
			const result = writeBackFight({ fight });

			expect(result.outcome).toBe('won');
			expect(campaign.convoy.escorts).toEqual([]);
			expect(interceptor.hitpoints).toBe(25);
			expect(campaign.tally.fightsWon).toBe(1);
			expect(() => JSON.stringify(campaign)).not.toThrow();
		});
	});

	describe('escort ids through a run (DDB-403)', () => {
		/**
		 * A won fight in which a looter wrecks a hauler at 10 structure before
		 * the Interceptor, in the second seat, shoots it down on turn 2.
		 */
		function fightLosingTheHauler({ campaign, party, onStart = () => undefined }: { campaign: Campaign; party: RunParty; onStart?: (fight: CampaignFight) => void }): CampaignFight {
			const scrapper = raider({ deck: cardsOf(10, jab), adrenaline: 1, archetype: 'looter' });
			const fight = startFight({ campaign, party, enemy: scrapper });
			onStart(fight);
			fightOut(fight, turn => {
				if (turn === 2) play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper });
			});
			return fight;
		}

		/**
		 * A save between fights, which holds the party by its campaign ids, with
		 * the run decks in the campaign, and a load that finds them again.
		 */
		function saveAndLoad({ campaign, party }: { campaign: Campaign; party: RunParty }): { campaign: Campaign; party: RunParty } {
			const save = JSON.parse(JSON.stringify({
				campaign,
				seats: party.seats.map(record => record.id),
				escorts: idsOf(party.escorts),
				cargo: party.cargo,
				cargoCards: party.cargoCards,
				run: party.run
			})) as { campaign: unknown; seats: string[]; escorts: string[]; cargo: Resources; cargoCards: CardCounts; run: string };
			const loaded = Campaign.fromJSON(save.campaign);
			const find = <T>(items: readonly T[], match: (item: T) => boolean): T => {
				const found = items.find(match);
				if (found === undefined) throw new Error('the save names something the campaign should hold');
				return found;
			};
			return {
				campaign: loaded,
				party: {
					seats: save.seats.map(id => find(loaded.drivers, record => record.id === id)),
					escorts: save.escorts.map(id => find(loaded.convoy.escorts, escort => escort.convoyId === id)),
					cargo: save.cargo,
					cargoCards: save.cargoCards,
					run: save.run
				}
			};
		}

		it('keeps each escort\'s id through fights and a save between them, and never hands a lost one\'s out again', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			shooter(interceptor);
			const hauler = createEscort({ type: 'fuel_hauler' });
			hauler.set({ structure: 10 });
			const truck = createEscort({ type: 'med_truck' });
			[hauler, truck].forEach(escort => campaign.convoy.add(escort));
			expect(idsOf([hauler, truck])).toEqual(['escort-1', 'escort-2']);
			const party = loadOut({ campaign, seats: [warrior, interceptor], escorts: [hauler, truck] });

			const first = won(writeBackFight({ fight: fightLosingTheHauler({ campaign, party }) }));
			expect(first.escortsLost).toEqual([hauler]);
			expect(idsOf(campaign.convoy.escorts)).toEqual(['escort-2']);

			const loaded = saveAndLoad({ campaign, party: first.party });
			expect(idsOf(loaded.campaign.convoy.escorts)).toEqual(['escort-2']);
			expect(idsOf(loaded.party.escorts)).toEqual(['escort-2']);
			expect(loaded.party.seats.map(record => record.name)).toEqual(['Road Warrior 1', 'Interceptor 1']);

			const next = startFight({ campaign: loaded.campaign, party: loaded.party, enemy: idle(), seed: SEED + 1 });
			expect(idsOf(next.battle.playerTeam.escorts)).toEqual(['escort-2']);
			const hired = createEscort({ type: 'fuel_hauler' });
			loaded.campaign.convoy.add(hired);
			expect(hired.convoyId).toBe('escort-3');
		});

		it('deals a run deck\'s escort card after a load as a copy its escort brought, and takes it out of the fight and the run deck when that escort is lost', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			shooter(interceptor);
			const hauler = createEscort({ type: 'fuel_hauler' });
			hauler.set({ structure: 10 });
			campaign.convoy.add(hauler);
			// The Top Off the hauler brought goes in Driver 1's run deck, locked to it
			const party = { ...loadOut({ campaign, seats: [warrior, interceptor], escorts: [hauler] }), cargoCards: { headshot: 1 } };

			const loaded = saveAndLoad({ campaign, party });
			const [loadedWarrior] = loaded.party.seats;
			const [loadedHauler] = loaded.party.escorts;
			expect(runDeckOf(loaded.campaign, loadedWarrior).escortCards).toEqual([{ cardType: 'top_off', broughtBy: 'escort-1' }]);
			expect([loadedHauler.convoyId, loadedHauler.structure]).toEqual(['escort-1', 10]);

			let copy: Card | undefined;
			const fight = fightLosingTheHauler({
				campaign: loaded.campaign,
				party: loaded.party,
				onStart: ({ drivers: [rigDriver] }) => {
					copy = [...(rigDriver.deck?.cards ?? []), ...rigDriver.hand, ...rigDriver.discard].find(card => card.type === 'top_off');
				}
			});
			const [rigDriver] = fight.drivers;
			expect(copy?.broughtBy).toBe('escort-1');
			const result = won(writeBackFight({ fight }));

			expect(result.escortsLost).toEqual([loadedHauler]);
			expect([...(rigDriver.deck?.cards ?? []), ...rigDriver.hand, ...rigDriver.discard]).not.toContain(copy);
			expect(fight.battle.getMessages().map(message => message.message)).toContain('Fuel Hauler is lost for the run, and Top Off leaves the deck');
			expect(runDeckOf(loaded.campaign, loadedWarrior).escortCards).toEqual([]);
			// The cards won ride on as cargo
			expect(result.party.cargoCards).toEqual({ headshot: 1 });
		});
	});
});
