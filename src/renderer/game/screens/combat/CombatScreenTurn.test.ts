/**
 * @jest-environment jsdom
 */
import cardsFile from '../../data/cards.json';
import { CombatScreen } from './CombatScreen';
import { CardLoader } from '../../core/CardLoader';
import { DriverLoader } from '../../core/DriverLoader';
import { Card } from '../../mechanics/Card';
import { Card as UICard } from '../../ui/Card';
import { IntentRow } from '../../ui/IntentMarker';
import { createTestContext } from '../../../engine/components/testing';
import { Clock } from '../../../engine/animation/Clock';
import { advance } from '../../../engine/services/testing';
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
	return layer.getHandCards().map(card => layer.getCardElementByCard(card)).filter((card): card is UICard => card !== null);
}

/** A card of the first driver's that plays at once on a click, dealt in if the hand lacks one. */
function noTargetCard(combat: CombatScreen): UICard {
	const [driver] = combat['playerDrivers'];
	const found = handCards(combat).find(card => card.getData().targetType === 'self' && driver.hand.includes(card.getData()));
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
		expect(banner.isVisible()).toBe(true);
		const road = combat['stage'].getChildren()[0].getChildren()[1];
		advance(context, 16);
		expect(banner.screenBounds.width).toBeCloseTo(road.screenBounds.width, 6);
		expect(banner.screenBounds.y).toBeGreaterThan(road.screenBounds.y);
		expect(banner.screenBounds.y + banner.screenBounds.height).toBeLessThan(road.screenBounds.y + road.screenBounds.height);

		advance(context, TURN_BANNER_LIFETIME);
		expect(banner.current).toBeNull();
		expect(banner.isVisible()).toBe(false);
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
			const plate = combat['enemyLayer'].vehicleView(raider.id);
			const row = plate?.getChildren().find((child): child is IntentRow => child instanceof IntentRow);
			expect(row?.intents.length).toBe(Math.min(planned.length, 2) + (planned.length > 2 ? 1 : 0));
			if (planned.length > 0) expect(row?.intents[0].description).toBe(planned[0].description);
		}
		combat.unmount();
	});
});

describe('CombatScreen discard flights', () => {
	it('flies a played card from where it sat in the hand to its driver\'s discard pile', async () => {
		const combat = await startCombat();
		const card = noTargetCard(combat);
		const from = card.screenBounds;
		combat['chooseCard'](card.getData(), 'click');
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

	it('flies nothing under reduced motion, where the pile count is the whole story', async () => {
		context.animator.reducedMotion = true;
		const combat = await startCombat();
		combat['endPlayerTurn']();
		expect(combat['fx'].discardFlights).toHaveLength(0);
		combat.unmount();
	});
});
