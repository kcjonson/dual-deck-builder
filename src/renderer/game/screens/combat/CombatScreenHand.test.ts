/**
 * @jest-environment jsdom
 */
import cardsFile from '../../data/cards.json';
import { CombatScreen } from './CombatScreen';
import { CardLoader } from '../../core/CardLoader';
import { DriverLoader } from '../../core/DriverLoader';
import { Card as UICard, CardSize } from '../../ui/Card';
import { createTestContext } from '../../../engine/components/testing';
import { Clock } from '../../../engine/animation/Clock';
import { advance, pointer, send } from '../../../engine/services/testing';
import { tokens } from '../../../engine/theme/tokens';

/**
 * DDB-88: the hand as a fan. A hand card previews large, with its full
 * rules text, over the card.
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

function setViewport(width: number, height: number): void {
	Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
	Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
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

beforeAll(async () => {
	jest.spyOn(console, 'log').mockImplementation(() => undefined);
	global.fetch = jest.fn().mockResolvedValue({ ok: true, statusText: 'OK', json: async () => cardsFile }) as unknown as typeof fetch;
	await CardLoader.getInstance().loadCards();
	await DriverLoader.getInstance().loadDrivers();
});

afterAll(() => {
	global.fetch = originalFetch;
	jest.restoreAllMocks();
});

describe('CombatScreen hand previews', () => {
	it.each([
		[1280, 720, 1],
		[800, 450, 0.8],
	])('at %ix%i, shows a hand card large with its full text, centred over it at the stage scale', async (width, height, scale) => {
		setViewport(width, height);
		const combat = await startCombat();
		const [card] = handCards(combat);
		expect(card.tooltip?.factory).toBeDefined();

		context.tooltips.show(card, { fade: false });
		const preview = context.tooltips.surface;
		expect(preview?.id).toBe('card_preview');
		const large = UICard.getDimensions(CardSize.LARGE);
		expect(preview?.width).toBeCloseTo(large.width * scale, 6);
		// At 800x450 the room above the lifted card is a tenth of a pixel
		// short, so placement clamps it by that much
		expect(preview?.height).toBeGreaterThan(large.height * scale - 0.5);
		expect(preview?.height).toBeLessThanOrEqual(large.height * scale + 1e-6);

		const cardBounds = card.screenBounds;
		const previewBounds = preview?.screenBounds;
		expect(previewBounds).toBeDefined();
		if (!previewBounds) return;
		// Above the card, never over the rest of the hand, and inside the screen
		expect(previewBounds.y + previewBounds.height).toBeLessThanOrEqual(card.liftedScreenBounds.y + 1e-6);
		expect(previewBounds.y + previewBounds.height).toBeLessThanOrEqual(cardBounds.y + 1e-6);
		expect(previewBounds.y).toBeGreaterThanOrEqual(0);
		expect(previewBounds.x).toBeGreaterThanOrEqual(0);
		expect(previewBounds.x + previewBounds.width).toBeLessThanOrEqual(width);

		const description = previewTexts(preview).find(text => text.id === 'card_preview_face_description');
		expect(description?.getText()).toBe(card.getData().displayDescription);

		context.tooltips.hide();
		context.animator.settle();
		combat.unmount();
	});

	it('keeps the preview clear of a card it swaps to before that card has finished rising', async () => {
		setViewport(1280, 720);
		const combat = await startCombat();
		const [first, second] = handCards(combat);
		const centre = (card: UICard) => {
			const bounds = card.screenBounds;
			return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * 0.75 };
		};
		const from = centre(first);
		send(context, [pointer('move', from.x, from.y)]);
		advance(context, tokens.control.tooltip_delay + tokens.motion.dur_fast + 100);
		expect(context.tooltips.owner).toBe(first);
		expect(context.tooltips.state).toBe('visible');

		// No delay on the swap, so the preview is placed while the new card is mid-lift
		const to = centre(second);
		send(context, [pointer('move', to.x, to.y)]);
		expect(context.tooltips.owner).toBe(second);
		expect(second.lifted).toBe(true);
		expect(second.screenBounds.y).toBeGreaterThan(second.liftedScreenBounds.y + 1);

		context.animator.settle();
		context.frame.layout();
		const preview = context.tooltips.surface?.screenBounds;
		expect(preview).toBeDefined();
		if (!preview) return;
		expect(preview.y + preview.height).toBeLessThanOrEqual(second.screenBounds.y + 1e-6);

		context.tooltips.hide();
		context.animator.settle();
		combat.unmount();
	});

	it('shows the preview at once when keyboard focus reaches a card', async () => {
		setViewport(1280, 720);
		const combat = await startCombat();
		const [card] = handCards(combat);
		context.tooltips.focusVisibleChange(card);
		expect(context.tooltips.owner).toBe(card);
		expect(context.tooltips.surface?.id).toBe('card_preview');

		context.tooltips.focusVisibleChange(null);
		context.animator.settle();
		combat.unmount();
	});

	it('fans each half: the edge cards turn outward and the middle one stands upright', async () => {
		setViewport(1280, 720);
		const combat = await startCombat();
		const half = combat['handLayer'].getHandCards().slice(0, 5).map(card => combat['handLayer'].getCardElementByCard(card));
		const turns = half.map(card => card?.transform.rotate ?? NaN);
		expect(turns[0]).toBeLessThan(0);
		expect(turns[2]).toBeCloseTo(0, 9);
		expect(turns[4]).toBeGreaterThan(0);
		combat.unmount();
	});
});

function previewTexts(component: { getChildren(): readonly unknown[] } | null | undefined): { id: string | null; getText(): string }[] {
	if (!component) return [];
	const found: { id: string | null; getText(): string }[] = [];
	for (const child of component.getChildren()) {
		const node = child as { id: string | null; getText?: () => string; getChildren(): readonly unknown[] };
		if (typeof node.getText === 'function') found.push(node as { id: string | null; getText(): string });
		found.push(...previewTexts(node));
	}
	return found;
}
