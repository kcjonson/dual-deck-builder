/**
 * @jest-environment jsdom
 */
import { CombatScreen, PreparedCombatMount } from './CombatScreen';
import { createTestContext, injectNow } from '../../../engine/components/testing';
import { Clock } from '../../../engine/animation/Clock';
import { PointerAdapter } from '../../../engine/input/PointerAdapter';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import { Battle } from '../../mechanics/Battle';
import { Card, CardData } from '../../mechanics/Card';
import type { Driver } from '../../mechanics/Driver';
import { RoadLane, RoadRow, RoadSlot } from '../../mechanics/Road';
import { Team, TeamType } from '../../mechanics/Team';
import { Vehicle } from '../../mechanics/Vehicle';
import { Card as UICard } from '../../ui/Card';
import { createTestDriver } from '../../ai/__tests__/test-helpers';
import { BLOCK_LABELS } from './PlayerHandView';
import cardsFile from '../../data/cards.json';

/**
 * A card with nothing to land on is disabled in the hand, with a strip
 * saying so, and a playable card pointed at or focused shows its targets:
 * arrows over the road from the vehicle it acts from, solid for one
 * target, dotted for a choice of several.
 */

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
const { ENEMY_INSIDE, ENEMY_OUTSIDE } = RoadLane;
const { AHEAD, CENTER } = RoadRow;

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

/** A fresh copy of a card as cards.json has it. */
const realCard = (type: string) => (): Card => {
	const data = (cardsFile as unknown as { cards: CardData[] }).cards.find(card => card.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return new Card({ ...data });
};
/** A swerve to a slot the player picks. */
const juke = realCard('juke');
/** A swerve to the other lane in your row. */
const laneChange = realCard('lane_change');
/** Every vehicle in your formation to the other lane in its row. */
const formationShift = realCard('formation_shift');
/** A sure-hit shove of a raider at Range 1 in your row to its outside lane. */
const layOnTheHorn = realCard('lay_on_the_horn');

/** A sure-hit shot on one raider, reaching `range`. */
const shot = (range: number): Card => new Card({
	type: `shot_r${range}`,
	name: `Shot R${range}`,
	summary: 'Shot',
	description: 'Shot',
	rarity: 'common',
	cost: 1,
	targetType: 'enemy_single',
	effects: [{ type: 'damage', value: 3, range, always_hits: true }],
	tags: ['attack'],
});

/** Damage to every raider, wherever they are. */
const volley = (): Card => new Card({
	type: 'volley_test',
	name: 'Volley',
	summary: 'Volley',
	description: 'Volley',
	rarity: 'common',
	cost: 1,
	targetType: 'enemy_all',
	effects: [{ type: 'damage', value: 2, always_hits: true }],
	tags: ['attack'],
});

function driverOf(of: Vehicle): Driver {
	if (!of.driver) throw new Error(`${of.name} has no driver`);
	return of.driver;
}

interface Fight {
	mount: PreparedCombatMount;
	rig: Vehicle;
	bike: Vehicle;
	raiders: Vehicle[];
}

/** The Rig in your inside center and the Bike behind it, against raiders where each is told to start. */
function fight(raiders: RoadSlot[]): Fight {
	const rig = vehicle('Rig');
	const bike = vehicle('Bike');
	const raiderVehicles = raiders.map((at, index) => vehicle(`Raider ${index + 1}`, at));
	const battle = new Battle({
		playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig, bike] }),
		enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: raiderVehicles }),
	});
	battle.start();
	return { mount: { prepare: async () => ({ battle }) }, rig, bike, raiders: raiderVehicles };
}

const mounted = new Set<CombatScreen>();

async function startCombat(of: Fight): Promise<CombatScreen> {
	const combat = new CombatScreen();
	combat.mount(context, of.mount);
	mounted.add(combat);
	await flushPromises();
	await flushPromises();
	context.frame.layout();
	return combat;
}

/** Deal `cards` into the Rig's driver's hand, with adrenaline to play them. */
function deal(combat: CombatScreen, of: Fight, ...cards: Card[]): UICard[] {
	driverOf(of.rig).set({ hand: cards, adrenaline: 5 });
	combat['updateUIFromBattle']();
	context.frame.layout();
	return cards.map((card) => {
		const element = combat['handLayer'].getCardElementByCard(card);
		if (!element) throw new Error(`${card.name} should be dealt`);
		return element;
	});
}

function inject(...commands: string[]): void {
	expect(injectNow({ canvas, dispatcher: context.dispatcher }, commands).ok).toBe(true);
	context.frame.layout();
}

function press(...keys: string[]): void {
	inject(...keys.flatMap(key => [`keydown,${key}`, `keyup,${key}`]));
}

function hover(card: UICard): void {
	const { x, y, width, height } = card.screenBounds;
	inject(`move,${Math.round(x + width / 2)},${Math.round(y + height / 2)}`);
}

function preview(combat: CombatScreen) {
	return combat['targetPreview'];
}

/** What the preview draws, counted by kind. */
function drawn(combat: CombatScreen): { lines: number; dots: number; heads: number } {
	const counts = { lines: 0, dots: 0, heads: 0 };
	const draw = {
		drawPolyline: () => counts.lines++,
		drawCircle: () => counts.dots++,
		drawPolygon: () => counts.heads++,
	} as unknown as DrawApi;
	preview(combat).render(draw);
	return counts;
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
	inject('move,1,1');
	for (const combat of mounted) {
		if (combat['isActive']) combat.unmount();
	}
	mounted.clear();
});

describe('a card with nothing to land on', () => {
	it('is disabled with a NO TARGET strip, and plays again once a raider comes in reach', async () => {
		const outOfReach = fight([slot(ENEMY_OUTSIDE, AHEAD)]);
		const combat = await startCombat(outOfReach);
		const [card] = deal(combat, outOfReach, shot(1));
		expect(card.enabled).toBe(false);
		expect(card.blockLabel).toBe(BLOCK_LABELS.noTarget);

		outOfReach.raiders[0].slot = slot(ENEMY_INSIDE, CENTER);
		combat['updateUIFromBattle']();
		expect(card.enabled).toBe(true);
		expect(card.blockLabel).toBeNull();
	});

	it('shows no strip on a card it can\'t pay for, which says so with its cost', async () => {
		const near = fight([slot(ENEMY_INSIDE, CENTER)]);
		const combat = await startCombat(near);
		const dear = shot(1);
		dear.cost = 9;
		const [card] = deal(combat, near, dear);
		expect(card.enabled).toBe(false);
		expect(card.unaffordable).toBe(true);
		expect(card.blockLabel).toBeNull();
	});

	it('shows no targets when pointed at', async () => {
		const outOfReach = fight([slot(ENEMY_OUTSIDE, AHEAD)]);
		const combat = await startCombat(outOfReach);
		const [card] = deal(combat, outOfReach, shot(1));
		hover(card);
		expect(preview(combat).showing).toBeNull();
	});
});

describe('the target preview', () => {
	it('draws one solid arrow from your vehicle to the one raider in reach', async () => {
		const one = fight([slot(ENEMY_INSIDE, CENTER), slot(ENEMY_OUTSIDE, AHEAD)]);
		const combat = await startCombat(one);
		const [card] = deal(combat, one, shot(1));
		hover(card);

		const targets = preview(combat).showing;
		expect(targets?.sourceId).toBe(one.rig.id);
		expect(targets?.vehicleIds).toEqual([one.raiders[0].id]);
		expect(preview(combat).solid).toBe(true);
		expect(drawn(combat)).toEqual({ lines: 1, dots: 0, heads: 1 });
	});

	it('draws a dotted arrow to each raider when the player picks one of several', async () => {
		const two = fight([slot(ENEMY_INSIDE, CENTER), slot(ENEMY_INSIDE, AHEAD)]);
		const combat = await startCombat(two);
		const [card] = deal(combat, two, shot(2));
		hover(card);

		expect(preview(combat).showing?.vehicleIds).toEqual(two.raiders.map(raider => raider.id));
		expect(preview(combat).solid).toBe(false);
		const counts = drawn(combat);
		expect(counts.lines).toBe(0);
		expect(counts.heads).toBe(2);
		expect(counts.dots).toBeGreaterThan(0);
	});

	it('draws solid arrows to every raider for a card that lands on all of them', async () => {
		const two = fight([slot(ENEMY_INSIDE, CENTER), slot(ENEMY_OUTSIDE, AHEAD)]);
		const combat = await startCombat(two);
		const [card] = deal(combat, two, volley());
		hover(card);

		expect(preview(combat).showing?.picks).toBe(false);
		expect(preview(combat).solid).toBe(true);
		expect(drawn(combat)).toEqual({ lines: 2, dots: 0, heads: 2 });
	});

	it('points a slot card at the slots its move can take', async () => {
		const near = fight([slot(ENEMY_INSIDE, CENTER)]);
		const combat = await startCombat(near);
		const card = juke();
		const [element] = deal(combat, near, card);
		hover(element);

		const battle = combat['battle'] as Battle;
		const slots = battle.moveDestinations({ driver: driverOf(near.rig), card });
		expect(slots.length).toBeGreaterThan(1);
		expect(preview(combat).showing?.slots).toEqual(slots);
		// A dotted move from the Rig to each, and no target arrow
		expect(preview(combat).showing?.moves).toEqual(slots.map(to => ({ vehicleId: near.rig.id, to, choice: true })));
		const counts = drawn(combat);
		expect(counts.lines).toBe(0);
		expect(counts.heads).toBe(slots.length);
		expect(counts.dots).toBeGreaterThan(0);
	});

	it('draws a solid move for a card that moves you one fixed way', async () => {
		const near = fight([slot(ENEMY_INSIDE, CENTER)]);
		const combat = await startCombat(near);
		const [card] = deal(combat, near, laneChange());
		hover(card);

		expect(preview(combat).showing?.moves).toEqual([{ vehicleId: near.rig.id, to: { lane: RoadLane.PLAYER_OUTSIDE, row: CENTER }, choice: false }]);
		expect(drawn(combat)).toEqual({ lines: 1, dots: 0, heads: 1 });
	});

	it('moves every vehicle a card moves: a formation shift sends each to the other lane in its row', async () => {
		const near = fight([slot(ENEMY_INSIDE, CENTER)]);
		const combat = await startCombat(near);
		const [card] = deal(combat, near, formationShift());
		hover(card);

		const moves = preview(combat).showing?.moves ?? [];
		expect(moves.map(move => move.vehicleId).sort()).toEqual([near.rig.id, near.bike.id].sort());
		for (const move of moves) {
			expect(move.to.lane).toBe(RoadLane.PLAYER_OUTSIDE);
			expect(move.choice).toBe(false);
		}
		expect(drawn(combat)).toEqual({ lines: 2, dots: 0, heads: 2 });
	});

	it('shows where a card moves the raider it targets, and what moves hang on a pick', async () => {
		const one = fight([slot(ENEMY_INSIDE, CENTER)]);
		const combat = await startCombat(one);
		const [card] = deal(combat, one, layOnTheHorn());
		hover(card);

		// One raider in reach: the target arrow and its shove are both certain
		expect(preview(combat).showing?.vehicleIds).toEqual([one.raiders[0].id]);
		expect(preview(combat).showing?.moves).toEqual([{ vehicleId: one.raiders[0].id, to: slot(ENEMY_OUTSIDE, CENTER), choice: false }]);
		expect(drawn(combat)).toEqual({ lines: 2, dots: 0, heads: 2 });
	});

	it('follows keyboard focus as it does the pointer', async () => {
		const one = fight([slot(ENEMY_INSIDE, CENTER)]);
		const combat = await startCombat(one);
		const [first, second] = deal(combat, one, shot(1), volley());
		press('Tab');
		expect(context.focus.focused).toBe(first);
		expect(preview(combat).showing?.picks).toBe(true);
		press('ArrowRight');
		expect(context.focus.focused).toBe(second);
		expect(preview(combat).showing?.picks).toBe(false);
	});

	it('gives way to the aim while a card waits for its target, and comes back when it is put back', async () => {
		const one = fight([slot(ENEMY_INSIDE, CENTER)]);
		const combat = await startCombat(one);
		const [card] = deal(combat, one, shot(1));
		hover(card);
		const { x, y, width, height } = card.screenBounds;
		inject(`click,${Math.round(x + width / 2)},${Math.round(y + height / 2)}`);
		expect(combat['combatModel'].isTargeting).toBe(true);
		expect(preview(combat).showing).toBeNull();

		press('Escape');
		expect(combat['combatModel'].isTargeting).toBe(false);
		expect(preview(combat).showing?.vehicleIds).toEqual([one.raiders[0].id]);
	});

	it('goes when the pointer leaves the card', async () => {
		const one = fight([slot(ENEMY_INSIDE, CENTER)]);
		const combat = await startCombat(one);
		const [card] = deal(combat, one, shot(1));
		hover(card);
		expect(preview(combat).showing).not.toBeNull();
		inject('move,1,1');
		expect(preview(combat).showing).toBeNull();
	});
});
