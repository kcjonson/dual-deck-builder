import { Battle } from './Battle';
import { Card, CardData } from './Card';
import { Driver, DriverRole } from './Driver';
import { EscortType, createEscort } from './Escort';
import { RoadLane, RoadRow, RoadSlot, compareTieOrder, nearestTo } from './Road';
import { Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { createTestDriver } from '../ai/__tests__/test-helpers';
import cardsFile from '../data/cards.json';

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;

/** A fresh copy of a card as cards.json has it */
const realCard = (type: string): Card => {
	const data = cardData.find(candidate => candidate.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return new Card({ ...data });
};

const slot = (lane: RoadLane, row: RoadRow): RoadSlot => ({ lane, row });

// Test drivers have ramming, gunnery, and evade 5 and speed 2, so a driven
// vehicle here moves at 4
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

const escortAt = (type: EscortType, at: RoadSlot | null = null, setPiece = false): Vehicle => {
	const escort = createEscort({ type, setPiece });
	escort.slot = at;
	return escort;
};

const createBattle = (playerVehicles: Vehicle[], enemyVehicles: Vehicle[]): Battle => new Battle({
	playerTeam: new Team({ type: TeamType.PLAYER, vehicles: playerVehicles }),
	enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: enemyVehicles })
});

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

const setSkills = (vehicle: Vehicle, skills: Partial<Driver['skills']>): void => {
	const driver = driverOf(vehicle);
	driver.set({ skills: { ...driver.skills, ...skills } });
};

/** Put one card in a driver's hand with adrenaline to spare and play it */
const play = ({
	battle,
	driver,
	card,
	target,
	targetOccupant
}: {
	battle: Battle;
	driver: Driver;
	card: Card;
	target?: Vehicle;
	targetOccupant?: Driver;
}): boolean => {
	driver.set({ hand: [card], adrenaline: 5 });
	return battle.playCard({ driver, cardIndex: 0, targetVehicle: target, targetOccupant });
};

const logLines = (battle: Battle, type: string): string[] =>
	battle.getMessages().filter(message => message.type === type).map(message => message.message);

const raiderCard = (name: string, targetType: CardData['targetType'], effects: CardData['effects']): Card => new Card({
	type: name.toLowerCase().replace(/ /g, '_'),
	name,
	summary: name,
	description: name,
	rarity: 'common',
	cost: 1,
	targetType,
	effects,
	tags: ['attack']
});

const potShot = (range = 10): Card => raiderCard('Pot Shot', 'enemy_single', [{ type: 'damage', value: 3, range, target: 'target', always_hits: true }]);

const P_INSIDE = RoadLane.PLAYER_INSIDE;
const P_OUTSIDE = RoadLane.PLAYER_OUTSIDE;
const E_INSIDE = RoadLane.ENEMY_INSIDE;
const E_SHOULDER = RoadLane.ENEMY_SHOULDER;
const { AHEAD, CENTER, BEHIND } = RoadRow;

describe('Order cards', () => {
	describe('card data', () => {
		test('every order card is tagged order and never attack', () => {
			const orders = cardData.filter(data => data.tags.includes('order'));

			expect(orders.map(data => data.type).sort()).toEqual([
				'close_ranks', 'covering_fire', 'draw_fire', 'flag_down', 'rally_the_convoy',
				'ramming_run', 'run_ahead', 'top_off', 'triage'
			]);
			expect(orders.filter(data => data.tags.includes('attack'))).toEqual([]);
		});

		test('each escort type\'s signature card names it back and is signature rarity', () => {
			const signatures = cardData.filter(data => data.signatureOf);

			expect(signatures.map(data => [data.type, data.signatureOf, data.rarity])).toEqual([
				['triage', 'med_truck', 'signature'],
				['run_ahead', 'outrider', 'signature'],
				['flag_down', 'pilot_car', 'signature'],
				['top_off', 'fuel_hauler', 'signature']
			]);
			for (const type of ['outrider', 'pilot_car', 'fuel_hauler', 'med_truck'] as const) {
				const card = realCard(createEscort({ type }).escort?.signatureCard ?? '');
				expect(card.signatureOf).toBe(type);
			}
		});

		test('a copy remembers the escort that brought it', () => {
			const outrider = createEscort({ type: 'outrider' });
			const card = new Card({ ...cardData.find(data => data.type === 'run_ahead') as CardData, broughtBy: outrider.id });

			expect(card.copy().broughtBy).toBe(outrider.id);
		});
	});

	describe('tie order', () => {
		test('inside before outside before shoulder, then ahead, center, behind', () => {
			const slots = [
				slot(E_SHOULDER, AHEAD),
				slot(P_OUTSIDE, AHEAD),
				slot(P_INSIDE, BEHIND),
				slot(P_INSIDE, AHEAD),
				slot(P_INSIDE, CENTER)
			];

			expect([...slots].sort(compareTieOrder)).toEqual([
				slot(P_INSIDE, AHEAD),
				slot(P_INSIDE, CENTER),
				slot(P_INSIDE, BEHIND),
				slot(P_OUTSIDE, AHEAD),
				slot(E_SHOULDER, AHEAD)
			]);
		});

		test('nearest goes by range first', () => {
			const near = slot(P_INSIDE, BEHIND);
			const far = slot(P_OUTSIDE, AHEAD);

			expect(nearestTo({ to: slot(E_INSIDE, BEHIND), candidates: [far, near], slotOf: candidate => candidate })).toBe(near);
		});
	});

	describe('the escort that carries out an attack order', () => {
		let buggy: Vehicle;

		beforeEach(() => {
			buggy = createDriven('Buggy', slot(E_INSIDE, CENTER));
		});

		// Both escorts sit at range 2 of the Buggy in each case
		test.each([
			['ahead beats behind in the same lane', slot(P_INSIDE, AHEAD), slot(P_INSIDE, BEHIND)],
			['inside beats outside', slot(P_INSIDE, AHEAD), slot(P_OUTSIDE, CENTER)]
		])('on a tie, %s', (_case, winnerSlot, loserSlot) => {
			const loser = escortAt('pilot_car', loserSlot);
			const winner = escortAt('pilot_car', winnerSlot);
			const rig = createDriven('Rig', slot(P_INSIDE, CENTER));
			const bike = createDriven('Bike', slot(P_OUTSIDE, BEHIND));
			const battle = createBattle([rig, bike, loser, winner], [buggy]);

			expect(battle.orderCarrier({ card: realCard('covering_fire'), target: buggy })).toBe(winner);
		});

		test('on a tie, the outside lane beats the raiders\' shoulder', () => {
			const onShoulder = escortAt('outrider', slot(E_SHOULDER, CENTER), true);
			const outside = escortAt('pilot_car', slot(P_OUTSIDE, CENTER));
			const battle = createBattle([createDriven('Rig'), createDriven('Bike'), onShoulder, outside], [buggy]);

			expect(battle.orderCarrier({ card: realCard('covering_fire'), target: buggy })).toBe(outside);
		});

		test('a closer escort beats the tie order', () => {
			const behindNear = escortAt('pilot_car', slot(P_INSIDE, CENTER));
			const insideAhead = escortAt('outrider', slot(P_INSIDE, AHEAD));
			const battle = createBattle([createDriven('Rig'), createDriven('Bike'), insideAhead, behindNear], [buggy]);

			expect(battle.orderCarrier({ card: realCard('covering_fire'), target: buggy })).toBe(behindNear);
		});

		test('a spent escort is passed over for the next nearest ready one', () => {
			const near = escortAt('pilot_car', slot(P_INSIDE, AHEAD));
			const far = escortAt('outrider', slot(P_OUTSIDE, CENTER));
			const battle = createBattle([createDriven('Rig'), createDriven('Bike'), near, far], [buggy]);
			near.spent = true;

			expect(battle.orderCarrier({ card: realCard('covering_fire'), target: buggy })).toBe(far);
		});

		test('an escort out of the card\'s range can\'t carry it, so the raider isn\'t a legal target', () => {
			const rig = createDriven('Rig');
			// Outside ahead is range 3 from enemy inside center; Covering Fire reaches 2
			const pilotCar = escortAt('pilot_car', slot(P_OUTSIDE, AHEAD));
			const battle = createBattle([rig, createDriven('Bike'), pilotCar], [buggy]);
			const card = realCard('covering_fire');

			expect(battle.orderCarrier({ card, target: buggy })).toBeNull();
			expect(battle.getTargetBlocker({ driver: driverOf(rig), card, target: buggy }))
				.toBe('No ready escort can carry out Covering Fire on Buggy');
			expect(play({ battle, driver: driverOf(rig), card, target: buggy })).toBe(false);
			expect(driverOf(rig).hand).toEqual([card]);
			expect(driverOf(rig).adrenaline).toBe(5);
			expect(pilotCar.spent).toBe(false);
		});

		test('with no escorts at all, an attack order has no legal target', () => {
			const rig = createDriven('Rig');
			const battle = createBattle([rig, createDriven('Bike')], [buggy]);

			expect(play({ battle, driver: driverOf(rig), card: realCard('covering_fire'), target: buggy })).toBe(false);
		});
	});

	describe('passengers', () => {
		test('a passenger can play an order but not an attack', () => {
			const rig = createDriven('Rig');
			const bike = createDriven('Bike');
			const outrider = escortAt('outrider');
			const buggy = createDriven('Buggy');
			const battle = createBattle([rig, bike, outrider], [buggy]);
			const rider = driverOf(bike);
			bike.destroy();
			battle.playerTeam.handleVehicleDestruction(bike);
			expect(rider.role).toBe(DriverRole.PASSENGER);

			expect(play({ battle, driver: rider, card: potShot(), target: buggy })).toBe(false);
			expect(play({ battle, driver: rider, card: realCard('covering_fire'), target: buggy })).toBe(true);
			expect(outrider.spent).toBe(true);
		});
	});

	describe('ready and spent', () => {
		test('escorts start the fight ready, whatever they ended the last one as', () => {
			const outrider = escortAt('outrider');
			outrider.spent = true;
			const battle = createBattle([createDriven('Rig'), createDriven('Bike'), outrider], [createDriven('Buggy')]);

			battle.start();

			expect(outrider.isReady).toBe(true);
		});

		test('a spent escort is ready again at the start of the player\'s next turn', async () => {
			const rig = createDriven('Rig');
			const outrider = escortAt('outrider');
			const buggy = createDriven('Buggy');
			const battle = createBattle([rig, createDriven('Bike'), outrider], [buggy]);

			play({ battle, driver: driverOf(rig), card: realCard('covering_fire'), target: buggy });
			expect(outrider.spent).toBe(true);
			expect(outrider.isReady).toBe(false);

			await battle.endPlayerTurn();

			expect(battle.isPlayerTurn).toBe(true);
			expect(outrider.isReady).toBe(true);
		});

		test('an escort acts once a turn', () => {
			const rig = createDriven('Rig');
			const outrider = escortAt('outrider');
			const buggy = createDriven('Buggy');
			const battle = createBattle([rig, createDriven('Bike'), outrider], [buggy]);

			expect(play({ battle, driver: driverOf(rig), card: realCard('covering_fire'), target: buggy })).toBe(true);
			expect(play({ battle, driver: driverOf(rig), card: realCard('covering_fire'), target: buggy })).toBe(false);
		});

		test('a wrecked escort is never ready', () => {
			const outrider = escortAt('outrider');
			outrider.destroy();

			expect(outrider.isReady).toBe(false);
		});
	});

	describe('Covering Fire', () => {
		test('the nearest ready escort shoots with its own gunnery for 3 and is spent', () => {
			const rig = createDriven('Rig');
			const outrider = escortAt('outrider');
			const buggy = createDriven('Buggy');
			const battle = createBattle([rig, createDriven('Bike'), outrider], [buggy]);
			// The ordering driver couldn't hit anything; the Outrider's 6 beats evade 5
			setSkills(rig, { gunnery: 0 });

			expect(play({ battle, driver: driverOf(rig), card: realCard('covering_fire'), target: buggy })).toBe(true);

			// 3 past no armor: 2 to structure, 2 to the driver
			expect(buggy.structure).toBe(18);
			expect(outrider.spent).toBe(true);
			expect(logLines(battle, 'general')).toContain('Outrider carries out Covering Fire on Buggy');
		});

		test('a miss still spends the escort', () => {
			const rig = createDriven('Rig');
			const pilotCar = escortAt('pilot_car', slot(P_INSIDE, AHEAD));
			const buggy = createDriven('Buggy');
			const battle = createBattle([rig, createDriven('Bike'), pilotCar], [buggy]);

			// Pilot Car gunnery 5 doesn't beat evade 5
			expect(play({ battle, driver: driverOf(rig), card: realCard('covering_fire'), target: buggy })).toBe(true);

			expect(buggy.structure).toBe(20);
			expect(logLines(battle, 'miss')).toEqual(['Covering Fire misses Buggy']);
			expect(pilotCar.spent).toBe(true);
		});
	});

	describe('Ramming Run', () => {
		const setup = (): { battle: Battle; rig: Vehicle; pilotCar: Vehicle; buggy: Vehicle } => {
			const rig = createDriven('Rig', slot(P_INSIDE, BEHIND));
			const pilotCar = escortAt('pilot_car', slot(P_INSIDE, CENTER));
			const buggy = createDriven('Buggy', slot(E_INSIDE, CENTER));
			buggy.set({ baseSpeed: 1 });
			const battle = createBattle([rig, createDriven('Bike', slot(P_OUTSIDE, BEHIND)), pilotCar], [buggy]);
			return { battle, rig, pilotCar, buggy };
		};

		test('on a hit the escort rams for 4 plus the speed gap and takes 2 structure, past its armor', () => {
			const { battle, rig, pilotCar, buggy } = setup();
			// Pilot Car ramming 4 >= evade 4
			setSkills(buggy, { evade: 4 });

			expect(play({ battle, driver: driverOf(rig), card: realCard('ramming_run'), target: buggy })).toBe(true);

			// 4 + (Pilot Car 4 - Buggy 3) = 5, 3 of it to structure
			expect(buggy.structure).toBe(17);
			expect(pilotCar.armor).toBe(3);
			expect(pilotCar.structure).toBe(28);
			expect(pilotCar.spent).toBe(true);
		});

		test('on a miss there is no collision: no self damage, and the escort is still spent', () => {
			const { battle, rig, pilotCar, buggy } = setup();

			expect(play({ battle, driver: driverOf(rig), card: realCard('ramming_run'), target: buggy })).toBe(true);

			expect(logLines(battle, 'miss')).toEqual(['Ramming Run misses Buggy']);
			expect(buggy.structure).toBe(20);
			expect(pilotCar.structure).toBe(30);
			expect(pilotCar.spent).toBe(true);
		});

		test('reaches only range 1', () => {
			const rig = createDriven('Rig');
			const pilotCar = escortAt('pilot_car', slot(P_OUTSIDE, CENTER));
			const buggy = createDriven('Buggy', slot(E_INSIDE, CENTER));
			const battle = createBattle([rig, createDriven('Bike'), pilotCar], [buggy]);

			expect(battle.orderCarrier({ card: realCard('ramming_run'), target: buggy })).toBeNull();
		});
	});

	describe('Close Ranks', () => {
		test('gives a full-armor escort 6 Shield, stacking, and doesn\'t spend it', () => {
			const rig = createDriven('Rig');
			const hauler = escortAt('fuel_hauler');
			const battle = createBattle([rig, createDriven('Bike'), hauler], [createDriven('Buggy')]);

			expect(play({ battle, driver: driverOf(rig), card: realCard('close_ranks'), target: hauler })).toBe(true);
			expect(hauler.armor).toBe(5);
			expect(hauler.shield).toBe(6);
			expect(hauler.spent).toBe(false);

			expect(play({ battle, driver: driverOf(rig), card: realCard('close_ranks'), target: hauler })).toBe(true);
			expect(hauler.shield).toBe(12);
		});

		test('works on the Outrider, which has no armor, and on a spent escort', () => {
			const rig = createDriven('Rig');
			const outrider = escortAt('outrider');
			const battle = createBattle([rig, createDriven('Bike'), outrider], [createDriven('Buggy')]);
			outrider.spent = true;

			expect(play({ battle, driver: driverOf(rig), card: realCard('close_ranks'), target: outrider })).toBe(true);
			expect(outrider.armor).toBe(0);
			expect(outrider.shield).toBe(6);
			expect(outrider.spent).toBe(true);
		});

		test('targets only an escort in your own convoy', () => {
			const rig = createDriven('Rig');
			const bike = createDriven('Bike');
			const buggy = createDriven('Buggy');
			const battle = createBattle([rig, bike, escortAt('fuel_hauler')], [buggy]);
			const card = realCard('close_ranks');

			expect(battle.getTargetBlocker({ driver: driverOf(rig), card, target: bike })).toBe('Bike is not an escort in your convoy');
			expect(battle.getTargetBlocker({ driver: driverOf(rig), card, target: buggy })).toBe('Buggy is not an escort in your convoy');
		});
	});

	describe('Draw Fire', () => {
		// Rig and Pilot Car share the center row. FirstPlayableAI aims at the
		// first vehicle in the player's roster, the Rig.
		const setup = (): { battle: Battle; rig: Vehicle; pilotCar: Vehicle; buggy: Vehicle } => {
			const rig = createDriven('Rig', slot(P_INSIDE, CENTER));
			const bike = createDriven('Bike', slot(P_INSIDE, BEHIND));
			const pilotCar = escortAt('pilot_car', slot(P_OUTSIDE, CENTER));
			const buggy = createDriven('Buggy', slot(E_INSIDE, CENTER));
			const battle = createBattle([rig, bike, pilotCar], [buggy]);
			return { battle, rig, pilotCar, buggy };
		};

		const planShot = (battle: Battle, buggy: Vehicle, card: Card): void => {
			driverOf(buggy).set({ hand: [card], adrenaline: 5 });
			battle.planEnemyTurn();
		};

		test('turns a raider\'s shot at a driven vehicle in its row onto the escort, whose Shield takes it first', async () => {
			const { battle, rig, pilotCar, buggy } = setup();
			planShot(battle, buggy, potShot());
			expect(battle.getIntents(buggy)[0].target).toBe(rig.id);

			expect(play({ battle, driver: driverOf(rig), card: realCard('draw_fire'), target: pilotCar })).toBe(true);
			// At full armor, so the 4 is all Shield
			expect(pilotCar.armor).toBe(3);
			expect(pilotCar.shield).toBe(4);
			expect(pilotCar.spent).toBe(true);
			expect(battle.getIntents(buggy)[0].target).toBe(pilotCar.id);

			await battle.endPlayerTurn();

			expect(rig.structure).toBe(20);
			expect(logLines(battle, 'general')).toContain("Pilot Car draws Buggy's Pot Shot away from Rig");
			expect(logLines(battle, 'damage_dealt')).toContain(
				'Pot Shot deals 3 total (3 to shield) damage to Pilot Car (Structure: 30/30 -> 30/30, Armor: 3/3 -> 3/3, Shield: 4 -> 1)'
			);
			// The rest wore off at the start of the player's turn
			expect(pilotCar.armor).toBe(3);
			expect(pilotCar.shield).toBe(0);
		});

		test('a card that can\'t reach the escort keeps its target; Draw Fire never cancels', async () => {
			const { battle, rig, pilotCar, buggy } = setup();
			// Range 1 reaches the Rig but not the Pilot Car, two lanes over
			planShot(battle, buggy, potShot(1));

			play({ battle, driver: driverOf(rig), card: realCard('draw_fire'), target: pilotCar });
			expect(battle.getIntents(buggy)[0].target).toBe(rig.id);
			await battle.endPlayerTurn();

			expect(rig.structure).toBe(18);
			expect(logLines(battle, 'fizzle')).toEqual([]);
		});

		test('a Headshot can\'t reach an empty escort, so it stays on its driver', () => {
			const { battle, rig, pilotCar, buggy } = setup();
			const headshot = raiderCard('Headshot', 'enemy_single', [{ type: 'damage', value: 2, target: 'driver', always_hits: true }]);
			planShot(battle, buggy, headshot);

			play({ battle, driver: driverOf(rig), card: realCard('draw_fire'), target: pilotCar });

			expect(battle.getIntents(buggy)[0].target).toBe(rig.id);
		});

		test('covers only its own row', () => {
			const { battle, rig, buggy } = setup();
			const behindEscort = escortAt('med_truck', slot(P_OUTSIDE, BEHIND));
			battle.playerTeam.addVehicle(behindEscort);
			planShot(battle, buggy, potShot());

			play({ battle, driver: driverOf(rig), card: realCard('draw_fire'), target: behindEscort });

			expect(battle.getIntents(buggy)[0].target).toBe(rig.id);
		});

		test('an area hit isn\'t pulled: it lands on everything as planned, the escort drawing fire included', async () => {
			const { battle, rig, pilotCar, buggy } = setup();
			const bike = battle.playerTeam.vehicles[1];
			const blast = raiderCard('Blast', 'enemy_all', [{ type: 'damage', value: 3, target: 'enemy_all', always_hits: true }]);
			planShot(battle, buggy, blast);

			play({ battle, driver: driverOf(rig), card: realCard('draw_fire'), target: pilotCar });
			expect(battle.getIntents(buggy)[0].target).toBe('both');

			await battle.endPlayerTurn();

			// Each driven vehicle takes its own 3 (split with the driver), and the
			// escort takes one 3 on its Shield, not the Rig's hit as well
			expect(rig.structure).toBe(18);
			expect(bike.structure).toBe(18);
			expect(logLines(battle, 'damage_dealt')).toContain(
				'Blast deals 3 total (3 to shield) damage to Pilot Car (Structure: 30/30 -> 30/30, Armor: 3/3 -> 3/3, Shield: 4 -> 1)'
			);
			expect(logLines(battle, 'general').filter(line => line.includes('draws'))).toEqual([]);
		});

		test('when two Draw Fires cover the same row, the last one played wins', () => {
			const { battle, rig, pilotCar, buggy } = setup();
			const ally = escortAt('outrider', slot(E_SHOULDER, CENTER), true);
			battle.playerTeam.addVehicle(ally);
			planShot(battle, buggy, potShot());

			play({ battle, driver: driverOf(rig), card: realCard('draw_fire'), target: pilotCar });
			play({ battle, driver: driverOf(rig), card: realCard('draw_fire'), target: ally });
			expect(battle.getIntents(buggy)[0].target).toBe(ally.id);

			play({ battle, driver: driverOf(rig), card: realCard('draw_fire'), target: pilotCar });
			expect(battle.getIntents(buggy)[0].target).toBe(pilotCar.id);
		});

		test('a cover wrecked mid enemy turn hands the row back to the living one played before it', async () => {
			const { battle, rig, pilotCar, buggy } = setup();
			const ally = escortAt('outrider', slot(E_SHOULDER, CENTER), true);
			battle.playerTeam.addVehicle(ally);
			ally.set({ structure: 1 });
			// Enough to go through the Outrider's 4 Shield
			const bigShot = raiderCard('Big Shot', 'enemy_single', [{ type: 'damage', value: 10, range: 10, target: 'target', always_hits: true }]);
			driverOf(buggy).set({ hand: [bigShot, potShot()], adrenaline: 5 });
			battle.planEnemyTurn();

			play({ battle, driver: driverOf(rig), card: realCard('draw_fire'), target: pilotCar });
			play({ battle, driver: driverOf(rig), card: realCard('draw_fire'), target: ally });
			await battle.endPlayerTurn();

			// The first shot wrecks the Outrider; the second goes to the Pilot Car, not the Rig
			expect(ally.isAlive()).toBe(false);
			expect(rig.structure).toBe(20);
			expect(logLines(battle, 'general')).toContain("Pilot Car draws Buggy's Pot Shot away from Rig");
		});

		test('a cover wrecked during the player turn: the preview and the play both go to the living cover', async () => {
			const { battle, rig, pilotCar, buggy } = setup();
			const ally = escortAt('outrider', slot(E_SHOULDER, CENTER), true);
			battle.playerTeam.addVehicle(ally);
			planShot(battle, buggy, potShot());

			play({ battle, driver: driverOf(rig), card: realCard('draw_fire'), target: pilotCar });
			play({ battle, driver: driverOf(rig), card: realCard('draw_fire'), target: ally });
			ally.destroy();
			battle.playerTeam.handleVehicleDestruction(ally);

			expect(battle.getIntents(buggy)[0].target).toBe(pilotCar.id);
			await battle.endPlayerTurn();

			// clearWrecks took the Outrider's slot before the shot played
			expect(ally.slot).toBeNull();
			expect(rig.structure).toBe(20);
			expect(logLines(battle, 'general')).toContain("Pilot Car draws Buggy's Pot Shot away from Rig");
		});

		test('lasts until the end of the next enemy turn', async () => {
			const { battle, rig, pilotCar, buggy } = setup();
			planShot(battle, buggy, potShot());
			play({ battle, driver: driverOf(rig), card: realCard('draw_fire'), target: pilotCar });

			await battle.endPlayerTurn();
			planShot(battle, buggy, potShot());

			expect(battle.getIntents(buggy)[0].target).toBe(rig.id);
		});

		test('can target a spent escort', () => {
			const { battle, rig, pilotCar } = setup();
			pilotCar.spent = true;

			expect(play({ battle, driver: driverOf(rig), card: realCard('draw_fire'), target: pilotCar })).toBe(true);
		});
	});

	describe('Triage', () => {
		test('heals the driver of the target vehicle, or the passenger picked, and doesn\'t spend the Med Truck', () => {
			const rig = createDriven('Rig');
			const medTruck = escortAt('med_truck');
			const battle = createBattle([rig, createDriven('Bike'), medTruck], [createDriven('Buggy')]);
			const rider = createTestDriver('Rider');
			rig.passenger = rider;
			driverOf(rig).set({ hitpoints: 1 });
			rider.set({ hitpoints: 1 });

			expect(play({ battle, driver: driverOf(rig), card: realCard('triage'), target: rig })).toBe(true);
			// Heals up to starting HP (5)
			expect(driverOf(rig).hitpoints).toBe(5);
			expect(rider.hitpoints).toBe(1);

			expect(play({ battle, driver: driverOf(rig), card: realCard('triage'), target: rig, targetOccupant: rider })).toBe(true);
			expect(rider.hitpoints).toBe(5);
			expect(medTruck.spent).toBe(false);
		});

		test('can\'t pick someone who isn\'t aboard the target', () => {
			const rig = createDriven('Rig');
			const bike = createDriven('Bike');
			const battle = createBattle([rig, bike, escortAt('med_truck')], [createDriven('Buggy')]);

			expect(play({ battle, driver: driverOf(rig), card: realCard('triage'), target: rig, targetOccupant: driverOf(bike) })).toBe(false);
		});

		test('needs a living Med Truck; a spent one will do', () => {
			const rig = createDriven('Rig');
			const medTruck = escortAt('med_truck');
			const battle = createBattle([rig, createDriven('Bike'), medTruck], [createDriven('Buggy')]);
			const triage = realCard('triage');

			medTruck.spent = true;
			expect(battle.canPlayCard({ driver: driverOf(rig), card: triage })).toBe(true);

			medTruck.destroy();
			expect(battle.canPlayCard({ driver: driverOf(rig), card: triage })).toBe(false);
			expect(battle.getCardBlocker({ driver: driverOf(rig), card: triage })).toBe('Triage needs a living Med Truck in the convoy');
			expect(play({ battle, driver: driverOf(rig), card: triage, target: rig })).toBe(false);
		});

		test('any living Med Truck will do when another is wrecked', () => {
			const rig = createDriven('Rig');
			const first = escortAt('med_truck');
			const second = escortAt('med_truck');
			const battle = createBattle([rig, createDriven('Bike'), first, second], [createDriven('Buggy')]);
			first.destroy();

			expect(battle.canPlayCard({ driver: driverOf(rig), card: realCard('triage') })).toBe(true);
		});
	});

	describe('Rally the Convoy', () => {
		test('ready escorts fire in roster order, each at its nearest raider still in the fight, then all are spent', () => {
			const lead = escortAt('outrider', slot(P_INSIDE, AHEAD));
			const second = escortAt('pilot_car', slot(P_INSIDE, CENTER));
			const hauler = escortAt('fuel_hauler', slot(P_OUTSIDE, AHEAD));
			const spent = escortAt('med_truck', slot(P_OUTSIDE, CENTER));
			spent.spent = true;
			const rig = createDriven('Rig', slot(P_INSIDE, BEHIND));
			const bike = createDriven('Bike', slot(P_OUTSIDE, BEHIND));
			const weak = createDriven('Weak', slot(E_INSIDE, AHEAD));
			const tough = createDriven('Tough', slot(E_INSIDE, BEHIND));
			weak.set({ structure: 1 });
			setSkills(weak, { evade: 0 });
			setSkills(tough, { evade: 0 });
			const battle = createBattle([rig, bike, lead, second, hauler, spent], [weak, tough]);
			const rally = realCard('rally_the_convoy');

			expect(play({ battle, driver: driverOf(rig), card: rally })).toBe(true);

			// The Outrider wrecks Weak. The Pilot Car is range 2 from both and
			// would have tied onto Weak (ahead first), so it picks again: Tough.
			// The Hauler has nothing within range 2. The spent Med Truck sits out.
			expect(weak.isAlive()).toBe(false);
			expect(tough.structure).toBe(19);
			expect(logLines(battle, 'general')).toEqual(expect.arrayContaining([
				'Outrider fires on Weak',
				'Pilot Car fires on Tough',
				'Fuel Hauler has no raider within range 2'
			]));
			expect(logLines(battle, 'general').some(line => line.startsWith('Med Truck'))).toBe(false);
			expect([lead, second, hauler, spent].every(escort => escort.spent)).toBe(true);
		});

		test('exhausts: out of the discard for the rest of the fight', () => {
			const rig = createDriven('Rig');
			const battle = createBattle([rig, createDriven('Bike'), escortAt('outrider')], [createDriven('Buggy')]);
			const rally = realCard('rally_the_convoy');

			play({ battle, driver: driverOf(rig), card: rally });

			expect(driverOf(rig).discard).not.toContain(rally);
			expect(driverOf(rig).exhausted).toEqual([rally]);
		});

		test('comes back to the deck when the fight ends, so the next fight has it again', () => {
			const rig = createDriven('Rig');
			const battle = createBattle([rig, createDriven('Bike'), escortAt('outrider')], [createDriven('Buggy')]);
			const driver = driverOf(rig);
			const rally = realCard('rally_the_convoy');
			play({ battle, driver, card: rally });

			battle.endCombat();

			expect(driver.exhausted).toEqual([]);
			expect(driver.deck?.cards).toContain(rally);
		});

		test('needs a ready escort', () => {
			const rig = createDriven('Rig');
			const outrider = escortAt('outrider');
			const battle = createBattle([rig, createDriven('Bike'), outrider], [createDriven('Buggy')]);
			outrider.spent = true;

			expect(play({ battle, driver: driverOf(rig), card: realCard('rally_the_convoy') })).toBe(false);
			expect(logLines(battle, 'general')).toContain('Cannot play card: Rally the Convoy needs a ready escort');
		});
	});

	describe('Run Ahead', () => {
		// Buggy at 5, the Rust Buggy's speed: an Outrider ties it and can't flank without the boost
		const setup = (): { battle: Battle; rig: Vehicle; outrider: Vehicle; buggy: Vehicle } => {
			const rig = createDriven('Rig');
			const outrider = escortAt('outrider');
			const buggy = createDriven('Buggy', slot(E_INSIDE, CENTER));
			buggy.set({ baseSpeed: 3 });
			const battle = createBattle([rig, createDriven('Bike'), outrider], [buggy]);
			return { battle, rig, outrider, buggy };
		};

		test('the Outrider gains 2 speed, flanks a raider it ties, and is spent', () => {
			const { battle, rig, outrider, buggy } = setup();
			const startSlot = outrider.slot;
			expect(battle.canFlank(outrider, buggy)).toBe(false);

			expect(play({ battle, driver: driverOf(rig), card: realCard('run_ahead'), target: buggy })).toBe(true);

			expect(outrider.speed).toBe(7);
			expect(outrider.slot).toEqual(slot(E_SHOULDER, CENTER));
			expect(outrider.flank).toEqual({ reservedSlot: startSlot, outran: buggy });
			expect(outrider.spent).toBe(true);
		});

		test('holds the shoulder at the end of the turn while the boost lasts', async () => {
			const { battle, rig, outrider, buggy } = setup();
			play({ battle, driver: driverOf(rig), card: realCard('run_ahead'), target: buggy });

			await battle.endPlayerTurn();

			expect(outrider.isFlanking).toBe(true);
		});

		test('a raider whose shoulder slot is taken isn\'t a legal target, and the card stays in hand', () => {
			const { battle, rig, outrider, buggy } = setup();
			const ally = escortAt('pilot_car', slot(E_SHOULDER, CENTER), true);
			battle.playerTeam.addVehicle(ally);
			ally.set({ slot: slot(E_SHOULDER, CENTER), flank: { reservedSlot: null, outran: null } });
			const runAhead = realCard('run_ahead');

			expect(play({ battle, driver: driverOf(rig), card: runAhead, target: buggy })).toBe(false);
			expect(driverOf(rig).hand).toEqual([runAhead]);
			expect(outrider.spent).toBe(false);
		});

		test('a raider even the boosted Outrider can\'t outrun isn\'t a legal target', () => {
			const { battle, rig, buggy } = setup();
			buggy.set({ baseSpeed: 6 });

			expect(battle.getTargetBlocker({ driver: driverOf(rig), card: realCard('run_ahead'), target: buggy }))
				.toBe('No ready Outrider can carry out Run Ahead on Buggy');
		});

		test('only an Outrider carries it out, the nearest ready one that can flank', () => {
			const rig = createDriven('Rig', slot(P_INSIDE, BEHIND));
			const pilotCar = escortAt('pilot_car', slot(P_INSIDE, CENTER));
			const farOutrider = escortAt('outrider', slot(P_OUTSIDE, BEHIND));
			const nearOutrider = escortAt('outrider', slot(P_INSIDE, AHEAD));
			const buggy = createDriven('Buggy', slot(E_INSIDE, CENTER));
			const battle = createBattle([rig, createDriven('Bike', slot(P_OUTSIDE, AHEAD)), pilotCar, farOutrider, nearOutrider], [buggy]);
			const runAhead = realCard('run_ahead');

			expect(battle.orderCarrier({ card: runAhead, target: buggy })).toBe(nearOutrider);
			nearOutrider.spent = true;
			expect(battle.orderCarrier({ card: runAhead, target: buggy })).toBe(farOutrider);
		});

		test('needs a living Outrider in the convoy', () => {
			const rig = createDriven('Rig');
			const buggy = createDriven('Buggy');
			const battle = createBattle([rig, createDriven('Bike'), escortAt('pilot_car')], [buggy]);

			expect(battle.getCardBlocker({ driver: driverOf(rig), card: realCard('run_ahead') })).toBe('Run Ahead needs a living Outrider in the convoy');
		});
	});

	describe('Flag Down', () => {
		const setup = (): { battle: Battle; rig: Vehicle; pilotCar: Vehicle; buggy: Vehicle } => {
			const rig = createDriven('Rig', slot(P_INSIDE, CENTER));
			const pilotCar = escortAt('pilot_car', slot(P_OUTSIDE, AHEAD));
			const buggy = createDriven('Buggy', slot(E_INSIDE, AHEAD));
			// Evade 10: nothing that rolls could land
			setSkills(buggy, { evade: 10 });
			const battle = createBattle([rig, createDriven('Bike', slot(P_INSIDE, BEHIND)), pilotCar], [buggy]);
			return { battle, rig, pilotCar, buggy };
		};

		test('always hits: the raider is Vulnerable and 2 slower, and the Pilot Car is spent', () => {
			const { battle, rig, pilotCar, buggy } = setup();

			expect(play({ battle, driver: driverOf(rig), card: realCard('flag_down'), target: buggy })).toBe(true);

			expect(buggy.hasStatusEffect('vulnerable')).toBe(true);
			expect(buggy.speed).toBe(2);
			expect(pilotCar.spent).toBe(true);
		});

		test('lasts through the next enemy turn, long enough for a driver to flank and hold', async () => {
			const { battle, rig, buggy } = setup();
			play({ battle, driver: driverOf(rig), card: realCard('flag_down'), target: buggy });

			// Rig 4 against the slowed Buggy's 2
			expect(play({ battle, driver: driverOf(rig), card: realCard('flank'), target: buggy })).toBe(true);
			await battle.endPlayerTurn();

			// Dropped back only if the slow had worn off before the enemy turn ended
			expect(rig.isFlanking).toBe(true);
			expect(buggy.hasStatusEffect('vulnerable')).toBe(false);
			expect(buggy.speed).toBe(4);
		});

		test('reaches range 2 from a Pilot Car', () => {
			const { battle, buggy } = setup();
			buggy.set({ slot: slot(E_INSIDE, BEHIND) });

			expect(battle.orderCarrier({ card: realCard('flag_down'), target: buggy })).toBeNull();
		});
	});

	describe('Shield', () => {
		test('stacks, isn\'t capped by max armor, and soaks damage before armor', () => {
			const hauler = escortAt('fuel_hauler');
			hauler.addShield(4);
			hauler.addShield(3);
			expect(hauler.shield).toBe(7);

			hauler.takeDamage(10);

			// 7 to Shield, 3 of the 5 armor, nothing to structure
			expect(hauler.shield).toBe(0);
			expect(hauler.armor).toBe(2);
			expect(hauler.structure).toBe(40);
		});

		test('past Shield and armor, damage splits as before', () => {
			const rig = createDriven('Rig');
			rig.set({ armor: 2, maxArmor: 2 });
			rig.addShield(2);

			rig.takeDamage(8);

			expect(rig.structure).toBe(18);
			expect(driverOf(rig).hitpoints).toBe(3);
		});

		test('structure-only damage skips it: Ramming Run\'s cost leaves the Shield alone', () => {
			const rig = createDriven('Rig', slot(P_INSIDE, BEHIND));
			const pilotCar = escortAt('pilot_car', slot(P_INSIDE, CENTER));
			const buggy = createDriven('Buggy', slot(E_INSIDE, CENTER));
			setSkills(buggy, { evade: 4 });
			const battle = createBattle([rig, createDriven('Bike', slot(P_OUTSIDE, BEHIND)), pilotCar], [buggy]);
			pilotCar.addShield(6);

			expect(play({ battle, driver: driverOf(rig), card: realCard('ramming_run'), target: buggy })).toBe(true);

			expect(pilotCar.shield).toBe(6);
			expect(pilotCar.structure).toBe(28);
		});

		test('a driver-only hit skips it', () => {
			const rig = createDriven('Rig');
			const buggy = createDriven('Buggy');
			const battle = createBattle([rig, createDriven('Bike')], [buggy]);
			buggy.addShield(5);
			const headshot = raiderCard('Headshot', 'enemy_single', [{ type: 'damage', value: 2, target: 'driver', always_hits: true }]);

			expect(play({ battle, driver: driverOf(rig), card: headshot, target: buggy })).toBe(true);

			expect(buggy.shield).toBe(5);
			expect(driverOf(buggy).hitpoints).toBe(3);
		});

		test('lasts through the enemy turn and clears at the start of the player\'s, on both sides', async () => {
			const rig = createDriven('Rig');
			const hauler = escortAt('fuel_hauler');
			const buggy = createDriven('Buggy');
			const battle = createBattle([rig, createDriven('Bike'), hauler], [buggy]);
			buggy.addShield(2);
			play({ battle, driver: driverOf(rig), card: realCard('close_ranks'), target: hauler });

			let shieldAtEnemyTurnEnd = -1;
			battle.on('battleMessage', message => {
				if (message.type === 'turn_end' && message.message === 'Ending enemy turn') shieldAtEnemyTurnEnd = hauler.shield ?? 0;
			});
			await battle.endPlayerTurn();

			expect(shieldAtEnemyTurnEnd).toBe(6);
			expect(hauler.shield).toBe(0);
			expect(buggy.shield).toBe(0);
		});

		test('clears when the fight starts', () => {
			const hauler = escortAt('fuel_hauler');
			hauler.addShield(9);
			const battle = createBattle([createDriven('Rig'), createDriven('Bike'), hauler], [createDriven('Buggy')]);

			battle.start();

			expect(hauler.shield).toBe(0);
		});

		test('the preview and the Ram formula ignore it, and play takes it off first', async () => {
			const hauler = escortAt('fuel_hauler');
			const buggy = createDriven('Buggy');
			const battle = createBattle([hauler, createDriven('Rig'), createDriven('Bike')], [buggy]);
			buggy.set({ armor: 40, maxArmor: 40 });
			buggy.addShield(50);
			setSkills(buggy, { speed: 3 });
			hauler.addShield(4);
			const ram = raiderCard('Ram', 'enemy_single', [{ type: 'damage', value: 0, formula: 'armor/10 + (speed_diff)', attack_type: 'ramming', range: 10, target: 'target' }]);
			driverOf(buggy).set({ hand: [ram], adrenaline: 5 });
			battle.planEnemyTurn();

			// 40 armor / 10 (not 90 / 10), plus Buggy 5 against the Hauler's 2
			expect(battle.getIntents(buggy)[0]).toMatchObject({ amount: 7, target: hauler.id });
			await battle.endPlayerTurn();

			expect(logLines(battle, 'damage_dealt')).toContain(
				'Ram deals 7 total (4 to shield, 3 to armor) damage to Fuel Hauler (Structure: 40/40 -> 40/40, Armor: 5/5 -> 2/5, Shield: 4 -> 0)'
			);
		});
	});

	describe('Top Off', () => {
		test('gives the driver of the target vehicle, or the passenger picked, 1 adrenaline for nothing', () => {
			const rig = createDriven('Rig');
			const bike = createDriven('Bike');
			const hauler = escortAt('fuel_hauler');
			const battle = createBattle([rig, bike, hauler], [createDriven('Buggy')]);
			const rider = createTestDriver('Rider');
			bike.passenger = rider;
			driverOf(bike).set({ adrenaline: 2 });
			rider.set({ adrenaline: 0 });

			expect(play({ battle, driver: driverOf(rig), card: realCard('top_off'), target: bike })).toBe(true);
			expect(driverOf(bike).adrenaline).toBe(3);
			expect(driverOf(rig).adrenaline).toBe(5);

			expect(play({ battle, driver: driverOf(rig), card: realCard('top_off'), target: bike, targetOccupant: rider })).toBe(true);
			expect(rider.adrenaline).toBe(1);
			expect(hauler.spent).toBe(false);
		});

		test('an empty escort has nobody to fuel', () => {
			const rig = createDriven('Rig');
			const hauler = escortAt('fuel_hauler');
			const battle = createBattle([rig, createDriven('Bike'), hauler], [createDriven('Buggy')]);

			expect(battle.getTargetBlocker({ driver: driverOf(rig), card: realCard('top_off'), target: hauler })).toBe('Fuel Hauler has nobody aboard');
		});

		test('needs a living Fuel Hauler', () => {
			const rig = createDriven('Rig');
			const battle = createBattle([rig, createDriven('Bike')], [createDriven('Buggy')]);

			expect(play({ battle, driver: driverOf(rig), card: realCard('top_off'), target: rig })).toBe(false);
		});
	});
});
