/**
 * @jest-environment jsdom
 */
import cardsFile from '../../data/cards.json';
import { CombatScreen } from './CombatScreen';
import { CardLoader } from '../../core/CardLoader';
import { DriverLoader } from '../../core/DriverLoader';
import { Card as UICard, CardSize } from '../../ui/Card';
import { createTestContext, injectNow } from '../../../engine/components/testing';
import { Clock } from '../../../engine/animation/Clock';
import { advance, pointer, send } from '../../../engine/services/testing';
import { tokens } from '../../../engine/theme/tokens';
import { PointerAdapter } from '../../../engine/input/PointerAdapter';
import { Battle } from '../../mechanics/Battle';
import { Card } from '../../mechanics/Card';
import type { Rect } from '../../../engine/draw/geometry';
import { NUMBER_LIFETIME } from './CombatFxLayer';
import { Component } from '../../../engine/components/Component';
import type { DrawApi } from '../../../engine/draw/DrawApi';

/**
 * DDB-88: the hand as a fan. A hand card previews large, with its full
 * rules text, over the card, and plays by being dragged onto its target
 * as well as by click-then-target.
 */

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const context = createTestContext({
	viewport: { get logical() { return { width: window.innerWidth, height: window.innerHeight }; } },
	clock: new Clock(),
});
const originalFetch = global.fetch;
const canvas = document.createElement('canvas');
const adapter = new PointerAdapter({ dispatcher: context.dispatcher });

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
	document.body.appendChild(canvas);
	adapter.attach(canvas);
});

afterAll(() => {
	adapter.detach();
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

function inject(...commands: string[]): void {
	expect(injectNow({ canvas, dispatcher: context.dispatcher }, commands).ok).toBe(true);
	context.frame.layout();
}

function centreOf({ x, y, width, height }: Rect): [number, number] {
	return [Math.round(x + width / 2), Math.round(y + height / 2)];
}

/** Presses at `from`, moves there in steps past the drag threshold, and optionally releases. */
function drag(from: [number, number], to: [number, number], { release = true } = {}): void {
	inject(`move,${from[0]},${from[1]}`, `down,${from[0]},${from[1]}`);
	for (let step = 1; step <= 6; step++) {
		const x = Math.round(from[0] + ((to[0] - from[0]) * step) / 6);
		const y = Math.round(from[1] + ((to[1] - from[1]) * step) / 6);
		inject(`move,${x},${y}`);
	}
	if (release) inject(`up,${to[0]},${to[1]}`);
}

/** A strip of the card its right-hand neighbour doesn't cover. */
function grabPoint(card: UICard): [number, number] {
	const { x, y, height } = card.screenBounds;
	return [Math.round(x + 12), Math.round(y + height / 2)];
}

/** The first card in the hand whose target type is one of `types`, dealt in if the hand lacks one. */
function handCard(combat: CombatScreen, types: string[], fallback: string): UICard {
	const found = handCards(combat).find(card => types.includes(card.getData().targetType));
	if (found) return found;
	const [driver] = combat['playerDrivers'];
	const card = CardLoader.getInstance().createCard(fallback) as Card;
	driver.set({ hand: [card, ...driver.hand] });
	combat['updateUIFromBattle']();
	context.frame.layout();
	return handCards(combat)[0];
}

function vehicleBounds(combat: CombatScreen, layer: 'enemyLayer' | 'battlefieldLayer'): Rect {
	const [vehicle] = [...combat[layer]['vehicleCards'].values()];
	return vehicle.screenBounds;
}

describe('CombatScreen drag to play', () => {
	beforeEach(() => setViewport(1280, 720));

	it('plays a card dropped on a raider, drawing the line while it is dragged', async () => {
		const combat = await startCombat();
		const card = handCard(combat, ['enemy_single'], 'headshot');
		const data = card.getData();
		const playCard = jest.spyOn(Battle.prototype, 'playCard');
		const target = centreOf(vehicleBounds(combat, 'enemyLayer'));

		drag(grabPoint(card), target, { release: false });
		expect(context.drag.isDragging).toBe(true);
		expect(context.drag.canDrop).toBe(true);
		expect(combat['fx'].aiming).toBe(true);
		expect(combat['combatModel'].selectedCard).toBe(data);

		// The line runs from the lifted card's top edge to the pointer, found
		// without the screen round trip (no screenQuad, no inverted matrices)
		// The arrow reuses its option objects, so copy what each call saw
		const dots: { x: number; y: number }[] = [];
		const draw = {
			drawCircle: jest.fn(({ center }: { center: { x: number; y: number } }) => dots.push({ ...center })),
			drawPolygon: jest.fn(),
		};
		const screenQuad = jest.spyOn(Component.prototype, 'screenQuad', 'get');
		const screenToLocal = jest.spyOn(Component.prototype, 'screenToLocal');
		combat['fx']['arrow'].render(draw as unknown as DrawApi);
		expect(screenQuad).not.toHaveBeenCalled();
		expect(screenToLocal).not.toHaveBeenCalled();
		screenQuad.mockRestore();
		screenToLocal.mockRestore();
		const [tip] = draw.drawPolygon.mock.calls[0][0].points;
		expect(tip.x).toBeCloseTo(target[0], 6);
		expect(tip.y).toBeCloseTo(target[1], 6);
		const [topLeft, topRight] = card.screenQuad;
		const [firstDot] = dots;
		expect(Math.hypot(firstDot.x - (topLeft.x + topRight.x) / 2, firstDot.y - (topLeft.y + topRight.y) / 2)).toBeLessThan(12);

		inject(`up,${target[0]},${target[1]}`);

		expect(playCard).toHaveBeenCalledTimes(1);
		const [{ targetVehicle }] = playCard.mock.calls[0];
		expect(targetVehicle?.id).toBe(combat['enemyTeam']?.vehicles[0].id);
		expect(combat['fx'].aiming).toBe(false);
		expect(combat['combatModel'].selectedCard).toBeNull();

		playCard.mockRestore();
		combat.unmount();
	});

	it('puts the card back when it is dropped somewhere that is not its target', async () => {
		const combat = await startCombat();
		const card = handCard(combat, ['enemy_single'], 'headshot');
		const playCard = jest.spyOn(Battle.prototype, 'playCard');

		// Your own vehicle is not a Headshot target, and the road does not take a targeted card
		drag(grabPoint(card), centreOf(vehicleBounds(combat, 'battlefieldLayer')));
		expect(playCard).not.toHaveBeenCalled();
		expect(combat['combatModel'].selectedCard).toBeNull();
		expect(combat['combatModel'].isTargeting).toBe(false);
		expect(card.isSelected()).toBe(false);
		expect(combat['fx'].aiming).toBe(false);

		playCard.mockRestore();
		combat.unmount();
	});

	it('cancels a card with no target released on the road, as the design says of any release there', async () => {
		const combat = await startCombat();
		const card = handCard(combat, ['self'], 'repair_kit');
		const playCard = jest.spyOn(Battle.prototype, 'playCard');

		drag(grabPoint(card), [640, 250]);
		expect(playCard).not.toHaveBeenCalled();
		expect(combat['combatModel'].selectedCard).toBeNull();
		expect(combat['combatModel'].targetableVehicleIds).toEqual([]);
		expect(card.isSelected()).toBe(false);

		playCard.mockRestore();
		combat.unmount();
	});

	it('plays a card on its own driver when it is dropped on their vehicle, and not on the partner\'s', async () => {
		const combat = await startCombat();
		const card = handCard(combat, ['self'], 'repair_kit');
		const data = card.getData();
		const owner = combat['playerDrivers'].find(driver => driver.hand.includes(data));
		const vehicles = combat['playerTeam']?.vehicles ?? [];
		const own = vehicles.find(vehicle => vehicle.driver === owner || vehicle.passenger === owner);
		const partner = vehicles.find(vehicle => vehicle !== own);
		const plate = (id: string | undefined) => combat['battlefieldLayer'].vehicleView(id ?? '')?.screenBounds;
		const ownBounds = plate(own?.id);
		const partnerBounds = plate(partner?.id);
		if (!ownBounds || !partnerBounds) throw new Error('both player vehicles should be on the road');
		const playCard = jest.spyOn(Battle.prototype, 'playCard');

		drag(grabPoint(card), centreOf(partnerBounds));
		expect(playCard).not.toHaveBeenCalled();
		expect(combat['combatModel'].selectedCard).toBeNull();

		drag(grabPoint(card), centreOf(ownBounds), { release: false });
		expect(context.drag.canDrop).toBe(true);
		inject(`up,${centreOf(ownBounds).join(',')}`);
		expect(playCard).toHaveBeenCalledTimes(1);
		expect(playCard.mock.calls[0][0].targetVehicle).toBeUndefined();

		playCard.mockRestore();
		combat.unmount();
	});

	it('cancels on Escape mid-drag, and the release plays nothing', async () => {
		const combat = await startCombat();
		const card = handCard(combat, ['enemy_single'], 'headshot');
		const playCard = jest.spyOn(Battle.prototype, 'playCard');
		const target = centreOf(vehicleBounds(combat, 'enemyLayer'));

		drag(grabPoint(card), target, { release: false });
		inject('keydown,Escape', 'keyup,Escape');
		expect(context.drag.isDragging).toBe(false);
		expect(combat['combatModel'].selectedCard).toBeNull();
		inject(`up,${target[0]},${target[1]}`);
		expect(playCard).not.toHaveBeenCalled();

		playCard.mockRestore();
		combat.unmount();
	});

	it('leaves a mouse player\'s focus without a ring when Escape cancels a drag or targeting (R9.23)', async () => {
		const combat = await startCombat();
		const card = handCard(combat, ['enemy_single'], 'headshot');
		const target = centreOf(vehicleBounds(combat, 'enemyLayer'));

		drag(grabPoint(card), target, { release: false });
		inject('keydown,Escape', 'keyup,Escape');
		inject(`up,${target[0]},${target[1]}`);
		expect(context.focus.focused).not.toBeNull();
		expect(context.focus.focusVisible).toBe(false);
		expect(context.focus.focused?.focusVisible).toBe(false);

		const [cx, cy] = grabPoint(card);
		inject(`click,${cx},${cy}`);
		expect(combat['combatModel'].isTargeting).toBe(true);
		inject('keydown,Escape', 'keyup,Escape');
		expect(combat['combatModel'].isTargeting).toBe(false);
		expect(context.focus.focusVisible).toBe(false);

		combat.unmount();
	});

	it('still plays by click-then-target, since a press that never moves is a click', async () => {
		const combat = await startCombat();
		const card = handCard(combat, ['enemy_single'], 'headshot');
		const playCard = jest.spyOn(Battle.prototype, 'playCard');

		const [cx, cy] = grabPoint(card);
		inject(`click,${cx},${cy}`);
		expect(combat['combatModel'].isTargeting).toBe(true);
		const [tx, ty] = centreOf(vehicleBounds(combat, 'enemyLayer'));
		inject(`click,${tx},${ty}`);
		expect(playCard).toHaveBeenCalledTimes(1);

		playCard.mockRestore();
		combat.unmount();
	});
});

describe('CombatScreen drag to play, then to the pile', () => {
	beforeEach(() => setViewport(1280, 720));

	it('lands a card dropped on a raider\'s intent disc on that raider', async () => {
		const combat = await startCombat();
		const card = handCard(combat, ['enemy_single'], 'headshot');
		const [raider] = combat['enemyTeam']?.vehicles ?? [];
		context.animator.settle();
		context.frame.layout();
		const [disc] = combat['enemyLayer'].intentRowOf(raider.id)?.getChildren() ?? [];
		if (!disc) throw new Error('the raider should plan something');
		const playCard = jest.spyOn(Battle.prototype, 'playCard');
		const target = centreOf(disc.screenBounds);

		drag(grabPoint(card), target, { release: false });
		expect(context.drag.canDrop).toBe(true);
		expect(combat['combatModel'].focusedVehicleId).toBe(raider.id);
		inject(`up,${target[0]},${target[1]}`);
		expect(playCard).toHaveBeenCalledTimes(1);
		expect(playCard.mock.calls[0][0].targetVehicle?.id).toBe(raider.id);

		playCard.mockRestore();
		combat.unmount();
	});

	it('sends a card played by a drop to its pile from where it was dropped, not from its slot', async () => {
		const combat = await startCombat();
		const card = handCard(combat, ['enemy_single'], 'headshot');
		const slot = card.screenBounds;
		const target = centreOf(vehicleBounds(combat, 'enemyLayer'));

		drag(grabPoint(card), target);
		const [flight] = combat['fx'].discardFlights;
		expect(flight).toBeDefined();
		const start = flight.screenBounds;
		expect(start.x + start.width / 2).toBeCloseTo(target[0], 0);
		expect(start.y + start.height / 2).toBeCloseTo(target[1], 0);
		expect(Math.abs(start.y + start.height / 2 - (slot.y + slot.height / 2))).toBeGreaterThan(100);

		combat.unmount();
	});
});

describe('CombatScreen drag to play, cancelled by the other button', () => {
	beforeEach(() => setViewport(1280, 720));

	it('cancels on a right-click mid-drag', async () => {
		const combat = await startCombat();
		const card = handCard(combat, ['enemy_single'], 'headshot');
		const playCard = jest.spyOn(Battle.prototype, 'playCard');
		const target = centreOf(vehicleBounds(combat, 'enemyLayer'));

		drag(grabPoint(card), target, { release: false });
		inject(`down,${target[0]},${target[1]},2`);
		expect(context.drag.isDragging).toBe(false);
		expect(combat['combatModel'].selectedCard).toBeNull();
		inject(`up,${target[0]},${target[1]},2`, `up,${target[0]},${target[1]}`);
		expect(playCard).not.toHaveBeenCalled();

		playCard.mockRestore();
		combat.unmount();
	});
});

describe('CombatScreen floating numbers', () => {
	beforeEach(() => setViewport(1280, 720));

	it('floats a hit up off the top of the vehicle it landed on, and fades it out', async () => {
		const combat = await startCombat();
		const fx = combat['fx'];
		const [raider] = combat['enemyTeam']?.vehicles ?? [];
		const plate = vehicleBounds(combat, 'enemyLayer');
		combat['popHitNumber']({ vehicle: raider, damage: 6 });

		const [number] = fx.floatingNumbers;
		expect(number.getText()).toBe('-6');
		const start = number.screenBounds;
		expect(start.x + start.width / 2).toBeCloseTo(plate.x + plate.width / 2, 6);
		expect(start.y).toBeGreaterThan(plate.y);

		advance(context, 400);
		expect(number.screenBounds.y).toBeLessThan(start.y);
		advance(context, 400);
		expect(number.opacity).toBeLessThan(1);
		advance(context, 200);
		expect(fx.floatingNumbers).toHaveLength(0);

		combat.unmount();
	});

	it('holds a number still for its whole life under reduced motion, then removes it', async () => {
		const combat = await startCombat();
		const fx = combat['fx'];
		const [raider] = combat['enemyTeam']?.vehicles ?? [];
		context.animator.reducedMotion = true;
		try {
			combat['popHitNumber']({ vehicle: raider, damage: 6 });
			const [number] = fx.floatingNumbers;
			const start = number.screenBounds;
			advance(context, 16);
			expect(fx.floatingNumbers).toEqual([number]);
			advance(context, NUMBER_LIFETIME - 100);
			expect(fx.floatingNumbers).toEqual([number]);
			expect(number.opacity).toBe(1);
			expect(number.screenBounds.y).toBe(start.y);
			advance(context, 200);
			expect(fx.floatingNumbers).toHaveLength(0);
		} finally {
			context.animator.reducedMotion = false;
		}

		combat.unmount();
	});

	it('stacks a second number on the same vehicle under the first, and says MISS for a miss', async () => {
		const combat = await startCombat();
		const fx = combat['fx'];
		const [raider] = combat['enemyTeam']?.vehicles ?? [];
		combat['popHitNumber']({ vehicle: raider, damage: 4 });
		combat['popHitNumber']({ vehicle: raider, damage: null });

		const [first, second] = fx.floatingNumbers;
		expect(second.getText()).toBe('MISS');
		expect(second.screenBounds.y).toBeGreaterThan(first.screenBounds.y);

		combat.unmount();
		expect(context.animator.active).toBe(0);
	});

	it('pops a number for each hit or miss of a card dragged onto a raider', async () => {
		const combat = await startCombat();
		const card = handCard(combat, ['enemy_single'], 'headshot');
		const battle = combat['battle'];
		const resolved = () => (battle?.getMessages() ?? []).filter(message => message.type === 'damage_dealt' || message.type === 'miss').length;
		const before = resolved();

		drag(grabPoint(card), centreOf(vehicleBounds(combat, 'enemyLayer')));
		const numbers = combat['fx'].floatingNumbers.map(number => number.getText());
		expect(numbers.length).toBeGreaterThan(0);
		expect(numbers).toHaveLength(resolved() - before);
		expect(numbers.every(text => text === 'MISS' || /^-\d+$/.test(text))).toBe(true);

		combat.unmount();
	});
});
