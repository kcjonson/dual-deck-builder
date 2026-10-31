/**
 * @jest-environment jsdom
 */
import { CombatScreen, PreparedCombatMount } from './CombatScreen';
import { createTestContext, injectNow } from '../../../engine/components/testing';
import { Clock } from '../../../engine/animation/Clock';
import { PointerAdapter } from '../../../engine/input/PointerAdapter';
import type { Rect } from '../../../engine/draw/geometry';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { Battle } from '../../mechanics/Battle';
import { Card, CardData } from '../../mechanics/Card';
import type { Driver } from '../../mechanics/Driver';
import { createEscort } from '../../mechanics/Escort';
import { RoadLane, RoadRow, RoadSlot } from '../../mechanics/Road';
import { Team, TeamType } from '../../mechanics/Team';
import { Vehicle } from '../../mechanics/Vehicle';
import { Card as UICard } from '../../ui/Card';
import { SlotTarget } from '../../ui/SlotTarget';
import { Vehicle as UIVehicle } from '../../ui/Vehicle';
import { createTestDriver } from '../../ai/__tests__/test-helpers';
import cardsFile from '../../data/cards.json';

/**
 * DDB-548: slot targeting. A card whose move goes where the player picks
 * offers the legal slots as targets, previews the board from the one under
 * the pointer, and plays with it; Strafe, Fall In, and Shoulder Check take
 * a vehicle and a slot, in the order their effects need them. Played by
 * drag, click, and keyboard, with the movement cards as cards.json has them
 * (DDB-551).
 */

/** A fresh copy of a card as cards.json has it */
const realCard = (type: string) => (): Card => {
	const data = (cardsFile as unknown as { cards: CardData[] }).cards.find(candidate => candidate.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return new Card({ ...data });
};
const juke = realCard('juke');
const strafe = realCard('strafe');
const fallIn = realCard('fall_in');
const leapfrog = realCard('leapfrog');
const shoulderCheck = realCard('shoulder_check');

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const context = createTestContext({
	viewport: { get logical() { return { width: window.innerWidth, height: window.innerHeight }; } },
	clock: new Clock(),
});
const canvas = document.createElement('canvas');
const adapter = new PointerAdapter({ dispatcher: context.dispatcher });

const slot = (lane: RoadLane, row: RoadRow): RoadSlot => ({ lane, row });
const { PLAYER_OUTSIDE, PLAYER_INSIDE, ENEMY_INSIDE, ENEMY_OUTSIDE } = RoadLane;
const { AHEAD, CENTER, BEHIND } = RoadRow;

function flushPromises(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

function vehicle(name: string, at: RoadSlot | null = null): Vehicle {
	const driver = createTestDriver(`${name} Driver`);
	driver.set({ hitpoints: 100, maxHitpoints: 100 });
	return new Vehicle({
		name,
		armor: 0,
		maxArmor: 0,
		structure: 20,
		maxStructure: 20,
		baseSpeed: 3,
		slot: at,
		flank: null,
		velocity: 0,
		driver,
		passenger: null,
		statusEffects: [],
	});
}

/** A Range 1 shot a raider plans at whoever is next to it. */
const pointBlank = (): Card => new Card({
	type: 'point_blank_test',
	name: 'Point Blank',
	summary: 'Point Blank',
	description: 'Point Blank',
	rarity: 'common',
	cost: 1,
	targetType: 'enemy_single',
	effects: [{ type: 'damage', value: 3, range: 1, always_hits: true }],
	tags: ['attack'],
});

function driverOf(of: Vehicle): Driver {
	if (!of.driver) throw new Error(`${of.name} has no driver`);
	return of.driver;
}

interface SlotFight {
	mount: PreparedCombatMount;
	rig: Vehicle;
	bike: Vehicle;
	raiders: Vehicle[];
	escorts: Vehicle[];
}

/**
 * The Rig in your inside center and the Bike behind it, escorts after
 * them, against raiders where each is told to start. The first raider
 * plans a Range 1 shot when `plan` is set.
 */
function slotFight({ raiders = [slot(ENEMY_INSIDE, CENTER)], escorts = [], plan = false }: {
	raiders?: RoadSlot[];
	escorts?: Vehicle[];
	plan?: boolean;
} = {}): SlotFight {
	const rig = vehicle('Rig');
	const bike = vehicle('Bike');
	const raiderVehicles = raiders.map((at, index) => vehicle(`Raider ${index + 1}`, at));
	const battle = new Battle({
		playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig, bike, ...escorts] }),
		enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: raiderVehicles }),
	});
	battle.start();
	if (plan) {
		driverOf(raiderVehicles[0]).set({ hand: [pointBlank()], adrenaline: 5 });
		battle.planEnemyTurn();
	}
	return { mount: { prepare: async () => ({ battle }) }, rig, bike, raiders: raiderVehicles, escorts };
}

const mounted = new Set<CombatScreen>();

async function startCombat(fight: SlotFight): Promise<CombatScreen> {
	const combat = new CombatScreen();
	combat.mount(context, fight.mount);
	mounted.add(combat);
	await flushPromises();
	await flushPromises();
	context.frame.layout();
	return combat;
}

/** Deal `card` into the Rig's driver's hand, with adrenaline to play it. */
function deal(combat: CombatScreen, fight: SlotFight, card: Card): UICard {
	driverOf(fight.rig).set({ hand: [card], adrenaline: 5 });
	combat['updateUIFromBattle']();
	context.frame.layout();
	const element = combat['handLayer'].getCardElementByCard(card);
	if (!element) throw new Error(`${card.name} should be dealt`);
	return element;
}

function inject(...commands: string[]): void {
	expect(injectNow({ canvas, dispatcher: context.dispatcher }, commands).ok).toBe(true);
	context.frame.layout();
}

function press(...keys: string[]): void {
	inject(...keys.flatMap(key => [`keydown,${key}`, `keyup,${key}`]));
}

function centreOf({ x, y, width, height }: Rect): [number, number] {
	return [Math.round(x + width / 2), Math.round(y + height / 2)];
}

function grabPoint(card: UICard): [number, number] {
	const { x, y, height } = card.screenBounds;
	return [Math.round(x + 12), Math.round(y + height / 2)];
}

/** A slot's middle on screen. */
function slotPoint(combat: CombatScreen, at: RoadSlot): [number, number] {
	const road = combat['road'];
	const rect = road.slotRect(at);
	const { x, y } = road.localToScreen({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
	return [Math.round(x), Math.round(y)];
}

function platePoint(combat: CombatScreen, of: Vehicle): [number, number] {
	const token = combat['road'].vehicleView(of.id);
	if (!token) throw new Error(`${of.name} should be on the road`);
	return centreOf(token.plateScreenBounds);
}

function drag(from: [number, number], to: [number, number], { release = true } = {}): void {
	inject(`move,${from[0]},${from[1]}`, `down,${from[0]},${from[1]}`);
	for (let step = 1; step <= 6; step++) {
		const x = Math.round(from[0] + ((to[0] - from[0]) * step) / 6);
		const y = Math.round(from[1] + ((to[1] - from[1]) * step) / 6);
		inject(`move,${x},${y}`);
	}
	if (release) inject(`up,${to[0]},${to[1]}`);
}

function click([x, y]: [number, number]): void {
	inject(`click,${x},${y}`);
}

function targetSlots(combat: CombatScreen): RoadSlot[] {
	return combat['road'].slotTargetViews.filter(target => !target.picked).map(target => target.slot);
}

function slotTarget(combat: CombatScreen, at: RoadSlot): SlotTarget {
	const target = combat['road'].slotTargetAt(at);
	if (!target) throw new Error(`${at.lane} ${at.row} should be a slot target`);
	return target;
}

function token(combat: CombatScreen, of: Vehicle): UIVehicle {
	const view = combat['road'].vehicleView(of.id);
	if (!view) throw new Error(`${of.name} should be on the road`);
	return view;
}

beforeAll(() => {
	jest.spyOn(console, 'log').mockImplementation(() => undefined);
	document.body.appendChild(canvas);
	adapter.attach(canvas);
	Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
	Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 720 });
});

afterAll(() => {
	adapter.detach();
	jest.restoreAllMocks();
});

afterEach(() => {
	for (const combat of mounted) {
		if (combat['isActive']) combat.unmount();
	}
	mounted.clear();
	inject('move,1,1');
});

describe('CombatScreen slot targeting (DDB-548)', () => {
	it('offers only the legal slots, solid under a dragged card, and plays the one it is dropped on', async () => {
		const fight = slotFight();
		const combat = await startCombat(fight);
		const card = deal(combat, fight, juke());
		const playCard = jest.spyOn(Battle.prototype, 'playCard');

		drag(grabPoint(card), slotPoint(combat, slot(PLAYER_INSIDE, AHEAD)), { release: false });
		const model = combat['combatModel'];
		expect(model.isPickingSlot).toBe(true);
		// The Bike holds the slot behind; diagonals and the other team's slots never count
		expect(targetSlots(combat)).toEqual(expect.arrayContaining([slot(PLAYER_OUTSIDE, CENTER), slot(PLAYER_INSIDE, AHEAD)]));
		expect(targetSlots(combat)).toHaveLength(2);
		expect(combat['road'].slotTargetAt(slot(PLAYER_INSIDE, BEHIND))).toBeNull();
		expect(slotTarget(combat, slot(PLAYER_INSIDE, AHEAD)).isSolid).toBe(true);
		expect(slotTarget(combat, slot(PLAYER_OUTSIDE, CENTER)).isSolid).toBe(false);
		expect(context.drag.canDrop).toBe(true);
		// Vehicles aren't targets now, and none dims
		expect(token(combat, fight.raiders[0]).opacity).toBe(1);
		expect(token(combat, fight.bike).focusable).toBe(false);

		inject(`up,${slotPoint(combat, slot(PLAYER_INSIDE, AHEAD)).join(',')}`);
		expect(playCard).toHaveBeenCalledTimes(1);
		expect(playCard.mock.calls[0][0].destination).toEqual(slot(PLAYER_INSIDE, AHEAD));
		expect(fight.rig.slot).toEqual(slot(PLAYER_INSIDE, AHEAD));
		expect(model.selectedCard).toBeNull();
		expect(combat['road'].slotTargetViews).toHaveLength(0);

		playCard.mockRestore();
	});

	it('puts the card back when it is dropped on a slot that is not legal', async () => {
		const fight = slotFight();
		const combat = await startCombat(fight);
		const card = deal(combat, fight, juke());
		const playCard = jest.spyOn(Battle.prototype, 'playCard');

		// Diagonal from the Rig
		drag(grabPoint(card), slotPoint(combat, slot(PLAYER_OUTSIDE, AHEAD)));
		expect(playCard).not.toHaveBeenCalled();
		expect(combat['combatModel'].selectedCard).toBeNull();
		expect(combat['road'].slotTargetViews).toHaveLength(0);

		playCard.mockRestore();
	});

	it('previews the board from a hovered slot: ranges from there, and an intent the move takes out of reach drops out', async () => {
		const fight = slotFight({ plan: true });
		const combat = await startCombat(fight);
		const [raider] = fight.raiders;
		const raiderToken = token(combat, raider);
		expect(raiderToken.intents).toHaveLength(1);
		const card = deal(combat, fight, juke());

		click(grabPoint(card));
		expect(combat['combatModel'].isPickingSlot).toBe(true);
		// Nothing hovered: no readout yet, the plan as it stands
		expect(raiderToken.rangeLabel).toBeNull();

		// Outside center is two from the raider, out of its shot's reach
		inject(`move,${slotPoint(combat, slot(PLAYER_OUTSIDE, CENTER)).join(',')}`);
		expect(combat['combatModel'].focusedSlot).toEqual(slot(PLAYER_OUTSIDE, CENTER));
		expect(raiderToken.rangeLabel).toEqual({ text: 'R2', legal: false });
		expect(raiderToken.intents).toHaveLength(0);
		// The end-turn preview reads the pills, so its total on the Rig goes too
		expect(combat['intentPreview'].incoming.get(fight.rig.id)).toBeUndefined();
		// Only previewed: nothing moved
		expect(fight.rig.slot).toEqual(slot(PLAYER_INSIDE, CENTER));

		// Off the slot, the readout and the plan go back
		inject('move,1,1');
		expect(raiderToken.rangeLabel).toBeNull();
		expect(raiderToken.intents).toHaveLength(1);
		expect(combat['intentPreview'].incoming.get(fight.rig.id)).toBe('-3');

		press('Escape');
		expect(combat['combatModel'].isTargeting).toBe(false);
		expect(combat['road'].slotTargetViews).toHaveLength(0);
		expect(raiderToken.intents).toHaveLength(1);
	});

	it('cancels on a click on a slot that is not a target, and plays on one that is', async () => {
		const fight = slotFight();
		const combat = await startCombat(fight);
		const card = deal(combat, fight, juke());
		const playCard = jest.spyOn(Battle.prototype, 'playCard');

		click(grabPoint(card));
		click(slotPoint(combat, slot(PLAYER_OUTSIDE, AHEAD)));
		expect(combat['combatModel'].isTargeting).toBe(false);
		expect(playCard).not.toHaveBeenCalled();

		click(grabPoint(card));
		click(slotPoint(combat, slot(PLAYER_OUTSIDE, CENTER)));
		expect(playCard).toHaveBeenCalledTimes(1);
		expect(fight.rig.slot).toEqual(slot(PLAYER_OUTSIDE, CENTER));

		playCard.mockRestore();
	});

	describe('Strafe: a slot, then a raider at Range 1 of it', () => {
		// Raider 1 across from the Rig, Raider 2 a row ahead of it
		const strafeFight = (): SlotFight => slotFight({ raiders: [slot(ENEMY_INSIDE, CENTER), slot(ENEMY_INSIDE, AHEAD)] });

		it('reads the hovered slot\'s readout against the card\'s reach, then offers only the raiders in reach of the slot picked', async () => {
			const fight = strafeFight();
			const [across, ahead] = fight.raiders;
			// Strafe rolls gunnery against evade 5, so a sharper eye than the test driver's 5
			driverOf(fight.rig).set({ skills: { ...driverOf(fight.rig).skills, gunnery: 9 } });
			const combat = await startCombat(fight);
			const card = deal(combat, fight, strafe());
			const playCard = jest.spyOn(Battle.prototype, 'playCard');
			const model = combat['combatModel'];

			click(grabPoint(card));
			expect(model.isPickingSlot).toBe(true);
			expect(model.targetableVehicleIds).toEqual([]);
			// Outside center puts no raider at Range 1, so it's too far for the card and isn't offered
			expect(targetSlots(combat)).toEqual([slot(PLAYER_INSIDE, AHEAD)]);
			inject(`move,${slotPoint(combat, slot(PLAYER_INSIDE, AHEAD)).join(',')}`);
			expect(token(combat, ahead).rangeLabel).toEqual({ text: 'R1', legal: true });
			expect(token(combat, across).rangeLabel).toEqual({ text: 'OUT', legal: false });

			click(slotPoint(combat, slot(PLAYER_INSIDE, AHEAD)));
			expect(model.isTargeting).toBe(true);
			expect(model.isPickingSlot).toBe(false);
			expect(model.targetableVehicleIds).toEqual([ahead.id]);
			// The chosen slot holds solid, and no other slot is a target
			const picked = slotTarget(combat, slot(PLAYER_INSIDE, AHEAD));
			expect(picked.picked).toBe(true);
			expect(picked.isSolid).toBe(true);
			expect(targetSlots(combat)).toEqual([]);
			expect(token(combat, ahead).rangeLabel).toEqual({ text: 'R1', legal: true });
			expect(token(combat, across).rangeLabel).toEqual({ text: 'OUT', legal: false });
			expect(token(combat, across).opacity).toBeLessThan(1);
			expect(playCard).not.toHaveBeenCalled();

			click(platePoint(combat, ahead));
			expect(playCard).toHaveBeenCalledTimes(1);
			const [{ targetVehicle, destination }] = playCard.mock.calls[0];
			expect(targetVehicle).toBe(ahead);
			expect(destination).toEqual(slot(PLAYER_INSIDE, AHEAD));
			expect(fight.rig.slot).toEqual(slot(PLAYER_INSIDE, AHEAD));
			expect(ahead.structure).toBeLessThan(20);
			expect(model.selectedCard).toBeNull();
			expect(combat['road'].slotTargetViews).toHaveLength(0);

			playCard.mockRestore();
		});

		it('takes its slot by a drop, then its raider by a click', async () => {
			const fight = strafeFight();
			const [, ahead] = fight.raiders;
			const combat = await startCombat(fight);
			const card = deal(combat, fight, strafe());
			const playCard = jest.spyOn(Battle.prototype, 'playCard');

			drag(grabPoint(card), slotPoint(combat, slot(PLAYER_INSIDE, AHEAD)));
			expect(combat['combatModel'].isTargeting).toBe(true);
			expect(combat['combatModel'].targetableVehicleIds).toEqual([ahead.id]);
			expect(combat['fx'].aiming).toBe(false);

			click(platePoint(combat, ahead));
			expect(playCard).toHaveBeenCalledTimes(1);
			expect(playCard.mock.calls[0][0].destination).toEqual(slot(PLAYER_INSIDE, AHEAD));

			playCard.mockRestore();
		});

		it.each([
			['Escape', (): void => press('Escape')],
			['a right-click', (): void => inject('click,640,300,2')],
			['a click on nothing', (): void => inject('click,640,8')],
		])('puts the card back at the second step on %s, and nothing moves', async (_, cancel) => {
			const fight = strafeFight();
			const combat = await startCombat(fight);
			const card = deal(combat, fight, strafe());
			const playCard = jest.spyOn(Battle.prototype, 'playCard');

			click(grabPoint(card));
			click(slotPoint(combat, slot(PLAYER_INSIDE, AHEAD)));
			expect(combat['combatModel'].isTargeting).toBe(true);
			cancel();
			expect(combat['combatModel'].isTargeting).toBe(false);
			expect(combat['combatModel'].selectedCard).toBeNull();
			expect(combat['road'].slotTargetViews).toHaveLength(0);
			expect(card.selected).toBe(false);
			expect(fight.rig.slot).toEqual(slot(PLAYER_INSIDE, CENTER));
			expect(playCard).not.toHaveBeenCalled();

			playCard.mockRestore();
		});

		it('drops the held slot\'s preview while END TURN is hovered or focused, since ending the turn puts the card back', async () => {
			const fight = slotFight({ raiders: [slot(ENEMY_INSIDE, CENTER), slot(ENEMY_INSIDE, AHEAD)], plan: true });
			const [across] = fight.raiders;
			const combat = await startCombat(fight);
			const card = deal(combat, fight, strafe());
			const preview = combat['intentPreview'];
			const endTurn = combat['endTurnColumn'].endTurn;
			const playCard = jest.spyOn(Battle.prototype, 'playCard');

			click(grabPoint(card));
			click(slotPoint(combat, slot(PLAYER_INSIDE, AHEAD)));
			// Held at inside ahead, the Rig is two from the raider across: its Point Blank drops out
			expect(token(combat, across).intents).toHaveLength(0);
			expect(preview.incoming.get(fight.rig.id)).toBeUndefined();

			// END TURN would put Strafe back, so what it previews is the plan without it
			inject(`move,${centreOf(endTurn.screenBounds).join(',')}`);
			expect(preview.showing).toBe(true);
			expect(token(combat, across).intents).toHaveLength(1);
			expect(preview.incoming.get(fight.rig.id)).toBe('-3');
			inject('move,1,1');
			expect(token(combat, across).intents).toHaveLength(0);

			// From the keyboard too, and END TURN then plays the plan it showed
			context.focus.focus(endTurn, 'keyboard');
			context.frame.layout();
			expect(preview.showing).toBe(true);
			expect(token(combat, across).intents).toHaveLength(1);
			expect(combat['combatModel'].selectedCard).toBe(card.data);
			press('Enter');
			expect(combat['battle']?.enemyTurnInProgress).toBe(true);
			expect(combat['combatModel'].selectedCard).toBeNull();
			expect(fight.rig.slot).toEqual(slot(PLAYER_INSIDE, CENTER));
			expect(playCard).not.toHaveBeenCalled();

			playCard.mockRestore();
		});

		it('goes back to the hand when no slot it could swerve to puts a raider in reach', async () => {
			// Three lanes from the Rig wherever it swerves
			const fight = slotFight({ raiders: [slot(ENEMY_OUTSIDE, CENTER)] });
			const combat = await startCombat(fight);
			const card = deal(combat, fight, strafe());

			click(grabPoint(card));
			expect(combat['combatModel'].isTargeting).toBe(false);
			expect(combat['combatModel'].selectedCard).toBeNull();
			expect(combat['road'].slotTargetViews).toHaveLength(0);
			expect(card.selected).toBe(false);
		});
	});

	it('Fall In takes an escort, then any empty slot in your formation, and holds the escort solid between', async () => {
		const med = createEscort({ type: 'med_truck' });
		const fight = slotFight({ escorts: [med] });
		const combat = await startCombat(fight);
		const card = deal(combat, fight, fallIn());
		const playCard = jest.spyOn(Battle.prototype, 'playCard');
		const model = combat['combatModel'];
		expect(med.slot).toEqual(slot(PLAYER_OUTSIDE, BEHIND));

		click(grabPoint(card));
		expect(model.targetableVehicleIds).toEqual([med.id]);
		expect(targetSlots(combat)).toEqual([]);

		click(platePoint(combat, med));
		expect(model.isPickingSlot).toBe(true);
		expect(model.pickedVehicleId).toBe(med.id);
		expect(token(combat, med)['outlineStyle']).toBe('solid');
		// Every empty slot in your formation, the far ones too
		expect(targetSlots(combat)).toEqual(expect.arrayContaining([slot(PLAYER_OUTSIDE, AHEAD), slot(PLAYER_OUTSIDE, CENTER), slot(PLAYER_INSIDE, AHEAD)]));
		expect(targetSlots(combat)).toHaveLength(3);

		click(slotPoint(combat, slot(PLAYER_OUTSIDE, AHEAD)));
		expect(playCard).toHaveBeenCalledTimes(1);
		expect(playCard.mock.calls[0][0].targetVehicle).toBe(med);
		expect(med.slot).toEqual(slot(PLAYER_OUTSIDE, AHEAD));
		expect(med.isReady).toBe(true);

		playCard.mockRestore();
	});

	describe('Shoulder Check: a raider, then which way to shove it', () => {
		it('offers the raider\'s two candidate slots in its formation, reads the shove from the caster, and plays the one picked', async () => {
			const fight = slotFight({ plan: true });
			const [raider] = fight.raiders;
			const combat = await startCombat(fight);
			const card = deal(combat, fight, shoulderCheck());
			const playCard = jest.spyOn(Battle.prototype, 'playCard');
			const model = combat['combatModel'];

			click(grabPoint(card));
			expect(model.targetableVehicleIds).toEqual([raider.id]);
			click(platePoint(combat, raider));
			expect(model.isPickingSlot).toBe(true);
			expect(targetSlots(combat)).toEqual(expect.arrayContaining([slot(ENEMY_INSIDE, AHEAD), slot(ENEMY_INSIDE, BEHIND)]));
			expect(targetSlots(combat)).toHaveLength(2);
			expect(slotTarget(combat, slot(ENEMY_INSIDE, AHEAD)).side).toBe('raider');
			// The hit check still rides with the card: the shove only follows a hit
			expect(combat['fx'].hitCheckText?.verdict).toBe('HIT');

			// Shoved ahead, it's two from the Rig: out of its Point Blank's reach
			inject(`move,${slotPoint(combat, slot(ENEMY_INSIDE, AHEAD)).join(',')}`);
			expect(token(combat, raider).rangeLabel).toEqual({ text: 'OUT', legal: false });
			expect(token(combat, raider).intents).toHaveLength(0);

			click(slotPoint(combat, slot(ENEMY_INSIDE, AHEAD)));
			expect(playCard).toHaveBeenCalledTimes(1);
			const [{ targetVehicle, destination }] = playCard.mock.calls[0];
			expect(targetVehicle).toBe(raider);
			expect(destination).toEqual(slot(ENEMY_INSIDE, AHEAD));
			expect(raider.slot).toEqual(slot(ENEMY_INSIDE, AHEAD));

			playCard.mockRestore();
		});

		it('takes its raider by a drop, then its shove by a click', async () => {
			const fight = slotFight();
			const [raider] = fight.raiders;
			const combat = await startCombat(fight);
			const card = deal(combat, fight, shoulderCheck());
			const playCard = jest.spyOn(Battle.prototype, 'playCard');
			const model = combat['combatModel'];

			drag(grabPoint(card), platePoint(combat, raider));
			expect(model.isPickingSlot).toBe(true);
			expect(model.pickedVehicleId).toBe(raider.id);
			expect(targetSlots(combat)).toHaveLength(2);
			expect(combat['fx'].aiming).toBe(false);
			expect(playCard).not.toHaveBeenCalled();

			click(slotPoint(combat, slot(ENEMY_INSIDE, BEHIND)));
			expect(playCard).toHaveBeenCalledTimes(1);
			expect(playCard.mock.calls[0][0].destination).toEqual(slot(ENEMY_INSIDE, BEHIND));
			expect(raider.slot).toEqual(slot(ENEMY_INSIDE, BEHIND));

			playCard.mockRestore();
		});

		it('plays at once on a raider boxed in ahead and behind, with no slot to pick', async () => {
			const fight = slotFight({ raiders: [slot(ENEMY_INSIDE, CENTER), slot(ENEMY_INSIDE, AHEAD), slot(ENEMY_INSIDE, BEHIND)] });
			const [raider] = fight.raiders;
			const combat = await startCombat(fight);
			const card = deal(combat, fight, shoulderCheck());
			const playCard = jest.spyOn(Battle.prototype, 'playCard');

			click(grabPoint(card));
			click(platePoint(combat, raider));
			expect(playCard).toHaveBeenCalledTimes(1);
			expect(playCard.mock.calls[0][0].destination).toBeUndefined();
			expect(playCard).toHaveReturnedWith(true);
			expect(raider.slot).toEqual(slot(ENEMY_INSIDE, CENTER));

			playCard.mockRestore();
		});
	});

	it('Leapfrog offers your partner\'s vehicle and an escort next to you, through the vehicle targeting', async () => {
		const outrider = createEscort({ type: 'outrider' });
		const med = createEscort({ type: 'med_truck' });
		const fight = slotFight({ escorts: [outrider, med], raiders: [slot(ENEMY_OUTSIDE, CENTER)] });
		const combat = await startCombat(fight);
		const card = deal(combat, fight, leapfrog());
		const playCard = jest.spyOn(Battle.prototype, 'playCard');
		const model = combat['combatModel'];
		// The Outrider takes inside ahead, next to the Rig; the Med Truck outside behind, two away
		expect(outrider.slot).toEqual(slot(PLAYER_INSIDE, AHEAD));

		click(grabPoint(card));
		expect(model.isPickingSlot).toBe(false);
		expect(new Set(model.targetableVehicleIds)).toEqual(new Set([fight.bike.id, outrider.id]));
		expect(combat['road'].slotTargetViews).toHaveLength(0);

		click(platePoint(combat, outrider));
		expect(playCard).toHaveBeenCalledTimes(1);
		expect(fight.rig.slot).toEqual(slot(PLAYER_INSIDE, AHEAD));
		expect(outrider.slot).toEqual(slot(PLAYER_INSIDE, CENTER));

		playCard.mockRestore();
	});

	it('plays a slot, then a raider, from the keyboard: focus goes to the slot, then to the raider in reach of it', async () => {
		const fight = slotFight({ raiders: [slot(ENEMY_INSIDE, CENTER), slot(ENEMY_INSIDE, AHEAD)] });
		const [, ahead] = fight.raiders;
		const combat = await startCombat(fight);
		const card = deal(combat, fight, strafe());
		const playCard = jest.spyOn(Battle.prototype, 'playCard');
		const focus = context.focus;
		const model = combat['combatModel'];

		press('Tab');
		expect(focus.focused).toBe(card);
		press('Enter');
		expect(model.isPickingSlot).toBe(true);
		expect(focus.focused).toBeInstanceOf(SlotTarget);
		expect(focus.focused?.focusVisible).toBe(true);
		expect(model.focusedSlot).toEqual(slot(PLAYER_INSIDE, AHEAD));

		press('Enter');
		expect(model.isPickingSlot).toBe(false);
		expect(focus.focused).toBeInstanceOf(UIVehicle);
		expect((focus.focused as UIVehicle).vehicleId).toBe(ahead.id);

		press('Enter');
		expect(playCard).toHaveBeenCalledTimes(1);
		expect(playCard.mock.calls[0][0].destination).toEqual(slot(PLAYER_INSIDE, AHEAD));
		expect(focus.focused?.id === 'end_turn_button' || focus.focused instanceof UICard).toBe(true);

		playCard.mockRestore();
	});

	it('plays a raider, then its shove, from the keyboard: focus goes to the raider, then the arrows move between its two rows', async () => {
		const fight = slotFight();
		const [raider] = fight.raiders;
		const combat = await startCombat(fight);
		const card = deal(combat, fight, shoulderCheck());
		const playCard = jest.spyOn(Battle.prototype, 'playCard');
		const focus = context.focus;
		const model = combat['combatModel'];

		press('Tab');
		expect(focus.focused).toBe(card);
		press('Enter');
		expect(focus.focused).toBeInstanceOf(UIVehicle);
		expect((focus.focused as UIVehicle).vehicleId).toBe(raider.id);
		press('Enter');
		expect(model.isPickingSlot).toBe(true);
		expect(focus.focused).toBeInstanceOf(SlotTarget);
		const first = focus.focused as SlotTarget;

		// No vehicle on the road takes focus now, so the arrows go between the two rows
		press(first.slot.row === AHEAD ? 'ArrowDown' : 'ArrowUp');
		expect(focus.focused).toBeInstanceOf(SlotTarget);
		const second = focus.focused as SlotTarget;
		expect(second).not.toBe(first);
		expect(model.focusedSlot).toEqual(second.slot);

		press('Enter');
		expect(playCard).toHaveBeenCalledTimes(1);
		expect(playCard.mock.calls[0][0].targetVehicle).toBe(raider);
		expect(playCard.mock.calls[0][0].destination).toEqual(second.slot);
		expect(raider.slot).toEqual(second.slot);

		playCard.mockRestore();
	});

	it('lays the slot targets out inside their slots, clear of the vehicles, with a slot hovered and one already chosen', async () => {
		const fight = slotFight({ raiders: [slot(ENEMY_INSIDE, CENTER), slot(ENEMY_INSIDE, AHEAD)] });
		const combat = await startCombat(fight);
		const viewport = { width: 1280, height: 720 };
		// The placement rules; this context measures no text, so the text and size rules don't apply here
		const placement = new Set(['sibling-overlap', 'child-outside-parent', 'outside-viewport']);
		const roadViolations = (): string[] => layoutLint(treeSnapshot([combat['rootLayer']], viewport)).violations
			.filter((violation) => placement.has(violation.rule) && /slot_target/.test(violation.path))
			.map((violation) => `${violation.rule}: ${violation.path}`);

		// Juke's two slots side by side, one hovered
		const jukeCard = deal(combat, fight, juke());
		click(grabPoint(jukeCard));
		inject(`move,${slotPoint(combat, slot(PLAYER_OUTSIDE, CENTER)).join(',')}`);
		expect(combat['road'].slotTargetViews).toHaveLength(2);
		expect(roadViolations()).toEqual([]);
		press('Escape');

		// Strafe's slot held while it waits for its raider
		const strafeCard = deal(combat, fight, strafe());
		click(grabPoint(strafeCard));
		click(slotPoint(combat, slot(PLAYER_INSIDE, AHEAD)));
		expect(combat['road'].slotTargetViews).toHaveLength(1);
		expect(roadViolations()).toEqual([]);
	});

	it('puts a card back with Escape from its slot step, focus back on the hand', async () => {
		const fight = slotFight();
		const combat = await startCombat(fight);
		const card = deal(combat, fight, juke());
		const focus = context.focus;

		press('Tab');
		press('Enter');
		expect(focus.focused).toBeInstanceOf(SlotTarget);
		press('Escape');
		expect(combat['combatModel'].isTargeting).toBe(false);
		expect(combat['road'].slotTargetViews).toHaveLength(0);
		expect(focus.focused).toBe(card);
	});
});
