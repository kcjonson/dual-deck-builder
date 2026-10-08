import { createTestDriver } from '../ai/__tests__/test-helpers';
import { Rng } from '../core/Rng';
import cardsFile from '../data/cards.json';
import { resolveMapParams } from '../map/MapParams';
import { Card, CardData, CardEffect } from '../mechanics/Card';
import { Deck } from '../mechanics/Deck';
import { Driver, DriverRole } from '../mechanics/Driver';
import { EscortProfile, createEscort } from '../mechanics/Escort';
import type { RaiderArchetype } from '../mechanics/RaiderArchetype';
import { Team, TeamType } from '../mechanics/Team';
import { Vehicle, createDrivenVehicle } from '../mechanics/Vehicle';
import { Campaign } from './Campaign';
import { CardCounts, startingDeckCounts } from './CardCounts';
import { CampaignFight, FightWriteBack, RunParty, startCampaignFight, writeBackFight } from './CombatBridge';
import { DriverRecord } from './DriverRecord';

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
/** Kills the driver it hits, or the passenger riding in an escort. */
const snipe = (): Card => raiderCard('Snipe', { type: 'damage', value: 500, target: 'driver' });

const cardsOf = (count: number, card: () => Card): Card[] => Array.from({ length: count }, card);

/**
 * A raider any hit finishes, playing `draws` in order, `adrenaline` cards a
 * turn. With no AI, it plays its first card at its first legal target: the
 * Rig, unless its archetype prefers another.
 */
function raider({ draws, adrenaline, archetype = null }: { draws: Card[]; adrenaline: number; archetype?: RaiderArchetype | null }): Vehicle {
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
		// A deck draws from its end
		deck: new Deck('scrapper', "Scrapper's deck", [...draws].reverse())
	});
	const buggy = createDrivenVehicle({ driver });
	buggy.raiderArchetype = archetype;
	return buggy;
}

/** A compound with a Road Warrior and an Interceptor in its pool and a few days' stores. */
function newCampaign(): { campaign: Campaign; warrior: DriverRecord; interceptor: DriverRecord } {
	const campaign = new Campaign({
		seed: SEED,
		generatorVersion: 1,
		mapParams: resolveMapParams({ seed: SEED, environment: 'mixed' }).params,
		resources: { food: 20, water: 20, fuel: 6, meds: 2, scrap: 40, people: 12 }
	});
	const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
	const interceptor = campaign.recruitDriver({ archetype: 'interceptor' });
	return { campaign, warrior, interceptor };
}

/** Drivers tough enough to walk away from two wrecks. */
const toughen = (...records: DriverRecord[]): void => records.forEach(record => record.set({ maxHitpoints: 200, hitpoints: 200 }));

/** The spec's Salvage Rig isn't built (its signature card isn't designed); a hauler paying its +15 scrap stands in. */
function salvageRig(): Vehicle {
	const rig = createEscort({ type: 'fuel_hauler' });
	rig.set({
		name: 'Salvage Rig',
		escort: { ...(rig.escort as EscortProfile), type: null, signatureCard: null, dividend: { kind: 'scrap', amount: 15 } }
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

function partyAfter(result: FightWriteBack): RunParty {
	if (!result.party) throw new Error('the run should go on');
	return result.party;
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
		it('seats each record as a combat driver: name, HP, and hand limit, dealing from the run deck or the default deck', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			warrior.set({ hitpoints: 31, handLimit: 3 });
			const runDeck: CardCounts = { headshot: 2, precision_shot: 8 };

			const fight = startFight({
				campaign,
				party: { seats: [{ record: warrior }, { record: interceptor, runDeck }], escorts: [] },
				enemy: raider({ draws: [], adrenaline: 1 })
			});
			const [rigDriver, bikeDriver] = fight.drivers;

			expect(fight.drivers.map(driver => driver.metadata.name)).toEqual(['Road Warrior 1', 'Interceptor 1']);
			expect(fight.drivers.map(driver => driver.archetype)).toEqual(['road_warrior', 'interceptor']);
			expect([rigDriver.hitpoints, rigDriver.maxHitpoints]).toEqual([31, 40]);
			expect([bikeDriver.hitpoints, bikeDriver.maxHitpoints]).toEqual([25, 25]);
			expect(fight.battle.playerTeam.drivenVehicles.map(vehicle => vehicle.driver)).toEqual(fight.drivers);
			expect(fight.battle.playerTeam.drivenVehicles.map(vehicle => vehicle.name)).toEqual(['Apocalypse Rig', 'Lightning Bike']);

			// The record's hand limit: the opening five fill three and burn two
			expect(rigDriver.handLimit).toBe(3);
			expect(rigDriver.hand).toHaveLength(3);
			expect(rigDriver.discard).toHaveLength(2);
			expect(bikeDriver.handLimit).toBe(7);
			expect(bikeDriver.hand).toHaveLength(5);

			expect(cardsHeld(rigDriver)).toEqual(warrior.defaultDeck);
			expect(cardsHeld(bikeDriver)).toEqual(runDeck);
			expect(interceptor.defaultDeck).toEqual(startingDeckCounts('interceptor'));
		});

		it('fights on the stream it is given, with the compound\'s scrap and fuel on the top bar', () => {
			const { campaign, warrior, interceptor } = newCampaign();

			const fight = startFight({
				campaign,
				party: { seats: [{ record: warrior }, { record: interceptor }], escorts: [] },
				enemy: raider({ draws: [], adrenaline: 1 }),
				seed: 7
			});

			expect(fight.battle.seed).toBe(new Rng({ seed: 7 }).seed);
			expect(fight.battle.turn).toBe(1);
			expect([fight.scrap, fight.fuel]).toEqual([40, 6]);
		});

		it('fields the escorts that came along in roster order, and none left at home', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			const [outrider, pilotCar, hauler] = (['outrider', 'pilot_car', 'fuel_hauler'] as const).map(type => createEscort({ type }));
			[outrider, pilotCar, hauler].forEach(escort => campaign.convoy.add(escort));

			const fight = startFight({
				campaign,
				party: { seats: [{ record: warrior }, { record: interceptor }], escorts: [hauler, outrider] },
				enemy: raider({ draws: [], adrenaline: 1 })
			});

			expect(fight.battle.playerTeam.escorts).toEqual([outrider, hauler]);
			expect(pilotCar.slot).toBeNull();
		});

		describe('refuses', () => {
			const enemy = (): Vehicle => raider({ draws: [], adrenaline: 1 });

			it('a party without two drivers', () => {
				const { campaign, warrior } = newCampaign();

				expect(() => startFight({ campaign, party: { seats: [{ record: warrior }], escorts: [] }, enemy: enemy() }))
					.toThrow("A fight seats two drivers, and this party has 1; a run down to one driver can't field a fight yet");
			});

			it('two drivers of one archetype', () => {
				const { campaign, warrior } = newCampaign();
				const second = campaign.recruitDriver({ archetype: 'road_warrior' });

				expect(() => startFight({ campaign, party: { seats: [{ record: warrior }, { record: second }], escorts: [] }, enemy: enemy() }))
					.toThrow("The same driver can't fill both slots (road_warrior)");
			});

			it('a driver from outside the pool', () => {
				const { campaign, warrior } = newCampaign();
				const stranger = new DriverRecord({ id: 'driver-9', archetype: 'mechanic', name: 'Mechanic 1' });

				expect(() => startFight({ campaign, party: { seats: [{ record: warrior }, { record: stranger }], escorts: [] }, enemy: enemy() }))
					.toThrow("Mechanic 1 (driver-9) isn't in this campaign's pool");
			});

			it.each([
				['dead', { status: 'dead', hitpoints: 0, defaultDeck: {} }],
				['missing', { status: 'missing' }],
				['injured', { status: 'injured', injuredDays: 2 }]
			] as const)('a driver who is %s', (status, changes) => {
				const { campaign, warrior, interceptor } = newCampaign();
				interceptor.set(changes);

				expect(() => startFight({ campaign, party: { seats: [{ record: warrior }, { record: interceptor }], escorts: [] }, enemy: enemy() }))
					.toThrow(`Interceptor 1 (driver-2) is ${status}, so they can't fight`);
			});

			it('an escort that isn\'t the campaign\'s, or still carries a driver from a fight never written back', () => {
				const { campaign, warrior, interceptor } = newCampaign();
				const seats = [{ record: warrior }, { record: interceptor }];
				const owned = createEscort({ type: 'outrider' });
				campaign.convoy.add(owned);
				owned.passenger = createTestDriver('Stowaway');

				expect(() => startFight({ campaign, party: { seats, escorts: [createEscort({ type: 'pilot_car' })] }, enemy: enemy() }))
					.toThrow("Pilot Car isn't in the campaign's convoy");
				expect(() => startFight({ campaign, party: { seats, escorts: [owned] }, enemy: enemy() }))
					.toThrow("Outrider is still in a fight that wasn't written back");
			});

			it('a run deck holding a card that doesn\'t exist', () => {
				const { campaign, warrior, interceptor } = newCampaign();

				expect(() => startFight({
					campaign,
					party: { seats: [{ record: warrior }, { record: interceptor, runDeck: { headshot: 2, lucky_charm: 1 } }], escorts: [] },
					enemy: enemy()
				})).toThrow("Interceptor 1 (driver-2)'s run deck holds lucky_charm, which isn't a card");
			});

			it('a fifth escort, which a fight can leave the run with until one is dismissed', () => {
				const { campaign, warrior, interceptor } = newCampaign();
				const escorts = (['outrider', 'pilot_car', 'fuel_hauler', 'med_truck'] as const).map(type => createEscort({ type }));
				escorts.forEach(escort => campaign.convoy.add(escort));
				const fifth = createEscort({ type: 'outrider' });
				campaign.convoy.afterFight({ escorts: [fifth], lost: [], dividends: [] });

				expect(() => startFight({ campaign, party: { seats: [{ record: warrior }, { record: interceptor }], escorts: [...escorts, fifth] }, enemy: enemy() }))
					.toThrow('Player teams can field 4 convoy escorts, not 5');
			});
		});
	});

	describe('a won fight, written back', () => {
		it('carries each driver\'s HP into their record and on into the next fight', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			warrior.set({ hitpoints: 31 });
			const party: RunParty = { seats: [{ record: warrior }, { record: interceptor, runDeck: { precision_shot: 10 } }], escorts: [] };
			const scrapper = raider({ draws: cardsOf(10, jab), adrenaline: 1 });
			const fight = startFight({ campaign, party, enemy: scrapper });

			// The raider jabs the Rig on its turn, and the Interceptor finishes it on the next
			fightOut(fight, turn => {
				if (turn === 2) play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper });
			});
			const result = writeBackFight({ campaign, fight });

			expect(result).toEqual({ outcome: 'won', party, dead: [], pickedUp: [], missing: [], escortsLost: [] });
			expect(fight.drivers[0].hitpoints).toBe(26);
			expect([warrior.hitpoints, warrior.status]).toEqual([26, 'ready']);
			expect([interceptor.hitpoints, interceptor.status]).toEqual([25, 'ready']);

			const next = startFight({ campaign, party: partyAfter(result), enemy: raider({ draws: [], adrenaline: 1 }), seed: SEED + 1 });
			expect(next.drivers.map(driver => driver.hitpoints)).toEqual([26, 25]);
			expect(cardsHeld(next.drivers[1])).toEqual({ precision_shot: 10 });
		});

		it('picks up a driver who crashed out, so both drivers are in the next fight (DDB-158)', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			toughen(warrior, interceptor);
			const outrider = createEscort({ type: 'outrider' });
			campaign.convoy.add(outrider);
			const party: RunParty = { seats: [{ record: warrior }, { record: interceptor, runDeck: { covering_fire: 10 } }], escorts: [outrider] };
			const scrapper = raider({ draws: cardsOf(10, wreck), adrenaline: 2 });
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
			const result = writeBackFight({ campaign, fight });

			expect(result).toEqual({ outcome: 'won', party, dead: [], pickedUp: [warrior], missing: [], escortsLost: [] });
			// 80 from the Rig's wreck and 85 from the Bike's, which the Interceptor took too
			expect([warrior.hitpoints, warrior.status]).toEqual([35, 'ready']);
			expect([interceptor.hitpoints, interceptor.status]).toEqual([115, 'ready']);
			expect(campaign.convoy.escorts).toEqual([outrider]);
			expect(outrider.passenger).toBeNull();

			const next = startFight({ campaign, party: partyAfter(result), enemy: raider({ draws: [], adrenaline: 1 }), seed: SEED + 1 });
			expect(next.drivers.map(driver => driver.metadata.name)).toEqual(['Road Warrior 1', 'Interceptor 1']);
			expect(next.battle.playerTeam.drivenVehicles.map(vehicle => vehicle.driver)).toEqual(next.drivers);
			expect(next.drivers.map(driver => driver.hitpoints)).toEqual([35, 115]);
			expect(next.battle.playerTeam.escorts).toEqual([outrider]);
		});

		it('pays each dividend: fuel and scrap into the stores, and the Med Truck\'s heal into the records', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			warrior.set({ hitpoints: 30 });
			interceptor.set({ hitpoints: 24 });
			const escorts = [createEscort({ type: 'fuel_hauler' }), salvageRig(), createEscort({ type: 'med_truck' })];
			escorts.forEach(escort => campaign.convoy.add(escort));
			const scrapper = raider({ draws: [], adrenaline: 1 });
			const fight = startFight({
				campaign,
				party: { seats: [{ record: warrior }, { record: interceptor, runDeck: { precision_shot: 10 } }], escorts },
				enemy: scrapper
			});

			fightOut(fight, () => play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper }));
			writeBackFight({ campaign, fight });

			expect(campaign.resources).toEqual({ food: 20, water: 20, fuel: 7, meds: 2, scrap: 55, people: 12 });
			// 3 each, up to their starting HP
			expect([warrior.hitpoints, interceptor.hitpoints]).toEqual([33, 25]);
			expect(campaign.convoy.escorts).toEqual(escorts);
		});

		it('loses a wrecked escort, and the one that took damage carries its structure on with its armor back', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			const hauler = createEscort({ type: 'fuel_hauler' });
			// Hurt in an earlier fight: one more jab wrecks it
			hauler.set({ structure: 10 });
			const truck = createEscort({ type: 'med_truck' });
			[hauler, truck].forEach(escort => campaign.convoy.add(escort));
			// A looter goes for the haulers: the Fuel Hauler first, then the Med Truck once it's gone
			const scrapper = raider({ draws: cardsOf(10, jab), adrenaline: 1, archetype: 'looter' });
			const party: RunParty = { seats: [{ record: warrior }, { record: interceptor, runDeck: { precision_shot: 10 } }], escorts: [hauler, truck] };
			const fight = startFight({ campaign, party, enemy: scrapper });

			fightOut(fight, turn => {
				if (turn === 3) play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper });
			});
			const result = writeBackFight({ campaign, fight });

			expect(result.escortsLost).toEqual([hauler]);
			expect(partyAfter(result).escorts).toEqual([truck]);
			expect(campaign.convoy.escorts).toEqual([truck]);
			// 20 past its 4 armor is 16 off its 35 structure
			expect([truck.structure, truck.armor]).toEqual([19, 4]);
			// A wrecked hauler pays nothing
			expect(campaign.resources.fuel).toBe(6);

			const next = startFight({ campaign, party: partyAfter(result), enemy: raider({ draws: [], adrenaline: 1 }), seed: SEED + 1 });
			expect(next.battle.playerTeam.escorts).toEqual([truck]);
			expect(truck.structure).toBe(19);
		});

		it('writes a death: no HP, no cards, and the vehicle carries on as the convoy\'s newest escort', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			const outrider = createEscort({ type: 'outrider' });
			campaign.convoy.add(outrider);
			const scrapper = raider({ draws: cardsOf(10, snipe), adrenaline: 1 });
			const fight = startFight({
				campaign,
				party: { seats: [{ record: warrior }, { record: interceptor, runDeck: { precision_shot: 10 } }], escorts: [outrider] },
				enemy: scrapper
			});
			const [rig] = fight.battle.playerTeam.drivenVehicles;

			fightOut(fight, turn => {
				if (turn === 2) play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper });
			});
			const result = writeBackFight({ campaign, fight });

			expect(result.outcome).toBe('won');
			expect(result.dead).toEqual([warrior]);
			expect([warrior.status, warrior.hitpoints, warrior.defaultDeck]).toEqual(['dead', 0, {}]);
			expect(campaign.convoy.escorts).toEqual([outrider, rig]);
			expect(rig.isEscort).toBe(true);
			expect(partyAfter(result)).toEqual({ seats: [{ record: interceptor, runDeck: { precision_shot: 10 } }], escorts: [outrider, rig] });
			expect(() => startFight({ campaign, party: partyAfter(result), enemy: raider({ draws: [], adrenaline: 1 }) }))
				.toThrow('A fight seats two drivers, and this party has 1');
		});
	});

	describe('a fight that fails the run, written back', () => {
		it('leaves the dead dead and the crashed-out driver missing, and loses every escort that came along', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			toughen(warrior, interceptor);
			const outrider = createEscort({ type: 'outrider' });
			const home = createEscort({ type: 'fuel_hauler' });
			[outrider, home].forEach(escort => campaign.convoy.add(escort));
			const wrecker = raider({ draws: cardsOf(10, wreck), adrenaline: 2 });
			const sniper = raider({ draws: cardsOf(10, snipe), adrenaline: 1 });
			const fight = startFight({
				campaign,
				party: { seats: [{ record: warrior }, { record: interceptor, runDeck: { covering_fire: 10 } }], escorts: [outrider] },
				enemy: [wrecker, sniper]
			});

			// The wrecker crashes the Road Warrior out and seats the Interceptor in the
			// Outrider, as in the pickup. The Interceptor takes the wrecker down from
			// there, but the sniper kills them in that seat, and nobody is left in the fight.
			fightOut(fight, turn => {
				if (turn === 2) play({ fight, seat: 1, cardType: 'covering_fire', target: wrecker });
			});
			expect(fight.battle.isBattleWon()).toBe(false);
			const result = writeBackFight({ campaign, fight });

			expect(result).toEqual({ outcome: 'run_failed', party: null, dead: [interceptor], pickedUp: [], missing: [warrior], escortsLost: [outrider] });
			expect([warrior.status, warrior.hitpoints, warrior.defaultDeck]).toEqual(['missing', 35, startingDeckCounts('road_warrior')]);
			expect([interceptor.status, interceptor.hitpoints, interceptor.defaultDeck]).toEqual(['dead', 0, {}]);
			expect(outrider.isAlive()).toBe(true);
			expect(campaign.convoy.escorts).toEqual([home]);
			expect(campaign.resources).toEqual({ food: 20, water: 20, fuel: 6, meds: 2, scrap: 40, people: 12 });
		});
	});

	describe('the write-back', () => {
		it('stores the records in seat order, then the convoy, then the stores', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			warrior.set({ hitpoints: 30 });
			interceptor.set({ hitpoints: 20 });
			const escorts = [createEscort({ type: 'fuel_hauler' }), createEscort({ type: 'med_truck' })];
			escorts.forEach(escort => campaign.convoy.add(escort));
			const scrapper = raider({ draws: [], adrenaline: 1 });
			const fight = startFight({
				campaign,
				party: { seats: [{ record: warrior }, { record: interceptor, runDeck: { precision_shot: 10 } }], escorts },
				enemy: scrapper
			});
			fightOut(fight, () => play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper }));
			const stored: string[] = [];
			warrior.on('change', () => stored.push('Road Warrior 1'));
			interceptor.on('change', () => stored.push('Interceptor 1'));
			campaign.convoy.on('change', () => stored.push('convoy'));
			campaign.on('change', () => stored.push('campaign'));

			writeBackFight({ campaign, fight });

			expect(stored).toEqual(['Road Warrior 1', 'Interceptor 1', 'convoy', 'campaign']);
		});

		it('refuses a fight that is still on, and stores nothing', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			const fight = startFight({ campaign, party: { seats: [{ record: warrior }, { record: interceptor }], escorts: [] }, enemy: raider({ draws: [], adrenaline: 1 }) });

			expect(() => writeBackFight({ campaign, fight })).toThrow("The fight isn't over, so there's nothing to write back yet");
			expect(warrior.hitpoints).toBe(40);
		});

		it('refuses a tie, since a campaign fight has no turn limit', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			const fight = startFight({ campaign, party: { seats: [{ record: warrior }, { record: interceptor }], escorts: [] }, enemy: raider({ draws: [], adrenaline: 1 }) });
			fight.battle.maxTurns = 1;

			fightOut(fight);

			expect(fight.battle.isBattleTied()).toBe(true);
			expect(() => writeBackFight({ campaign, fight })).toThrow('The fight ended in a tie at its turn limit; a campaign fight has none, so it ends won or lost');
		});

		it('refuses to write a fight back twice, so its dividends pay once', () => {
			const { campaign, warrior, interceptor } = newCampaign();
			const hauler = createEscort({ type: 'fuel_hauler' });
			campaign.convoy.add(hauler);
			const scrapper = raider({ draws: [], adrenaline: 1 });
			const fight = startFight({
				campaign,
				party: { seats: [{ record: warrior }, { record: interceptor, runDeck: { precision_shot: 10 } }], escorts: [hauler] },
				enemy: scrapper
			});
			fightOut(fight, () => play({ fight, seat: 1, cardType: 'precision_shot', target: scrapper }));
			writeBackFight({ campaign, fight });

			expect(() => writeBackFight({ campaign, fight })).toThrow('This fight has already been written back');
			expect(campaign.resources.fuel).toBe(7);
		});
	});
});
