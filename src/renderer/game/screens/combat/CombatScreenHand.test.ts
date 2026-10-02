/**
 * @jest-environment jsdom
 */
import cardsFile from '../../data/cards.json';
import { CombatScreen } from './CombatScreen';
import { CardLoader } from '../../core/CardLoader';
import { DriverLoader } from '../../core/DriverLoader';
import { Card as UICard } from '../../ui/Card';
import { CardInspectSurface } from '../../ui/cardInspect';
import { DETAIL } from '../../ui/CardDetailView';
import { cardKeywords } from '../../data/keywords';
import { createTestContext, injectNow } from '../../../engine/components/testing';
import { Clock } from '../../../engine/animation/Clock';
import { advance, key, pointer, send } from '../../../engine/services/testing';
import { tokens } from '../../../engine/theme/tokens';
import { PointerAdapter } from '../../../engine/input/PointerAdapter';
import { Battle } from '../../mechanics/Battle';
import { Card } from '../../mechanics/Card';
import { RoadLane, RoadRow } from '../../mechanics/Road';
import type { Rect } from '../../../engine/draw/geometry';
import { NUMBER_LIFETIME } from './CombatFxLayer';
import { Component } from '../../../engine/components/Component';
import type { DrawApi } from '../../../engine/draw/DrawApi';

/**
 * DDB-88: the hand as a fan, played by being dragged onto its target as
 * well as by click-then-target. DDB-137: a hand card opens section 5's
 * detail view, which pins.
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
	return layer.handCards.map(card => layer.getCardElementByCard(card)).filter((card): card is UICard => card !== null);
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

describe('CombatScreen card detail view (DDB-137)', () => {
	it.each([
		[1280, 720, 1],
		[800, 450, 0.8],
	])('at %ix%i, shows the detail view at the stage scale, resting on the bottom of the screen, centred over the card', async (width, height, scale) => {
		setViewport(width, height);
		const combat = await startCombat();
		const card = handCards(combat)[2];
		expect(card.tooltip?.factory).toBeDefined();

		context.tooltips.show(card, { fade: false });
		const surface = context.tooltips.surface;
		expect(surface).toBeInstanceOf(CardInspectSurface);
		if (!(surface instanceof CardInspectSurface)) return;
		const bounds = surface.screenBounds;
		// 10 logical pixels above the screen's bottom edge, inside the screen
		expect(bounds.y + bounds.height).toBeCloseTo(height - 10 * scale, 6);
		expect(bounds.y).toBeGreaterThanOrEqual(0);
		expect(bounds.x).toBeGreaterThanOrEqual(0);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1e-6);
		// The detail view, scaled, centred over the card unless the screen's edge clamps it
		const detail = surface.view.detail.screenBounds;
		expect(detail.width).toBeCloseTo(DETAIL.width * scale, 6);
		const cardBounds = card.screenBounds;
		const centre = cardBounds.x + cardBounds.width / 2;
		const clamped = Math.max(8 * scale, Math.min(centre - detail.width / 2, width - 8 * scale - detail.width));
		expect(detail.x).toBeCloseTo(clamped, 4);
		expect(surface.view.detail.data.id).toBe(card.data.id);

		context.tooltips.hide();
		context.animator.settle();
		combat.unmount();
	});

	it('moves to the next card without the delay when the pointer slides along the hand', async () => {
		setViewport(1280, 720);
		const combat = await startCombat();
		const [first, second] = handCards(combat);
		const point = (card: UICard) => {
			const bounds = card.screenBounds;
			return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * 0.75 };
		};
		const from = point(first);
		send(context, [pointer('move', from.x, from.y)]);
		advance(context, tokens.control.tooltip_delay + tokens.motion.dur_fast + 100);
		expect(context.tooltips.owner).toBe(first);
		const to = point(second);
		send(context, [pointer('move', to.x, to.y)]);
		expect(context.tooltips.owner).toBe(second);
		const surface = context.tooltips.surface;
		expect(surface instanceof CardInspectSurface ? surface.view.detail.data.id : null).toBe(second.data.id);

		context.tooltips.hide();
		context.animator.settle();
		combat.unmount();
	});

	it('shows it at once when keyboard focus reaches a card', async () => {
		setViewport(1280, 720);
		const combat = await startCombat();
		const [card] = handCards(combat);
		context.tooltips.focusVisibleChange(card);
		expect(context.tooltips.owner).toBe(card);
		expect(context.tooltips.surface?.id).toBe('card_detail');

		context.tooltips.focusVisibleChange(null);
		context.animator.settle();
		combat.unmount();
	});

	it('pins on a secondary click and stays while the pointer goes to the road, then lets go on another', async () => {
		setViewport(1280, 720);
		const combat = await startCombat();
		const card = handCards(combat)[1];
		const [x, y] = grabPoint(card);
		send(context, [pointer('move', x, y), pointer('down', x, y, { button: 2 }), pointer('up', x, y, { button: 2 })]);
		expect(context.tooltips.pinned).toBe(card);
		const surface = context.tooltips.surface;
		expect(surface instanceof CardInspectSurface && texts(surface).includes('PINNED')).toBe(true);

		// Over the road, where the hover would have dropped it
		send(context, [pointer('move', 640, 200)]);
		advance(context, tokens.motion.dur_tooltip_hide + 100);
		expect(context.tooltips.pinned).toBe(card);
		expect(context.tooltips.surface).not.toBeNull();

		send(context, [pointer('move', x, y), pointer('down', x, y, { button: 2 }), pointer('up', x, y, { button: 2 })]);
		expect(context.tooltips.pinned).toBeNull();
		combat.unmount();
	});

	it('pins a card its driver can\'t play, which delivery skips', async () => {
		setViewport(1280, 720);
		const combat = await startCombat();
		const card = handCards(combat)[0];
		card.enabled = false;
		const [x, y] = grabPoint(card);
		send(context, [pointer('move', x, y), pointer('down', x, y, { button: 2 }), pointer('up', x, y, { button: 2 })]);
		expect(context.tooltips.pinned).toBe(card);
		context.tooltips.hide();
		context.overlays.closeAll();
		combat.unmount();
	});

	it('pins the card being read with I, and lets it go with I', async () => {
		setViewport(1280, 720);
		const combat = await startCombat();
		const [card] = handCards(combat);
		context.focus.focus(card, 'keyboard');
		context.tooltips.focusVisibleChange(card);
		send(context, [key('i')]);
		expect(context.tooltips.pinned).toBe(card);
		send(context, [key('i')]);
		expect(context.tooltips.pinned).toBeNull();
		combat.unmount();
	});

	it('opens on a touch hold, and the hold does not play the card', async () => {
		setViewport(1280, 720);
		const combat = await startCombat();
		const card = handCards(combat)[1];
		const playCard = jest.spyOn(Battle.prototype, 'playCard');
		const [x, y] = grabPoint(card);
		send(context, [pointer('down', x, y, { pointerType: 'touch' })]);
		advance(context, 600);
		expect(context.tooltips.owner).toBe(card);
		expect(context.tooltips.surface).not.toBeNull();
		send(context, [pointer('up', x, y, { pointerType: 'touch' })]);
		expect(playCard).not.toHaveBeenCalled();
		expect(combat['combatModel'].selectedCard).toBeNull();
		playCard.mockRestore();
		context.tooltips.hide();
		combat.unmount();
	});

	it('puts driver 2\'s keyword boxes on the left when there is room there', async () => {
		setViewport(1280, 720);
		const combat = await startCombat();
		const card = handCards(combat).find((candidate) => candidate.driver === 2 && cardKeywords(candidate.data).length > 0);
		expect(card).toBeDefined();
		if (!card) return;
		context.tooltips.show(card, { fade: false });
		const surface = context.tooltips.surface;
		expect(surface instanceof CardInspectSurface && surface.view.keywordSide).toBe('left');
		context.tooltips.hide();
		combat.unmount();
	});

	it('opens a driver\'s draw and discard piles from the pile icons on their tab', async () => {
		setViewport(1280, 720);
		const combat = await startCombat();
		const tab = combat['handLayer'].pilesOf(1).parent;
		expect(tab).not.toBeNull();
		if (!tab) return;
		const [x, y] = centreOf(tab.screenBounds);
		send(context, [pointer('move', x, y), pointer('down', x, y), pointer('up', x, y)]);
		const root = context.overlays.roots.find((candidate) => candidate.children[0]?.id === 'piles_dialog');
		expect(root).toBeDefined();
		const [driver] = combat['playerDrivers'];
		const faces = root ? texts(root) : [];
		expect(faces).toContain(`Draw pile (${driver.deck?.cards.length ?? 0})`);
		expect(faces).toContain(`Discard pile (${driver.discard.length})`);
		context.overlays.closeAll();
		combat.unmount();
	});

	it('sets a hand pin aside while the pile dialog is open, inspects the pile there, and gives the pin back on close', async () => {
		setViewport(1280, 720);
		const combat = await startCombat();
		const card = handCards(combat)[1];
		const [x, y] = grabPoint(card);
		send(context, [pointer('move', x, y), pointer('down', x, y, { button: 2 }), pointer('up', x, y, { button: 2 })]);
		expect(context.tooltips.pinned).toBe(card);

		const tab = combat['handLayer'].pilesOf(1).parent;
		if (!tab) throw new Error('no tab');
		const [tx, ty] = centreOf(tab.screenBounds);
		send(context, [pointer('move', tx, ty), pointer('down', tx, ty), pointer('up', tx, ty)]);
		expect(context.tooltips.pinned).toBeNull();
		expect(context.tooltips.surface).toBeNull();

		const root = context.overlays.roots.find((candidate) => candidate.children[0]?.id === 'piles_dialog');
		const face = root ? findById(root, 'piles_draw_card_0') : null;
		expect(face).not.toBeNull();
		if (!face) return;
		context.focus.focus(face, 'keyboard');
		context.tooltips.focusVisibleChange(face);
		expect(context.tooltips.owner).toBe(face);

		// The dialog closes on Escape once it has finished opening
		advance(context, 400);
		send(context, [key('Escape')]);
		advance(context, 400);
		expect(context.overlays.roots.some((candidate) => candidate.children[0]?.id === 'piles_dialog')).toBe(false);
		expect(context.tooltips.pinned).toBe(card);
		context.tooltips.hide();
		context.overlays.closeAll();
		combat.unmount();
	});

	it('cancels a click-then-target choice on a secondary click on another card, and pins nothing', async () => {
		setViewport(1280, 720);
		const combat = await startCombat();
		const card = handCard(combat, ['enemy_single'], 'headshot');
		const [x, y] = grabPoint(card);
		send(context, [pointer('move', x, y), pointer('down', x, y), pointer('up', x, y)]);
		expect(combat['combatModel'].isTargeting).toBe(true);

		const other = handCards(combat).find((candidate) => candidate !== card && candidate.driver === card.driver) as UICard;
		const [ox, oy] = centreOf(other.screenBounds);
		send(context, [pointer('move', ox, oy), pointer('down', ox, oy, { button: 2 }), pointer('up', ox, oy, { button: 2 })]);
		expect(combat['combatModel'].isTargeting).toBe(false);
		expect(context.tooltips.pinned).toBeNull();
		combat.unmount();
	});

	it('fans each half: the edge cards turn outward and the middle one stands upright', async () => {
		setViewport(1280, 720);
		const combat = await startCombat();
		const half = combat['handLayer'].handCards.slice(0, 5).map(card => combat['handLayer'].getCardElementByCard(card));
		const turns = half.map(card => card?.transform.rotate ?? NaN);
		expect(turns[0]).toBeLessThan(0);
		expect(turns[2]).toBeCloseTo(0, 9);
		expect(turns[4]).toBeGreaterThan(0);
		combat.unmount();
	});
});

/** The component with `id` under `root`, at any depth. */
function findById(root: { children: readonly unknown[] }, id: string): UICard | null {
	for (const child of root.children) {
		const node = child as UICard;
		if (node.id === id) return node;
		const found = findById(node, id);
		if (found) return found;
	}
	return null;
}

/** Every string drawn under `component`, a Text's or a keyword run's. */
function texts(component: { children: readonly unknown[] }): string[] {
	const found: string[] = [];
	for (const child of component.children) {
		const node = child as { text?: unknown; children: readonly unknown[] };
		if (typeof node.text === 'string') found.push(node.text);
		found.push(...texts(node));
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
	const found = handCards(combat).find(card => types.includes(card.data.targetType));
	if (found) return found;
	const [driver] = combat['playerDrivers'];
	const card = CardLoader.getInstance().createCard(fallback) as Card;
	driver.set({ hand: [card, ...driver.hand] });
	combat['updateUIFromBattle']();
	context.frame.layout();
	return handCards(combat)[0];
}

/** The middle of an empty slot, on screen: the raiders' flank, behind, where nobody starts. */
function emptyRoadPoint(combat: CombatScreen): [number, number] {
	const road = combat['road'];
	const slot = { lane: RoadLane.PLAYER_SHOULDER, row: RoadRow.BEHIND };
	expect(road.vehicleView(combat['enemyTeam']?.vehicles.find(vehicle => vehicle.slot?.lane === slot.lane && vehicle.slot?.row === slot.row)?.id ?? '')).toBeNull();
	const rect = road.slotRect(slot);
	const { x, y } = road.localToScreen({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
	return [Math.round(x), Math.round(y)];
}

/** A token's plate on screen: where a card is dropped, and where a hit's number pops. */
function vehicleBounds(combat: CombatScreen, team: 'enemyTeam' | 'playerTeam'): Rect {
	const [vehicle] = combat[team]?.vehicles ?? [];
	const token = combat['road'].vehicleView(vehicle?.id ?? '');
	if (!token) throw new Error(`the ${team}'s first vehicle should be on the road`);
	return token.plateScreenBounds;
}

describe('CombatScreen drag to play', () => {
	beforeEach(() => setViewport(1280, 720));

	it('plays a card dropped on a raider, drawing the line while it is dragged', async () => {
		const combat = await startCombat();
		const card = handCard(combat, ['enemy_single'], 'headshot');
		const data = card.data;
		const playCard = jest.spyOn(Battle.prototype, 'playCard');
		const target = centreOf(vehicleBounds(combat, 'enemyTeam'));

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
		drag(grabPoint(card), centreOf(vehicleBounds(combat, 'playerTeam')));
		expect(playCard).not.toHaveBeenCalled();
		expect(combat['combatModel'].selectedCard).toBeNull();
		expect(combat['combatModel'].isTargeting).toBe(false);
		expect(card.selected).toBe(false);
		expect(combat['fx'].aiming).toBe(false);

		playCard.mockRestore();
		combat.unmount();
	});

	it('cancels a card with no target released on the road, as the design says of any release there', async () => {
		const combat = await startCombat();
		const card = handCard(combat, ['self'], 'repair_kit');
		const playCard = jest.spyOn(Battle.prototype, 'playCard');

		// An empty slot on the raiders' flank, where no vehicle is
		drag(grabPoint(card), emptyRoadPoint(combat));
		expect(playCard).not.toHaveBeenCalled();
		expect(combat['combatModel'].selectedCard).toBeNull();
		expect(combat['combatModel'].targetableVehicleIds).toEqual([]);
		expect(card.selected).toBe(false);

		playCard.mockRestore();
		combat.unmount();
	});

	it('plays a card on its own driver when it is dropped on their vehicle, and not on the partner\'s', async () => {
		const combat = await startCombat();
		const card = handCard(combat, ['self'], 'repair_kit');
		const data = card.data;
		const owner = combat['playerDrivers'].find(driver => driver.hand.includes(data));
		const vehicles = combat['playerTeam']?.vehicles ?? [];
		const own = vehicles.find(vehicle => vehicle.driver === owner || vehicle.passenger === owner);
		const partner = vehicles.find(vehicle => vehicle !== own);
		const plate = (id: string | undefined) => combat['road'].vehicleView(id ?? '')?.screenBounds;
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
		const target = centreOf(vehicleBounds(combat, 'enemyTeam'));

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
		const target = centreOf(vehicleBounds(combat, 'enemyTeam'));

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
		const [tx, ty] = centreOf(vehicleBounds(combat, 'enemyTeam'));
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
		const [disc] = combat['road'].intentRowOf(raider.id)?.children ?? [];
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
		const target = centreOf(vehicleBounds(combat, 'enemyTeam'));

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
		const target = centreOf(vehicleBounds(combat, 'enemyTeam'));

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
		const plate = vehicleBounds(combat, 'enemyTeam');
		combat['popHitNumber']({ vehicle: raider, damage: 6 });

		const [number] = fx.floatingNumbers;
		expect(number.text).toBe('-6');
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
		expect(second.text).toBe('MISS');
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

		drag(grabPoint(card), centreOf(vehicleBounds(combat, 'enemyTeam')));
		const numbers = combat['fx'].floatingNumbers.map(number => number.text);
		expect(numbers.length).toBeGreaterThan(0);
		expect(numbers).toHaveLength(resolved() - before);
		expect(numbers.every(text => text === 'MISS' || /^-\d+$/.test(text))).toBe(true);

		combat.unmount();
	});
});

/** A card of `type` put at the front of a seat's hand, and its element once the hand deals again. */
function dealTo(combat: CombatScreen, seat: 1 | 2, type: string): UICard {
	const driver = combat['playerDrivers'][seat - 1];
	const card = CardLoader.getInstance().createCard(type) as Card;
	driver.set({ hand: [card, ...driver.hand], adrenaline: driver.maxAdrenaline });
	combat['updateUIFromBattle']();
	context.frame.layout();
	const element = combat['handLayer'].getCardElementByCard(card);
	if (!element) throw new Error(`${type} should be in seat ${seat}'s hand`);
	return element;
}

/** The raider's token on the road. */
function raiderToken(combat: CombatScreen) {
	const [raider] = combat['enemyTeam']?.vehicles ?? [];
	const token = combat['road'].vehicleView(raider?.id ?? '');
	if (!token) throw new Error('the raider should be on the road');
	return { raider, token };
}

describe('CombatScreen targeting (DDB-138)', () => {
	beforeEach(() => setViewport(1280, 720));

	it('labels each raider with its range from the slot the card acts from, and offers only the ones in reach', async () => {
		const combat = await startCombat();
		const { raider, token } = raiderToken(combat);
		const playCard = jest.spyOn(Battle.prototype, 'playCard');

		// Point Blank reaches one; from the Rig, inside center, the raider is one away
		const near = dealTo(combat, 1, 'point_blank');
		const [nx, ny] = grabPoint(near);
		inject(`click,${nx},${ny}`);
		expect(combat['combatModel'].targetableVehicleIds).toEqual([raider.id]);
		expect(token.rangeLabel).toEqual({ text: 'R1', legal: true });
		expect(token.opacity).toBe(1);
		inject('keydown,Escape', 'keyup,Escape');
		expect(token.rangeLabel).toBeNull();

		// From the Bike, inside behind, it's two away: out of reach, dimmed,
		// and a drop on it plays nothing
		const far = dealTo(combat, 2, 'point_blank');
		drag(grabPoint(far), centreOf(vehicleBounds(combat, 'enemyTeam')), { release: false });
		expect(combat['combatModel'].isTargeting).toBe(true);
		expect(combat['combatModel'].targetableVehicleIds).toEqual([]);
		expect(token.rangeLabel).toEqual({ text: 'OUT', legal: false });
		expect(token.opacity).toBeLessThan(1);
		expect(context.drag.canDrop).toBe(false);
		const [tx, ty] = centreOf(vehicleBounds(combat, 'enemyTeam'));
		inject(`up,${tx},${ty}`);
		expect(playCard).not.toHaveBeenCalled();
		expect(combat['combatModel'].selectedCard).toBeNull();
		expect(token.rangeLabel).toBeNull();

		playCard.mockRestore();
		combat.unmount();
	});

	it('rides the hit check with the dragged card and ghosts the damage on the target, until the drag ends', async () => {
		const combat = await startCombat();
		const { raider, token } = raiderToken(combat);
		const card = dealTo(combat, 1, 'headshot');
		const fx = combat['fx'];

		drag(grabPoint(card), centreOf(vehicleBounds(combat, 'enemyTeam')), { release: false });
		expect(combat['combatModel'].focusedVehicleId).toBe(raider.id);
		const preview = combat['aimPreviews'].get(raider.id);
		expect(preview?.range).toBe(1);
		const text = fx.hitCheckText;
		expect(text?.verdict).toBe(preview?.check?.hits ? 'HIT' : 'MISS');
		expect(text?.detail).toMatch(/^Gunnery \d+ vs Evade \d+\+2$/);
		expect(text?.range).toBe(' · R1');
		expect(token.damageGhost).toEqual(preview?.check?.hits ? preview.losses : null);
		if (preview?.check?.hits) expect(token.damageGhost?.driver).toBeGreaterThan(0);

		// Off the target, the check and the ghost go; back on, they return
		const [ex, ey] = emptyRoadPoint(combat);
		inject(`move,${ex},${ey}`);
		expect(fx.hitCheckText).toBeNull();
		expect(token.damageGhost).toBeNull();

		inject('keydown,Escape', 'keyup,Escape');
		inject(`up,${ex},${ey}`);
		expect(fx.hitCheckText).toBeNull();
		expect(token.rangeLabel).toBeNull();

		combat.unmount();
	});

	it.each([
		[1280, 720],
		[1024, 600],
	])('at %ix%i, keeps the hit check on screen for the leftmost card in the hand', async (width, height) => {
		setViewport(width, height);
		const combat = await startCombat();
		const { raider } = raiderToken(combat);
		const card = dealTo(combat, 1, 'headshot');
		const fx = combat['fx'];
		const [cx, cy] = grabPoint(card);
		inject(`click,${cx},${cy}`);
		combat['combatModel'].focusVehicle(raider.id);
		expect(fx.hitCheckText).not.toBeNull();

		const chip = fx['hitCheck'];
		chip.render({ drawRect: jest.fn(), drawText: jest.fn() } as unknown as DrawApi);
		const box = chip['box'].rect;
		// Centred on the card it would start left of the stage
		const cardCentre = card.localToScreen({ x: card.width / 2, y: 0 }).x / (fx.screenBounds.width / fx.width);
		expect(cardCentre - box.width / 2).toBeLessThan(0);
		expect(box.x).toBe(0);
		expect(box.x + box.width).toBeLessThanOrEqual(fx.width);

		combat.unmount();
	});

	it('cancels click-then-target on a click that lands on no target (DDB-111)', async () => {
		const combat = await startCombat();
		const card = dealTo(combat, 1, 'headshot');
		const [cx, cy] = grabPoint(card);
		const [ex, ey] = emptyRoadPoint(combat);

		inject(`click,${cx},${cy}`);
		expect(combat['combatModel'].isTargeting).toBe(true);
		inject(`click,${ex},${ey}`);
		expect(combat['combatModel'].isTargeting).toBe(false);
		expect(card.selected).toBe(false);

		// Your own vehicle isn't a Headshot target, so a click there cancels too
		inject(`click,${cx},${cy}`);
		const [px, py] = centreOf(vehicleBounds(combat, 'playerTeam'));
		inject(`click,${px},${py}`);
		expect(combat['combatModel'].isTargeting).toBe(false);

		combat.unmount();
	});

	it('cancels click-then-target on a right-click anywhere, or a second click on the card (DDB-111)', async () => {
		const combat = await startCombat();
		const card = dealTo(combat, 1, 'headshot');
		const playCard = jest.spyOn(Battle.prototype, 'playCard');
		const [cx, cy] = grabPoint(card);
		const [tx, ty] = centreOf(vehicleBounds(combat, 'enemyTeam'));

		inject(`click,${cx},${cy}`);
		expect(combat['combatModel'].isTargeting).toBe(true);
		inject(`click,${tx},${ty},2`);
		expect(combat['combatModel'].isTargeting).toBe(false);

		inject(`click,${cx},${cy}`);
		expect(combat['combatModel'].isTargeting).toBe(true);
		inject(`click,${cx},${cy}`);
		expect(combat['combatModel'].isTargeting).toBe(false);
		expect(card.selected).toBe(false);
		expect(playCard).not.toHaveBeenCalled();

		playCard.mockRestore();
		combat.unmount();
	});
});
