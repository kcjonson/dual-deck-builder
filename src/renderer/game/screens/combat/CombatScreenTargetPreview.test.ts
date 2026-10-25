/**
 * @jest-environment jsdom
 */
import { CombatScreen, PreparedCombatMount } from './CombatScreen';
import { createTestContext, injectNow } from '../../../engine/components/testing';
import { Clock } from '../../../engine/animation/Clock';
import { PointerAdapter } from '../../../engine/input/PointerAdapter';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { DrawPolygonOptions, DrawPolylineOptions } from '../../../engine/draw/commands';
import type { RGBA, Vec2 } from '../../../engine/draw/geometry';
import { Battle } from '../../mechanics/Battle';
import { Card, CardData } from '../../mechanics/Card';
import type { Driver } from '../../mechanics/Driver';
import { RoadLane, RoadRow, RoadSlot } from '../../mechanics/Road';
import { Team, TeamType } from '../../mechanics/Team';
import { Vehicle } from '../../mechanics/Vehicle';
import { Card as UICard } from '../../ui/Card';
import { Vehicle as UIVehicle } from '../../ui/Vehicle';
import { createTestDriver } from '../../ai/__tests__/test-helpers';
import { BLOCK_LABELS } from './PlayerHandView';
import * as targetsModule from './cardTargets';
import { DOTTED, UNBROKEN } from './CombatFxLayer';
import { ROAD_HEADER_HEIGHT } from './CombatLayout';
import cardsFile from '../../data/cards.json';

/**
 * DDB-554: a card with nothing to land on is disabled in the hand, with a
 * strip saying so, and a playable card pointed at or focused shows its
 * targets and moves: arrows over the road from the vehicle it acts from,
 * solid for one target, dotted for a choice of several.
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
/** A swap with your partner or an escort beside you. */
const leapfrog = realCard('leapfrog');

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

/** One arrow the preview draws, on screen: where its line starts, its head's base, tip, and wings, its colour, and whether it's solid. */
interface Arrow {
	start: Vec2;
	base: Vec2;
	tip: Vec2;
	wings: [Vec2, Vec2];
	color: RGBA;
	solid: boolean;
}

/**
 * What the preview draws: each arrow, from the line before its head, and
 * the draws counted: solid `lines`, dotted lines (`dots`, R2.10a), heads.
 */
function record(combat: CombatScreen): { lines: number; dots: number; heads: number; arrows: Arrow[] } {
	const counts = { lines: 0, dots: 0, heads: 0 };
	const arrows: Arrow[] = [];
	const target = preview(combat);
	const screen = (point: Vec2): Vec2 => target.localToScreen({ x: point.x, y: point.y });
	let start: Vec2 | null = null;
	let solid = false;
	const draw = {
		drawPolyline: (options: DrawPolylineOptions) => {
			expect(options.cap).toBe('round');
			if (options.dash === UNBROKEN) {
				counts.lines++;
				solid = true;
			} else {
				expect(options.dash).toEqual(DOTTED);
				counts.dots++;
			}
			start ??= screen(options.points[0]);
		},
		drawPolygon: (options: DrawPolygonOptions) => {
			counts.heads++;
			const tip = screen(options.points[0]);
			arrows.push({ start: start ?? tip, base: screen(options.points[2]), tip, wings: [screen(options.points[1]), screen(options.points[3])], color: options.fill as RGBA, solid });
			start = null;
			solid = false;
		},
	} as unknown as DrawApi;
	target.render(draw);
	return { ...counts, arrows };
}

function drawn(combat: CombatScreen): { lines: number; dots: number; heads: number } {
	const { lines, dots, heads } = record(combat);
	return { lines, dots, heads };
}

function token(combat: CombatScreen, of: Vehicle): UIVehicle {
	const view = combat['road'].vehicleView(of.id);
	if (!view) throw new Error(`${of.name} should be on the road`);
	return view;
}

/** The middle of a vehicle's plate's top or bottom edge on screen. */
function plateEdge(combat: CombatScreen, of: Vehicle, edge: 'top' | 'bottom'): Vec2 {
	const { x, y, width, height } = token(combat, of).plateScreenBounds;
	return { x: x + width / 2, y: edge === 'top' ? y : y + height };
}

/** The top of a vehicle's token over the middle of its plate, on screen: where a target arrow lands. */
function tokenTop(combat: CombatScreen, of: Vehicle): Vec2 {
	const view = token(combat, of);
	return view.localToScreen({ x: view.plateRect.x + view.plateRect.width / 2, y: 0 });
}

function expectNear(actual: Vec2, expected: Vec2): void {
	expect(actual.x).toBeCloseTo(expected.x, 3);
	expect(actual.y).toBeCloseTo(expected.y, 3);
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

function centreOf({ x, y, width, height }: { x: number; y: number; width: number; height: number }): [number, number] {
	return [Math.round(x + width / 2), Math.round(y + height / 2)];
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
		expect(targets?.links).toEqual([{ sourceId: one.rig.id, targetId: one.raiders[0].id }]);
		expect(targets?.vehicleIds).toEqual([one.raiders[0].id]);
		expect(preview(combat).solid).toBe(true);
		const { lines, dots, heads, arrows } = record(combat);
		expect({ lines, dots, heads }).toEqual({ lines: 1, dots: 0, heads: 1 });

		// Up from the top of the Rig's plate, down onto the top of the raider's token, in the raiders' red
		const [arrow] = arrows;
		expect(arrow.solid).toBe(true);
		expectNear(arrow.start, plateEdge(combat, one.rig, 'top'));
		expectNear(arrow.tip, tokenTop(combat, one.raiders[0]));
		expect(arrow.color[0]).toBeCloseTo(1, 2);
		expect(arrow.color[1]).toBeLessThan(0.5);
		// It comes down onto the target, not in from the side
		expect(arrow.tip.y - arrow.base.y).toBeGreaterThan(Math.abs(arrow.tip.x - arrow.base.x));
		expect(preview(combat).resolvedColors?.fill).toEqual(arrow.color);
	});

	it('comes in level onto the near side of a raider in the row ahead, with no room under the lane header to come down', async () => {
		const ahead = fight([slot(ENEMY_INSIDE, AHEAD)]);
		const combat = await startCombat(ahead);
		const [card] = deal(combat, ahead, shot(2));
		hover(card);

		const [arrow] = record(combat).arrows;
		const raider = token(combat, ahead.raiders[0]);
		const plate = raider.plateScreenBounds;
		expectNear(arrow.tip, { x: raider.screenBounds.x, y: plate.y + plate.height / 2 });
		expect(arrow.tip.x - arrow.base.x).toBeGreaterThan(Math.abs(arrow.tip.y - arrow.base.y));
		const header = preview(combat).localToScreen({ x: 0, y: ROAD_HEADER_HEIGHT }).y;
		for (const point of [arrow.start, arrow.base, arrow.tip, ...arrow.wings]) expect(point.y).toBeGreaterThan(header);
	});

	it('goes the short way between two vehicles in one lane, never through the target', async () => {
		const near = fight([slot(ENEMY_INSIDE, CENTER)]);
		const combat = await startCombat(near);
		// The Rig's driver swaps with the Bike, behind it in the inside lane
		const [down] = deal(combat, near, leapfrog());
		hover(down);
		expect(preview(combat).showing?.links).toEqual([{ sourceId: near.rig.id, targetId: near.bike.id }]);
		const [toBike] = record(combat).arrows;
		expectNear(toBike.start, plateEdge(combat, near.rig, 'bottom'));
		expectNear(toBike.tip, plateEdge(combat, near.bike, 'top'));
		expect(toBike.color[2]).toBeLessThan(0.5);

		// The Bike's driver's swap goes up to the bottom of the Rig's plate
		inject('move,1,1');
		const swap = leapfrog();
		driverOf(near.rig).set({ hand: [] });
		driverOf(near.bike).set({ hand: [swap], adrenaline: 5 });
		combat['updateUIFromBattle']();
		context.frame.layout();
		const up = combat['handLayer'].getCardElementByCard(swap);
		if (!up) throw new Error('Leapfrog should be dealt to the Bike');
		hover(up);
		const [toRig] = record(combat).arrows;
		expectNear(toRig.start, plateEdge(combat, near.bike, 'top'));
		expectNear(toRig.tip, plateEdge(combat, near.rig, 'bottom'));
	});

	it('draws a dotted arrow to each raider when the player picks one of several', async () => {
		const two = fight([slot(ENEMY_INSIDE, CENTER), slot(ENEMY_INSIDE, AHEAD)]);
		const combat = await startCombat(two);
		const [card] = deal(combat, two, shot(2));
		hover(card);

		expect(preview(combat).showing?.vehicleIds).toEqual(two.raiders.map(raider => raider.id));
		expect(preview(combat).solid).toBe(false);
		const counts = record(combat);
		expect(counts.lines).toBe(0);
		expect(counts.heads).toBe(2);
		// One dotted line an arrow, its dots drawn by the line style
		expect(counts.dots).toBe(2);
		expect(counts.arrows.map(arrow => arrow.solid)).toEqual([false, false]);
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
		const { lines, heads, dots, arrows } = record(combat);
		expect(lines).toBe(0);
		expect(heads).toBe(slots.length);
		expect(dots).toBe(slots.length);

		// Each comes out from under the Rig's token and ends in the middle of its slot, in your convoy's yellow
		const road = combat['road'];
		const rig = token(combat, near.rig).screenBounds;
		arrows.forEach((arrow, index) => {
			const box = road.slotRect(slots[index]);
			expectNear(arrow.tip, road.localToScreen({ x: box.x + box.width / 2, y: box.y + box.height / 2 }));
			const outside = Math.max(rig.x - arrow.start.x, arrow.start.x - (rig.x + rig.width), rig.y - arrow.start.y, arrow.start.y - (rig.y + rig.height));
			expect(outside).toBeGreaterThan(0);
			expect(outside).toBeLessThan(12);
			expect(arrow.solid).toBe(false);
			expect(arrow.color).toEqual(preview(combat).resolvedColors?.fill);
			expect(arrow.color[2]).toBeLessThan(0.5);
		});
	});

	it('draws a solid move for a card that moves you one fixed way', async () => {
		const near = fight([slot(ENEMY_INSIDE, CENTER)]);
		const combat = await startCombat(near);
		const [card] = deal(combat, near, laneChange());
		hover(card);

		expect(preview(combat).showing?.moves).toEqual([{ vehicleId: near.rig.id, to: { lane: RoadLane.PLAYER_OUTSIDE, row: CENTER }, choice: false }]);
		const { lines, dots, heads, arrows } = record(combat);
		expect({ lines, dots, heads }).toEqual({ lines: 1, dots: 0, heads: 1 });
		expect(arrows[0].solid).toBe(true);
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

	it('shows where a card moves the raider it targets, certain with only the one raider to target', async () => {
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

	it('stays quiet when a card played from under the pointer comes back to the hand unplayable', async () => {
		const near = fight([slot(ENEMY_INSIDE, CENTER)]);
		const combat = await startCombat(near);
		const card = juke();
		const [element] = deal(combat, near, card);
		// Its one adrenaline, and nothing to draw but itself once it's discarded
		driverOf(near.rig).set({ adrenaline: card.cost });
		combat['updateUIFromBattle']();
		hover(element);
		const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		press('Tab', 'Enter', 'Enter');
		expect(driverOf(near.rig).hand).toEqual([card]);
		expect(element.enabled).toBe(false);
		expect(errors).not.toHaveBeenCalled();
		expect(preview(combat).showing).toBeNull();
		errors.mockRestore();
	});

	it('works out a card\'s targets the first time it\'s previewed, not on every deal', async () => {
		const one = fight([slot(ENEMY_INSIDE, CENTER)]);
		const combat = await startCombat(one);
		const [card] = deal(combat, one, shot(1), volley());
		const worked = jest.spyOn(targetsModule, 'cardTargets');
		expect(combat['handTargets'].size).toBe(0);
		hover(card);
		expect(worked).toHaveBeenCalledTimes(1);
		// Presented again with no deal between: the kept answer
		inject('move,1,1');
		hover(card);
		expect(worked).toHaveBeenCalledTimes(1);
		// A deal throws it away, and the next preview works it out again
		combat['updateUIFromBattle']();
		inject('move,1,1');
		hover(card);
		expect(worked).toHaveBeenCalledTimes(2);
		worked.mockRestore();
	});

	it('falls back to the keyboard\'s card when the pointer leaves the one it was on', async () => {
		const one = fight([slot(ENEMY_INSIDE, CENTER)]);
		const combat = await startCombat(one);
		const [focused, pointed] = deal(combat, one, shot(1), volley());
		press('Tab');
		expect(context.focus.focused).toBe(focused);
		hover(pointed);
		expect(preview(combat).showing?.picks).toBe(false);
		inject('move,1,1');
		expect(preview(combat).showing?.picks).toBe(true);
	});

	it('gives the road to whichever was asked for last, a hand card or END TURN, and never both', async () => {
		const one = fight([slot(ENEMY_INSIDE, CENTER)]);
		const combat = await startCombat(one);
		const [card] = deal(combat, one, shot(1));
		const intents = combat['intentPreview'];
		press('Tab', 'Tab');
		expect(context.focus.focused?.id).toBe('end_turn_button');
		expect(intents.showing).toBe(true);
		expect(preview(combat).showing).toBeNull();

		hover(card);
		expect(preview(combat).showing).not.toBeNull();
		expect(intents.showing).toBe(false);

		inject('move,1,1');
		expect(preview(combat).showing).toBeNull();
		expect(intents.showing).toBe(true);
	});

	it('shows nothing while a card is dragged, through the enemy turn, or once the battle is over', async () => {
		const one = fight([slot(ENEMY_INSIDE, CENTER)]);
		const combat = await startCombat(one);
		const [card] = deal(combat, one, shot(1));
		const { x, y, height } = card.screenBounds;
		drag([Math.round(x + 12), Math.round(y + height / 2)], centreOf(token(combat, one.raiders[0]).screenBounds), { release: false });
		expect(context.drag.isDragging).toBe(true);
		expect(preview(combat).showing).toBeNull();
		press('Escape');
		inject(`up,1,1`);

		// A drag that isn't aiming a card hides it too
		hover(card);
		expect(preview(combat).showing).not.toBeNull();
		const dragging = jest.spyOn(context.drag, 'isDragging', 'get').mockReturnValue(true);
		expect(combat['combatModel'].isTargeting).toBe(false);
		combat['refreshTargetPreview']();
		expect(preview(combat).showing).toBeNull();
		dragging.mockRestore();
		inject('move,1,1');

		hover(card);
		expect(preview(combat).showing).not.toBeNull();
		combat['endPlayerTurn']();
		expect(preview(combat).showing).toBeNull();

		const over = fight([slot(ENEMY_INSIDE, CENTER)]);
		const ended = await startCombat(over);
		const [last] = deal(ended, over, shot(1));
		hover(last);
		expect(preview(ended).showing).not.toBeNull();
		(ended['battle'] as Battle).battleOver = true;
		ended['refreshTargetPreview']();
		expect(preview(ended).showing).toBeNull();
	});

	it('refuses a drop on a raider out of reach, which aiming dims and marks OUT (DDB-114)', async () => {
		const mixed = fight([slot(ENEMY_INSIDE, CENTER), slot(ENEMY_OUTSIDE, AHEAD)]);
		const combat = await startCombat(mixed);
		const playCard = jest.spyOn(Battle.prototype, 'playCard');
		const [card] = deal(combat, mixed, shot(1));
		const far = token(combat, mixed.raiders[1]);
		const { x, y, height } = card.screenBounds;
		const target = centreOf(far.screenBounds);
		drag([Math.round(x + 12), Math.round(y + height / 2)], target, { release: false });
		expect(combat['combatModel'].isTargeting).toBe(true);
		expect(combat['combatModel'].targetableVehicleIds).toEqual([mixed.raiders[0].id]);
		expect(far.rangeLabel).toEqual({ text: 'OUT', legal: false });
		expect(far.opacity).toBeLessThan(1);
		expect(context.drag.canDrop).toBe(false);
		inject(`up,${target[0]},${target[1]}`);
		expect(playCard).not.toHaveBeenCalled();
		expect(combat['combatModel'].selectedCard).toBeNull();
		playCard.mockRestore();
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
