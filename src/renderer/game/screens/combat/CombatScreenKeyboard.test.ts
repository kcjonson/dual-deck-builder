/**
 * @jest-environment jsdom
 */
import cardsFile from '../../data/cards.json';
import { CombatScreen } from './CombatScreen';
import { CardLoader } from '../../core/CardLoader';
import { DriverLoader } from '../../core/DriverLoader';
import { Battle } from '../../mechanics/Battle';
import { Card as UICard } from '../../ui/Card';
import { Vehicle as UIVehicle } from '../../ui/Vehicle';
import { Button } from '../../../engine/ui/Button';
import { createTestContext, injectNow } from '../../../engine/components/testing';
import { PointerAdapter } from '../../../engine/input/PointerAdapter';

/**
 * DDB-76: a fight played from the keyboard alone, through the injection hook
 * (R9.25). Tab reaches END TURN and the hand, Enter picks a card, focus goes
 * to the first target, Escape puts the card back, and Enter on a target
 * plays it.
 */

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const context = createTestContext({
	viewport: { get logical() { return { width: window.innerWidth, height: window.innerHeight }; } },
});
const canvas = document.createElement('canvas');
const adapter = new PointerAdapter({ dispatcher: context.dispatcher });
const originalFetch = global.fetch;
/** Target types the combat screen plays at once, with no target to choose. */
const NO_TARGET = ['enemy_all', 'self', 'both_drivers'];

function flushPromises(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

function press(...keys: string[]): void {
	const commands = keys.flatMap(key => [`keydown,${key}`, `keyup,${key}`]);
	expect(injectNow({ canvas, dispatcher: context.dispatcher }, commands).ok).toBe(true);
	// The frame's layout, which ends with the focus fixup (R9.28)
	context.frame.layout();
}

beforeAll(async () => {
	jest.spyOn(console, 'log').mockImplementation(() => undefined);
	global.fetch = jest.fn().mockResolvedValue({ ok: true, statusText: 'OK', json: async () => cardsFile }) as unknown as typeof fetch;
	await CardLoader.getInstance().loadCards();
	await DriverLoader.getInstance().loadDrivers();
	document.body.appendChild(canvas);
	adapter.attach(canvas);
	Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
	Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 882 });
});

afterAll(() => {
	adapter.detach();
	global.fetch = originalFetch;
	jest.restoreAllMocks();
});

describe('CombatScreen from the keyboard', () => {
	it('picks a card, aims it, puts it back, and plays it with Tab, Enter, and Escape', async () => {
		const combat = new CombatScreen();
		combat.mount(context);
		await flushPromises();
		await flushPromises();
		const focus = context.focus;
		const model = combat['combatModel'];

		press('Tab');
		expect(focus.focused).toBeInstanceOf(Button);
		expect(focus.focused?.id).toBe('end_turn_button');
		expect(focus.focused?.focusVisible).toBe(true);

		press('Tab');
		expect(focus.focused).toBeInstanceOf(UICard);
		const firstCard = focus.focused;
		press('ArrowRight');
		expect(focus.focused).toBeInstanceOf(UICard);
		expect(focus.focused).not.toBe(firstCard);
		press('ArrowLeft');
		expect(focus.focused).toBe(firstCard);

		// Along the hand to a card that needs a target, when the deal has one
		const needsTarget = (): boolean => {
			const card = focus.focused;
			return card instanceof UICard && !NO_TARGET.includes(card.getData().targetType);
		};
		for (let step = 0; step < 10 && !needsTarget(); step++) press('ArrowRight');

		const aimed = needsTarget();
		const playCard = jest.spyOn(Battle.prototype, 'playCard');
		press('Enter');
		if (aimed) expect(model.isTargeting).toBe(true);
		if (model.isTargeting) {
			// Straight to the first target, which is all Tab and the arrows visit now
			expect(focus.focused).toBeInstanceOf(UIVehicle);
			expect(focus.focused?.focusVisible).toBe(true);
			expect(model.focusedVehicleId).not.toBeNull();

			press('Escape');
			expect(model.isTargeting).toBe(false);
			expect(focus.focused).toBeInstanceOf(UICard);
			expect(playCard).not.toHaveBeenCalled();

			press('Enter');
			expect(model.isTargeting).toBe(true);
			press('Enter');
		}
		expect(playCard).toHaveBeenCalledTimes(1);
		expect(model.isTargeting).toBe(false);
		// Back in the hand, or on END TURN when nothing is left to play
		expect(focus.focused instanceof UICard || focus.focused?.id === 'end_turn_button').toBe(true);

		playCard.mockRestore();
		combat.unmount();
	});

	it('ends the turn from END TURN with Enter', async () => {
		const combat = new CombatScreen();
		combat.mount(context);
		await flushPromises();
		await flushPromises();

		const endPlayerTurn = jest.spyOn(Battle.prototype, 'endPlayerTurn');
		press('Tab', 'Enter');
		expect(endPlayerTurn).toHaveBeenCalledTimes(1);

		endPlayerTurn.mockRestore();
		combat.unmount();
	});
});
