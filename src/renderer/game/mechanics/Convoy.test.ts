import { Battle } from './Battle';
import { Card, CardData } from './Card';
import { Convoy } from './Convoy';
import { Driver } from './Driver';
import { EscortProfile, EscortType, createEscort } from './Escort';
import { RoadLane, RoadRow, RoadSlot } from './Road';
import { MAX_CONVOY_ESCORTS, Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { createTestDriver } from '../ai/__tests__/test-helpers';
import cardsFile from '../data/cards.json';

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;

const slot = (lane: RoadLane, row: RoadRow): RoadSlot => ({ lane, row });

const createDriven = (name: string, startSlot: RoadSlot | null = null): Vehicle => new Vehicle({
	name,
	armor: 0,
	maxArmor: 0,
	structure: 20,
	maxStructure: 20,
	baseSpeed: 2,
	slot: startSlot,
	flank: null,
	velocity: 0,
	driver: createTestDriver(`${name} Driver`),
	passenger: null,
	statusEffects: []
});

const createBattle = (playerVehicles: Vehicle[], enemyVehicles: Vehicle[] = [createDriven('Buggy')]): Battle => new Battle({
	playerTeam: new Team({ type: TeamType.PLAYER, vehicles: playerVehicles }),
	enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: enemyVehicles })
});

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

/** A copy of an escort's signature card, as acquisition (DDB-153) will deal it */
const signatureCopy = (escort: Vehicle): Card => {
	const data = cardData.find(candidate => candidate.type === escort.escort?.signatureCard);
	if (!data) throw new Error(`No signature card for ${escort.name}`);
	return new Card({ ...data, broughtBy: escort.id });
};

/**
 * A driven vehicle whose driver died with no passenger, turned into an
 * escort with default crew stats. DDB-152 builds the conversion and owns
 * the real profile; this stands in for it.
 */
const convertToEscort = (vehicle: Vehicle): void => {
	driverOf(vehicle).takeDamage(1000);
	const profile: EscortProfile = {
		type: 'outrider',
		role: 'gun',
		gunnery: 3,
		evade: 3,
		ramming: 3,
		preferredSlot: { lane: 'inside', row: RoadRow.AHEAD },
		signatureCard: '',
		dividend: null,
		setPiece: false
	};
	vehicle.set({ driver: null, escort: profile });
};

const healLines = (battle: Battle): string[] =>
	battle.getMessages().filter(message => message.type === 'heal_applied').map(message => message.message);

describe('Convoy', () => {
	let rig: Vehicle;
	let bike: Vehicle;

	beforeEach(() => {
		rig = createDriven('Rig');
		bike = createDriven('Bike');
	});

	describe('the roster', () => {
		test('keeps escorts in the order they joined, up to four', () => {
			const escorts: EscortType[] = ['med_truck', 'outrider', 'fuel_hauler', 'pilot_car'];
			const convoy = new Convoy();
			const joined = escorts.map(type => createEscort({ type }));
			joined.forEach(escort => convoy.add(escort));

			expect(convoy.escorts).toEqual(joined);
			expect(convoy.isFull).toBe(true);
			expect(convoy.isOverCap).toBe(false);
			expect(() => convoy.add(createEscort({ type: 'outrider' })))
				.toThrow(`The convoy holds ${MAX_CONVOY_ESCORTS} escorts; dismiss one first`);
		});

		test('takes only the convoy\'s own escorts', () => {
			const convoy = new Convoy();

			expect(() => convoy.add(rig)).toThrow('Rig is not an escort');
			expect(() => convoy.add(createEscort({ type: 'outrider', setPiece: true })))
				.toThrow('Outrider is a set-piece ally, not the convoy\'s');
		});

		test('dismissing an escort takes the copy it brought out of whichever deck holds it', () => {
			const first = createEscort({ type: 'med_truck' });
			const second = createEscort({ type: 'med_truck' });
			const convoy = new Convoy({ escorts: [first, second] });
			const rigDriver = driverOf(rig);
			const bikeDriver = driverOf(bike);
			const firstCopy = signatureCopy(first);
			const secondCopy = signatureCopy(second);
			rigDriver.deck?.addCard(firstCopy);
			bikeDriver.deck?.addCard(secondCopy);

			convoy.dismiss({ escort: first, drivers: [rigDriver, bikeDriver] });

			expect(convoy.escorts).toEqual([second]);
			expect(rigDriver.deck?.cards).not.toContain(firstCopy);
			expect(bikeDriver.deck?.cards).toContain(secondCopy);
		});
	});

	describe('a lost escort', () => {
		test('is gone for the run, and its copy leaves deck, hand, discard, and exhausted when the fight ends', async () => {
			const truck = createEscort({ type: 'med_truck' });
			const convoy = new Convoy({ escorts: [truck] });
			const battle = createBattle([rig, bike, ...convoy.escorts]);
			const driver = driverOf(rig);
			const [inDeck, inHand, inDiscard, inExhausted] = [1, 2, 3, 4].map(() => signatureCopy(truck));
			const unrelated = signatureCopy(createEscort({ type: 'med_truck' }));
			driver.deck?.addCards([inDeck, unrelated]);
			driver.set({ hand: [inHand], discard: [inDiscard], exhausted: [inExhausted] });

			truck.destroy();
			await battle.endPlayerTurn();
			// Cleared off the road at the end of the turn, but not forgotten
			expect(battle.playerTeam.vehicles).not.toContain(truck);

			const result = battle.endCombat();
			convoy.afterFight(result);

			expect(result.lost).toEqual([truck]);
			expect(convoy.escorts).toEqual([]);
			const everywhere = [...(driver.deck?.cards ?? []), ...driver.hand, ...driver.discard, ...(driver.exhausted ?? [])];
			[inDeck, inHand, inDiscard, inExhausted].forEach(copy => expect(everywhere).not.toContain(copy));
			expect(everywhere).toContain(unrelated);
			expect(battle.getMessages().map(message => message.message))
				.toContain('Med Truck is lost for the run, and Triage, Triage, Triage, Triage leaves the deck');
		});

		test('leaves its copy in the hand for the rest of the fight, playable while another of its type lives', () => {
			const lost = createEscort({ type: 'med_truck' });
			const other = createEscort({ type: 'med_truck' });
			const battle = createBattle([rig, bike, lost, other]);
			const driver = driverOf(rig);
			const copy = signatureCopy(lost);
			driver.set({ hand: [copy], adrenaline: 5 });

			lost.destroy();

			expect(driver.hand).toContain(copy);
			expect(battle.canPlayCard({ driver, card: copy })).toBe(true);
			other.destroy();
			expect(battle.canPlayCard({ driver, card: copy })).toBe(false);
		});
	});

	describe('carrying an escort to the next fight', () => {
		test('keeps the structure it ended on', () => {
			const hauler = createEscort({ type: 'fuel_hauler' });
			const convoy = new Convoy({ escorts: [hauler] });
			const first = createBattle([rig, bike, ...convoy.escorts]);
			hauler.takeDamage(20);
			const structure = hauler.structure;
			expect(structure).toBeLessThan(hauler.maxStructure);

			convoy.afterFight(first.endCombat());
			const next = createBattle([createDriven('Rig'), createDriven('Bike'), ...convoy.escorts]);
			next.start();

			expect(hauler.structure).toBe(structure);
		});

		test('leaves the road at the end: slot, flank, statuses, Shield, spent, and passenger cleared, armor back to full', () => {
			const outrider = createEscort({ type: 'outrider' });
			const hauler = createEscort({ type: 'fuel_hauler' });
			const buggy = createDriven('Buggy');
			const battle = createBattle([rig, bike, outrider, hauler], [buggy]);
			outrider.set({
				slot: slot(RoadLane.ENEMY_SHOULDER, RoadRow.CENTER),
				flank: { reservedSlot: outrider.slot, outran: buggy },
				spent: true
			});
			outrider.applyStatusEffect({ name: 'speed_boost', duration: 2, value: 2 });
			hauler.addShield(6);
			hauler.takeDamage(8);
			hauler.passenger = createTestDriver('Rider');

			const { escorts } = battle.endCombat();

			expect(escorts).toEqual([outrider, hauler]);
			for (const escort of escorts) {
				expect(escort.slot).toBeNull();
				expect(escort.flank).toBeNull();
				expect(escort.statusEffects).toEqual([]);
				expect(escort.shield).toBe(0);
				expect(escort.spent).toBe(false);
				expect(escort.passenger).toBeNull();
				expect(escort.armor).toBe(escort.maxArmor);
			}
		});

		test('one that ended the fight flanking opens the next in its preferred slot', () => {
			const outrider = createEscort({ type: 'outrider' });
			const convoy = new Convoy({ escorts: [outrider] });
			const buggy = createDriven('Buggy');
			const first = createBattle([rig, bike, ...convoy.escorts], [buggy]);
			outrider.set({
				slot: slot(RoadLane.ENEMY_SHOULDER, RoadRow.CENTER),
				flank: { reservedSlot: outrider.slot, outran: buggy }
			});

			convoy.afterFight(first.endCombat());

			expect(() => createBattle([createDriven('Rig'), createDriven('Bike'), ...convoy.escorts])).not.toThrow();
			expect(outrider.slot).toEqual(slot(RoadLane.PLAYER_INSIDE, RoadRow.AHEAD));
			expect(outrider.isFlanking).toBe(false);
		});

		test('a set-piece ally is not the convoy\'s and isn\'t carried', () => {
			const ally = createEscort({ type: 'pilot_car', setPiece: true });
			const battle = createBattle([rig, bike, ally]);

			expect(battle.endCombat().escorts).toEqual([]);
		});

		test('ending twice changes nothing more', () => {
			const truck = createEscort({ type: 'med_truck' });
			const battle = createBattle([rig, bike, truck]);
			driverOf(rig).set({ hitpoints: 1, maxHitpoints: 20 });

			const result = battle.endCombat();

			expect(battle.endCombat()).toBe(result);
			expect(battle.afterFight).toBe(result);
			expect(driverOf(rig).hitpoints).toBe(4);
		});
	});

	describe('a driven vehicle that became an escort', () => {
		test('stays in the convoy after the fight, at the end of the roster, even past four', () => {
			const escorts: EscortType[] = ['outrider', 'pilot_car', 'fuel_hauler', 'med_truck'];
			const convoy = new Convoy({ escorts: escorts.map(type => createEscort({ type })) });
			const battle = createBattle([rig, bike, ...convoy.escorts]);
			const roster = [...convoy.escorts];

			convertToEscort(bike);
			const result = battle.endCombat();
			convoy.afterFight(result);

			expect(result.escorts).toContain(bike);
			expect(convoy.escorts).toEqual([...roster, bike]);
			expect(convoy.isOverCap).toBe(true);
			expect(bike.slot).toBeNull();
			// A team can't field five, so one has to go before the next fight
			expect(() => new Team({ type: TeamType.PLAYER, vehicles: [createDriven('Rig'), createDriven('Van'), ...convoy.escorts] }))
				.toThrow('Player teams can field 4 convoy escorts, not 5');

			convoy.dismiss({ escort: roster[0], drivers: [driverOf(rig)] });
			expect(convoy.isOverCap).toBe(false);
		});

		test('brings no signature card, so nothing leaves the deck if it is wrecked', () => {
			const battle = createBattle([rig, bike]);
			const deckSize = driverOf(rig).deck?.size;

			convertToEscort(bike);
			bike.destroy();
			const result = battle.endCombat();

			expect(result.lost).toEqual([]);
			expect(result.escorts).toEqual([]);
			expect(driverOf(rig).deck?.size).toBe(deckSize);
		});
	});

	describe('dividends', () => {
		test('a Fuel Hauler that survives pays +1 fuel for the run to add', () => {
			const hauler = createEscort({ type: 'fuel_hauler' });
			const battle = createBattle([rig, bike, hauler]);

			const { dividends } = battle.endCombat();

			expect(dividends).toEqual([{ escort: hauler, kind: 'fuel', amount: 1 }]);
			expect(battle.getMessages().map(message => message.message)).toContain('Fuel Hauler pays out 1 fuel');
		});

		test('a wrecked hauler pays nothing', () => {
			const hauler = createEscort({ type: 'fuel_hauler' });
			const battle = createBattle([rig, bike, hauler]);
			hauler.destroy();

			expect(battle.endCombat().dividends).toEqual([]);
		});

		test('a Med Truck heals every living driver 3, up to their starting HP, including one who crashed out', () => {
			const truck = createEscort({ type: 'med_truck' });
			const battle = createBattle([rig, bike, truck]);
			const rigDriver = driverOf(rig);
			const bikeDriver = driverOf(bike);
			rigDriver.set({ hitpoints: 10, maxHitpoints: 20 });
			bikeDriver.set({ hitpoints: 19, maxHitpoints: 20 });
			// The Bike is wrecked with every seat taken: its driver crashes out alive
			rig.passenger = createTestDriver('Rider');
			truck.passenger = createTestDriver('Truck Rider');
			battle.playerTeam.handleVehicleDestruction(bike);
			expect(battle.playerTeam.getAliveDrivers()).not.toContain(bikeDriver);

			const { dividends } = battle.endCombat();

			expect(dividends).toEqual([{ escort: truck, kind: 'heal', amount: 3 }]);
			expect(rigDriver.hitpoints).toBe(13);
			expect(bikeDriver.hitpoints).toBe(20);
			expect(healLines(battle)).toEqual([
				'Med Truck patches up Player1 Rig Driver: +3 HP',
				'Med Truck patches up Player2 Bike Driver: +1 HP'
			]);
		});

		test('a dead driver isn\'t healed', () => {
			const battle = createBattle([rig, bike, createEscort({ type: 'med_truck' })]);
			driverOf(bike).takeDamage(1000);

			battle.endCombat();

			expect(driverOf(bike).hitpoints).toBe(0);
		});

		test('each Med Truck pays its own heal', () => {
			const battle = createBattle([rig, bike, createEscort({ type: 'med_truck' }), createEscort({ type: 'med_truck' })]);
			driverOf(rig).set({ hitpoints: 10, maxHitpoints: 20 });

			battle.endCombat();

			expect(driverOf(rig).hitpoints).toBe(16);
		});

		test('nothing pays out after a lost fight', () => {
			const truck = createEscort({ type: 'med_truck' });
			const hauler = createEscort({ type: 'fuel_hauler' });
			const battle = createBattle([rig, bike, truck, hauler]);
			driverOf(rig).takeDamage(1000);
			driverOf(bike).takeDamage(1000);
			rig.handleDriverDeath();
			bike.handleDriverDeath();

			expect(battle.endCombat().dividends).toEqual([]);
		});

		test('a won fight ends with the result ready for the run', () => {
			const hauler = createEscort({ type: 'fuel_hauler' });
			const buggy = createDriven('Buggy');
			const battle = createBattle([rig, bike, hauler], [buggy]);
			battle.start();
			const kill = new Card({
				type: 'kill',
				name: 'Kill',
				summary: 'Kill',
				description: 'Kill',
				rarity: 'common',
				cost: 0,
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 100, target: 'driver', range: 10, always_hits: true }],
				tags: ['attack']
			});
			driverOf(rig).set({ hand: [kill] });

			battle.playCard({ driver: driverOf(rig), cardIndex: 0, targetVehicle: buggy });

			expect(battle.battleWon).toBe(true);
			expect(battle.afterFight?.dividends).toEqual([{ escort: hauler, kind: 'fuel', amount: 1 }]);
			expect(hauler.slot).toBeNull();
		});
	});
});
