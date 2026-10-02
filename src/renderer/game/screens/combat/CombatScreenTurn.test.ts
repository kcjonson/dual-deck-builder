/**
 * @jest-environment jsdom
 */
import cardsFile from '../../data/cards.json';
import { CombatScreen } from './CombatScreen';
import { CardLoader } from '../../core/CardLoader';
import { DriverLoader } from '../../core/DriverLoader';
import { Card } from '../../mechanics/Card';
import { Card as UICard } from '../../ui/Card';
import { IntentMarker } from '../../ui/IntentMarker';
import { createTestContext } from '../../../engine/components/testing';
import { Clock } from '../../../engine/animation/Clock';
import { advance, pointer, send } from '../../../engine/services/testing';
import { Text } from '../../../engine/components/Text';
import type { Component } from '../../../engine/components/Component';
import { tokens } from '../../../engine/theme/tokens';
import { TURN_BANNER_LIFETIME } from './TurnBanner';

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

	it('shows the enemy\'s turn, then yours, one after the other, sliding in and fading', async () => {
		const combat = await startCombat();
		const banner = combat['turnBanner'];
		advance(context, TURN_BANNER_LIFETIME + 16);

		combat['endPlayerTurn']();
		expect(banner.text).toBe('ENEMY TURN');
		advance(context, 16);
		expect(banner.opacity).toBeLessThan(1);
		advance(context, tokens.motion.dur);
		expect(banner.opacity).toBe(1);
		advance(context, TURN_BANNER_LIFETIME - tokens.motion.dur);
		expect(banner.text).toBe('YOUR TURN');
		advance(context, TURN_BANNER_LIFETIME);
		expect(banner.current).toBeNull();
		combat.unmount();
	});

	it('coalesces quick turn changes, so it ends on whose turn it is now', async () => {
		const combat = await startCombat();
		const banner = combat['turnBanner'];
		advance(context, 16);
		combat['endPlayerTurn']();
		combat['endPlayerTurn']();
		expect(combat['battle']?.isPlayerTurn).toBe(true);
		expect(banner.pending).toEqual(['enemy', 'player']);

		// YOUR TURN from the start leaves at once, then one ENEMY TURN, then YOUR TURN
		advance(context, tokens.motion.dur + 16);
		expect(banner.text).toBe('ENEMY TURN');
		advance(context, TURN_BANNER_LIFETIME);
		expect(banner.text).toBe('YOUR TURN');
		expect(banner.pending).toEqual([]);
		advance(context, TURN_BANNER_LIFETIME);
		expect(banner.current).toBeNull();
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
			const row = combat['enemyLayer'].intentRowOf(raider.id);
			expect(row?.intents.length).toBe(Math.min(planned.length, 2) + (planned.length > 2 ? 1 : 0));
			if (planned.length > 0) expect(row?.intents[0].description).toBe(planned[0].description);
		}
		combat.unmount();
	});

	it('shows a disc\'s tooltip when the pointer rests on it, beside a plate that is one hit target', async () => {
		const combat = await startCombat();
		const [raider] = combat['enemyTeam']?.vehicles ?? [];
		const row = combat['enemyLayer'].intentRowOf(raider.id);
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
		expect(combat['playerDrivers'].some(driver => (driver.deck?.cards.length ?? 0) > 0)).toBe(true);
		expect(combat['fx'].discardFlights).toHaveLength(held);
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
