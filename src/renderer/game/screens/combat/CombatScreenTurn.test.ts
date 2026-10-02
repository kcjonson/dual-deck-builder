/**
 * @jest-environment jsdom
 */
import cardsFile from '../../data/cards.json';
import { CombatScreen, ENEMY_ACTION_BEAT, ENEMY_TURN_LEAD_IN } from './CombatScreen';
import { CardLoader } from '../../core/CardLoader';
import { DriverLoader } from '../../core/DriverLoader';
import { Card } from '../../mechanics/Card';
import { Battle } from '../../mechanics/Battle';
import { Card as UICard } from '../../ui/Card';
import { IntentMarker } from '../../ui/IntentMarker';
import { createTestContext } from '../../../engine/components/testing';
import { Clock } from '../../../engine/animation/Clock';
import { advance, pointer, send } from '../../../engine/services/testing';
import { Text } from '../../../engine/components/Text';
import type { Component } from '../../../engine/components/Component';
import { tokens } from '../../../engine/theme/tokens';
import { TURN_BANNER_LIFETIME } from './TurnBanner';
import { roadRowsCenter } from './CombatLayout';

/**
 * DDB-88's last part: the turn banner (DDB-30), every planned intent over
 * its raider, and played and discarded cards flying to their pile
 * (DDB-37). Reading time runs on the frame clock and motion on the
 * animator, so each holds under reduced motion.
 */

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const context = createTestContext({
	viewport: { get logical() { return { width: window.innerWidth, height: window.innerHeight }; } },
	clock: new Clock(),
});
const originalFetch = global.fetch;

function flushPromises(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

async function startCombat(): Promise<CombatScreen> {
	const combat = new CombatScreen();
	combat.mount(context);
	await flushPromises();
	await flushPromises();
	context.frame.layout();
	return combat;
}

/** Frames until the raiders are done and the player's turn has begun. */
function finishEnemyTurn(combat: CombatScreen): void {
	for (let frames = 0; combat['battle']?.enemyTurnInProgress && frames < 2000; frames++) advance(context, 16);
	expect(combat['battle']?.enemyTurnInProgress).toBe(false);
}

function handCards(combat: CombatScreen): UICard[] {
	const layer = combat['handLayer'];
	return layer.handCards.map(card => layer.getCardElementByCard(card)).filter((card): card is UICard => card !== null);
}

/** A card of the first driver's that plays at once on a click, dealt in if the hand lacks one. */
function noTargetCard(combat: CombatScreen): UICard {
	const [driver] = combat['playerDrivers'];
	const found = handCards(combat).find(card => card.data.targetType === 'self' && driver.hand.includes(card.data));
	if (found) return found;
	const card = CardLoader.getInstance().createCard('repair_kit') as Card;
	driver.set({ hand: [card, ...driver.hand] });
	combat['updateUIFromBattle']();
	context.frame.layout();
	return handCards(combat)[0];
}

beforeAll(async () => {
	jest.spyOn(console, 'log').mockImplementation(() => undefined);
	global.fetch = jest.fn().mockResolvedValue({ ok: true, statusText: 'OK', json: async () => cardsFile }) as unknown as typeof fetch;
	await CardLoader.getInstance().loadCards();
	await DriverLoader.getInstance().loadDrivers();
	Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
	Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 720 });
});

afterEach(() => {
	context.animator.reducedMotion = false;
});

afterAll(() => {
	global.fetch = originalFetch;
	jest.restoreAllMocks();
});

describe('CombatScreen turn banner', () => {
	it('says it\'s your turn when the fight starts, across the road and not the dock, then goes', async () => {
		const combat = await startCombat();
		const banner = combat['turnBanner'];
		expect(banner.text).toBe('YOUR TURN');
		expect(banner.visible).toBe(true);
		const road = combat['stage'].children[0].children[1];
		advance(context, 16);
		expect(banner.screenBounds.width).toBeCloseTo(road.screenBounds.width, 6);
		expect(banner.screenBounds.y).toBeGreaterThan(road.screenBounds.y);
		expect(banner.screenBounds.y + banner.screenBounds.height).toBeLessThan(road.screenBounds.y + road.screenBounds.height);

		advance(context, TURN_BANNER_LIFETIME);
		expect(banner.current).toBeNull();
		expect(banner.visible).toBe(false);
		combat.unmount();
	});

	it('centres on the slot rows below the lane header, not on the whole road', async () => {
		const combat = await startCombat();
		const banner = combat['turnBanner'];
		const roadView = combat['road'];
		advance(context, 16);
		const rowsMiddle = roadView.localToScreen({ x: 0, y: roadRowsCenter(roadView.roadLayout) }).y;
		expect(banner.screenBounds.y + banner.screenBounds.height / 2).toBeCloseTo(rowsMiddle, 4);
		combat.unmount();
	});

	it('shows the enemy\'s turn, then yours once the raiders are done, sliding in and fading', async () => {
		const combat = await startCombat();
		const banner = combat['turnBanner'];
		advance(context, TURN_BANNER_LIFETIME + 16);

		combat['endPlayerTurn']();
		expect(banner.text).toBe('ENEMY TURN');
		advance(context, 16);
		expect(banner.opacity).toBeLessThan(1);
		advance(context, tokens.motion.dur);
		expect(banner.opacity).toBe(1);
		finishEnemyTurn(combat);
		expect(banner.text).toBe('YOUR TURN');
		advance(context, TURN_BANNER_LIFETIME);
		expect(banner.current).toBeNull();
		combat.unmount();
	});

	it('sends YOUR TURN out at once for an END TURN pressed while it is up', async () => {
		const combat = await startCombat();
		const banner = combat['turnBanner'];
		advance(context, 16);
		combat['endPlayerTurn']();
		expect(banner.pending).toEqual(['enemy']);

		advance(context, tokens.motion.dur + 16);
		expect(banner.text).toBe('ENEMY TURN');
		finishEnemyTurn(combat);
		expect(banner.text).toBe('YOUR TURN');
		combat.unmount();
	});

	it('holds still at full opacity for its whole time under reduced motion', async () => {
		context.animator.reducedMotion = true;
		const combat = await startCombat();
		const banner = combat['turnBanner'];
		advance(context, 16);
		expect(banner.text).toBe('YOUR TURN');
		expect(banner.opacity).toBe(1);
		advance(context, TURN_BANNER_LIFETIME - 100);
		expect(banner.text).toBe('YOUR TURN');
		expect(banner.opacity).toBe(1);
		advance(context, 200);
		expect(banner.current).toBeNull();
		combat.unmount();
	});
});

describe('CombatScreen intents', () => {
	it('shows every planned intent over its raider, two and then "+N"', async () => {
		const combat = await startCombat();
		const intents = combat['battle']?.getAllIntents();
		for (const raider of combat['enemyTeam']?.vehicles ?? []) {
			const planned = intents?.get(raider) ?? [];
			const row = combat['road'].intentRowOf(raider.id);
			expect(row?.intents.length).toBe(Math.min(planned.length, 2) + (planned.length > 2 ? 1 : 0));
			if (planned.length > 0) expect(row?.intents[0].description).toBe(planned[0].description);
		}
		combat.unmount();
	});

	it('shows a disc\'s tooltip when the pointer rests on it, beside a plate that is one hit target', async () => {
		const combat = await startCombat();
		const [raider] = combat['enemyTeam']?.vehicles ?? [];
		const row = combat['road'].intentRowOf(raider.id);
		context.animator.settle();
		context.frame.layout();
		const disc = row?.children.find((child): child is IntentMarker => child instanceof IntentMarker);
		if (!disc?.intent) throw new Error('the raider should plan something');
		const { x, y, width, height } = disc.screenBounds;
		const at = { x: x + width / 2, y: y + height / 2 };
		expect(context.dispatcher.hitTest(at)).toBe(disc);

		send(context, [pointer('move', at.x, at.y)]);
		advance(context, tokens.control.tooltip_delay + tokens.motion.dur + 50);
		expect(context.tooltips.owner).toBe(disc);
		const lines = textsIn(context.tooltips.surface);
		expect(lines).toContain(disc.intent.description);
		expect(lines).toContain(disc.intent.detail);
		// Off the disc, so later fights don't mount under a resting pointer
		send(context, [pointer('move', 1, 1)]);
		context.tooltips.hide();
		context.animator.settle();
		combat.unmount();
	});
});

function textsIn(component: Component | null): string[] {
	if (!component) return [];
	const own = component instanceof Text ? [component.text] : [];
	return [...own, ...component.children.flatMap(child => textsIn(child))];
}

describe('CombatScreen discard flights', () => {
	it('flies a played card from where it sat in the hand to its driver\'s discard pile', async () => {
		const combat = await startCombat();
		const card = noTargetCard(combat);
		const from = card.screenBounds;
		combat['chooseCard'](card.data, 'click');
		const fx = combat['fx'];
		const [flight] = fx.discardFlights;
		expect(flight).toBeDefined();
		const start = flight.screenBounds;
		expect(start.x + start.width / 2).toBeCloseTo(from.x + from.width / 2, 0);
		expect(start.y + start.height / 2).toBeCloseTo(from.y + from.height / 2, 0);

		advance(context, tokens.motion.dur_slow / 2);
		const pile = combat['handLayer'].pilesOf(1).screenBounds;
		const midway = flight.screenBounds;
		expect(Math.abs(midway.y + midway.height / 2 - (pile.y + pile.height / 2))).toBeLessThan(Math.abs(start.y + start.height / 2 - (pile.y + pile.height / 2)));
		advance(context, tokens.motion.dur_slow);
		expect(fx.discardFlights).toHaveLength(0);
		combat.unmount();
	});

	it('flies the whole hand to the piles when the turn ends', async () => {
		const combat = await startCombat();
		const held = handCards(combat).length;
		combat['endPlayerTurn']();
		expect(combat['fx'].discardFlights).toHaveLength(held);
		combat.unmount();
		expect(context.animator.active).toBe(0);
	});

	it('still flies the whole hand when the draw shuffles the discard back into the deck', async () => {
		const combat = await startCombat();
		// Empty both draw piles into the discards, so the next draw reshuffles
		for (const driver of combat['playerDrivers']) {
			driver.set({ discard: [...driver.discard, ...(driver.deck?.cards ?? [])] });
			if (driver.deck) driver.deck.cards = [];
		}
		const held = handCards(combat).length;
		combat['endPlayerTurn']();
		expect(combat['fx'].discardFlights).toHaveLength(held);
		finishEnemyTurn(combat);
		expect(combat['playerDrivers'].some(driver => (driver.deck?.cards.length ?? 0) > 0)).toBe(true);
		combat.unmount();
	});

	it('flies nothing under reduced motion, where the pile count is the whole story', async () => {
		context.animator.reducedMotion = true;
		const combat = await startCombat();
		combat['endPlayerTurn']();
		expect(combat['fx'].discardFlights).toHaveLength(0);
		combat.unmount();
	});
});

/**
 * DDB-112: the enemy turn is a phase on screen. The raiders act one at a
 * time on beats of the frame clock, each hit or miss pops its number, and
 * the dock stays locked until the player's draw, which comes after the last
 * action.
 */
describe('CombatScreen enemy turn', () => {
	/** A 2-damage shot that can't miss and reaches anywhere. */
	const jab = (type: string): Card => new Card({
		type,
		name: type,
		summary: type,
		description: type,
		rarity: 'common',
		cost: 1,
		targetType: 'enemy_single',
		effects: [{ type: 'damage', value: 2, always_hits: true }],
		tags: [],
	});

	/** The raider plans two shots that can't miss. */
	async function startRiggedCombat(): Promise<CombatScreen> {
		const combat = await startCombat();
		const battle = combat['battle'];
		const raider = combat['enemyTeam']?.vehicles[0];
		if (!battle || !raider?.driver) throw new Error('the dev fight should field a driven raider');
		const hand = [jab('jab_one'), jab('jab_two')];
		raider.driver.set({ hand, adrenaline: raider.driver.maxAdrenaline });
		battle.planEnemyTurn();
		expect(battle.getPlan(raider).map(action => action.card)).toEqual(expect.arrayContaining(hand));
		expect(battle.getPlan(raider)).toHaveLength(2);
		combat['updateUIFromBattle']();
		advance(context, TURN_BANNER_LIFETIME + 16);
		return combat;
	}

	function expectDockLocked(combat: CombatScreen, locked: boolean): void {
		const endTurn = combat['endTurnColumn'].endTurn;
		expect(combat['dock'].enabled).toBe(!locked);
		expect(endTurn.effectivelyEnabled).toBe(!locked);
		expect(endTurn.label).toBe(locked ? 'WAIT' : 'END TURN');
	}

	async function stepsInOrder(): Promise<void> {
		const combat = await startRiggedCombat();
		const battle = combat['battle'];
		const raider = combat['enemyTeam']?.vehicles[0];
		if (!battle || !raider) throw new Error('rigged');
		const order: string[] = [];
		battle.on('hitLanded', () => order.push('hit'));
		battle.on('hitMissed', () => order.push('miss'));
		battle.on('stateChanged', () => {
			if (battle.isPlayerTurn) order.push(`draw ${combat['playerDrivers'].map(driver => driver.hand.length).join('+')}`);
		});
		const popped = (): number => combat['fx'].children.filter(child => child.componentType === 'FloatingNumber').length;
		const turn = battle.turn;

		combat['endPlayerTurn']();
		expect(battle.isPlayerTurn).toBe(false);
		expect(battle.enemyTurnInProgress).toBe(true);
		expectDockLocked(combat, true);
		expect(combat['playerDrivers'].every(driver => driver.hand.length === 0)).toBe(true);

		// A second press while the raiders act does nothing
		combat['endPlayerTurn']();
		expect(order).toEqual([]);

		// Nothing happens under the banner
		advance(context, ENEMY_TURN_LEAD_IN - 32);
		expect(order).toEqual([]);
		expect(combat.actingRaider).toBeNull();

		advance(context, 48);
		expect(combat.actingRaider).toBe(raider);
		expect(order).toEqual(['hit']);
		expect(popped()).toBe(1);
		expectDockLocked(combat, true);
		expect(battle.turn).toBe(turn);

		advance(context, ENEMY_ACTION_BEAT - 32);
		expect(order).toEqual(['hit']);
		advance(context, 48);
		expect(order).toEqual(['hit', 'hit']);
		expectDockLocked(combat, true);
		expect(combat['playerDrivers'].every(driver => driver.hand.length === 0)).toBe(true);

		// The last action's beat runs out before the player's draw
		advance(context, ENEMY_ACTION_BEAT + 32);
		expect(order).toEqual(['hit', 'hit', 'draw 5+5']);
		expect(battle.turn).toBe(turn + 1);
		expect(combat.actingRaider).toBeNull();
		expectDockLocked(combat, false);
		expect(handCards(combat)).toHaveLength(10);
		combat.unmount();
	}

	it('steps the raider\'s actions one beat apart, the dock locked, and draws only after the last', stepsInOrder);

	it('keeps the same beats under reduced motion, where the numbers hold still', async () => {
		context.animator.reducedMotion = true;
		await stepsInOrder();
	});

	it('pops a miss on the target of a card that fizzled', async () => {
		const combat = await startRiggedCombat();
		const [rig] = combat['playerTeam']?.vehicles ?? [];
		const raider = combat['enemyTeam']?.vehicles[0];
		if (!rig || !raider) throw new Error('the dev fight should field both teams');
		// The first planned card fizzles as it would on a target that slipped out of range
		const stepEnemyTurn = jest.spyOn(Battle.prototype, 'stepEnemyTurn')
			.mockReturnValueOnce({ raider, card: null, target: rig, outcome: 'fizzled' });
		combat['endPlayerTurn']();
		advance(context, ENEMY_TURN_LEAD_IN + 16);
		const numbers = combat['fx'].children.filter((child): child is Text => child.componentType === 'FloatingNumber');
		expect(numbers.map(number => number.text)).toEqual(['MISS']);
		stepEnemyTurn.mockRestore();
		finishEnemyTurn(combat);
		combat.unmount();
	});
});
