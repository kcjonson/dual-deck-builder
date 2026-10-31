/**
 * @jest-environment jsdom
 */
import { Component, PointerEvents } from '../../engine/components/Component';
import { Container } from '../../engine/components/Container';
import type { MountContext } from '../../engine/components/MountContext';
import { createTestContext } from '../../engine/components/testing';
import { Clock } from '../../engine/animation/Clock';
import { advance, pointer, send } from '../../engine/services/testing';
import { createMeasuringDrawApi } from '../../engine/text/testing';
import { tokens } from '../../engine/theme/tokens';
import type { Rect } from '../../engine/draw/geometry';
import { Card as GameCard, CardData } from '../mechanics/Card';
import cardsFile from '../data/cards.json';
import { capacityCase, sampleCard } from '../screens/developer/CardDetailSection';
import { Card as UICard, CardSize } from './Card';
import { DriverCard } from './DriverCard';
import { CardLookup, DriverDetailView } from './DriverDetailView';
import { driverCardData } from './driverCardData';
import {
	CardInspectSurface,
	InspectOpening,
	InspectSurface,
	inspectHotkey,
	inspectOnContextMenu,
	makeDetailInspectable,
	makeDriverInspectable,
	makeInspectable,
} from './cardInspect';

/** Something with a detail view that is none of the kinds of card, so the shared path is checked on its own. */
class EscortStandIn extends Component {
	constructor() {
		super({ id: 'escort', x: 300, y: 200, width: 80, height: 112 });
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'unit';
	}
}

let context: MountContext;
let owner: EscortStandIn;
let openings: InspectOpening[];

beforeEach(() => {
	context = createTestContext({ draw: createMeasuringDrawApi().api, clock: new Clock() });
	const strip = new Container({ id: 'strip', x: 0, y: 0, width: 1440, height: 400 });
	owner = new EscortStandIn();
	owner.focusable = true;
	openings = [];
	makeDetailInspectable(owner, (opening) => {
		openings.push(opening);
		return { surface: new Container({ id: 'escort_view', width: 200, height: 120 }), x: 250 };
	});
	strip.addChild(owner);
	inspectOnContextMenu(strip);
	strip.mount(context);
	context.frame.layout();
});

const centre = (): { x: number; y: number } => ({ x: 340, y: 256 });

describe('makeDetailInspectable', () => {
	it('opens what its owner builds on hover, resting on the screen\'s bottom edge at the left edge it gives', () => {
		send(context, [pointer('move', centre().x, centre().y)]);
		advance(context, tokens.control.tooltip_delay + tokens.motion.dur_fast + 100);
		expect(context.tooltips.owner).toBe(owner);
		const bounds = context.tooltips.surface?.screenBounds;
		expect(bounds?.x).toBe(250);
		expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeCloseTo(882 - 10, 5);
		expect(openings).toHaveLength(1);
		expect(openings[0]).toMatchObject({ viewport: { width: 1440, height: 882 }, scale: 1, pinned: false });
		expect(openings[0].bounds).toEqual(owner.screenBounds);
	});

	it('pins on a secondary click through its container, building the view again so it can say so, and lets go on the next', () => {
		send(context, [pointer('down', centre().x, centre().y, { button: 2 }), pointer('up', centre().x, centre().y, { button: 2 })]);
		expect(context.tooltips.pinned).toBe(owner);
		expect(openings[openings.length - 1].pinned).toBe(true);
		send(context, [pointer('down', centre().x, centre().y, { button: 2 }), pointer('up', centre().x, centre().y, { button: 2 })]);
		expect(context.tooltips.pinned).toBeNull();
	});

	it('opens on a touch hold', () => {
		send(context, [pointer('down', centre().x, centre().y, { pointerType: 'touch', pointerId: 2 })]);
		advance(context, 600);
		expect(context.tooltips.owner).toBe(owner);
		send(context, [pointer('up', centre().x, centre().y, { pointerType: 'touch', pointerId: 2 })]);
	});

	it('pins on I when its owner has focus, and I does nothing for a focused component without a detail view', () => {
		const plain = new Container({ id: 'plain', x: 0, y: 0, width: 40, height: 40 });
		plain.focusable = true;
		owner.parent?.addChild(plain);
		context.frame.layout();
		const scope = owner.parent as Container;
		context.focus.pushScope(scope);
		context.focus.focus(plain, 'keyboard');
		expect(inspectHotkey(context)).toBe(false);
		context.focus.focus(owner, 'keyboard');
		context.frame.layout();
		expect(inspectHotkey(context)).toBe(true);
		expect(context.tooltips.pinned).toBe(owner);
		expect(inspectHotkey(context)).toBe(true);
		expect(context.tooltips.pinned).toBeNull();
		context.focus.popScope(scope);
	});
});

describe('InspectSurface, in a room too small for its view', () => {
	const cards = (cardsFile as unknown as { cards: CardData[] }).cards;
	const lookup: CardLookup = (type) => {
		const data = cards.find((entry) => entry.type === type);
		return data ? new GameCard({ ...data }) : null;
	};

	type Viewport = { width: number; height: number };
	type ShownSurface = InspectSurface<Component & { readonly overCardX?: number }>;

	/** A driver card whose deck is `kinds` different cards, one of each, inspectable as the roster makes it. */
	function driver(kinds: number): DriverCard {
		const deck = Object.fromEntries(cards.slice(0, kinds).map((data) => [data.type, 1]));
		const card = new DriverCard({ id: 'driver', data: driverCardData({ archetype: 'road_warrior', deck }) });
		makeDriverInspectable(card, { cards: lookup });
		return card;
	}

	function play(data: GameCard): UICard {
		const card = new UICard({ id: 'play', x: 0, y: 0, data, size: CardSize.NORMAL, driverNumber: 1 });
		makeInspectable(card);
		return card;
	}

	/** `owner` near the foot of a screen this size, centred or 4 px in from its right edge, mounted and laid out. */
	function screenWith(owner: Component, { width, height }: Viewport, where: 'centre' | 'right' = 'centre'): MountContext {
		const screen = createTestContext({ draw: createMeasuringDrawApi().api, viewport: { logical: { width, height } }, clock: new Clock() });
		const root = new Container({ id: 'screen', x: 0, y: 0, width, height });
		owner.x = where === 'centre' ? (width - owner.width) / 2 : width - owner.width - 4;
		owner.y = height - owner.height - 60;
		root.addChild(owner);
		root.mount(screen);
		screen.frame.layout();
		return screen;
	}

	/** `owner`'s view shown as hover shows it, and the middle of the card across the screen. */
	function shownOn(owner: Component, viewport: Viewport, where: 'centre' | 'right' = 'centre'): { surface: ShownSurface; cardCentreX: number } {
		const screen = screenWith(owner, viewport, where);
		screen.tooltips.show(owner);
		advance(screen, tokens.motion.dur_fast + 50);
		const surface = screen.tooltips.surface;
		if (!(surface instanceof InspectSurface)) throw new Error('no inspect surface');
		const card = owner.screenBounds;
		return { surface, cardCentreX: card.x + card.width / 2 };
	}

	/**
	 * Shrunk to fit, resting on the screen's bottom edge 10 px up, inside the
	 * service's 8 px gap, and unclipped, so its shadow shows past its box.
	 */
	function expectShrunkToRest(surface: ShownSurface, { width, height }: Viewport): Rect {
		const bounds = surface.screenBounds;
		expect(surface.viewScale).toBeLessThan(1);
		expect(surface.overflow).toBe('visible');
		expect(bounds.width).toBeCloseTo(surface.view.width * surface.viewScale, 5);
		expect(bounds.height).toBeCloseTo(surface.view.height * surface.viewScale, 5);
		expect(bounds.y + bounds.height).toBeCloseTo(height - 10, 5);
		expect(bounds.y).toBeGreaterThanOrEqual(8 - 1e-6);
		expect(bounds.x).toBeGreaterThanOrEqual(8 - 1e-6);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 8 + 1e-6);
		return bounds;
	}

	it('shrinks a view wider than the screen to the screen\'s width, resting on the bottom edge rather than above it', () => {
		const cases: [Viewport, number][] = [[{ width: 700, height: 900 }, 24], [{ width: 390, height: 844 }, 6]];
		for (const [viewport, kinds] of cases) {
			const bounds = expectShrunkToRest(shownOn(driver(kinds), viewport).surface, viewport);
			expect(bounds.x).toBeCloseTo(8, 5);
			expect(bounds.width).toBeCloseTo(viewport.width - 16, 5);
		}
	});

	it('shrinks a view taller than its room and keeps it centred over the card, or 8 px in from the side the card is near', () => {
		const cases: [Viewport, number][] = [[{ width: 640, height: 400 }, 7], [{ width: 640, height: 400 }, 24], [{ width: 800, height: 450 }, 24]];
		for (const [viewport, kinds] of cases) {
			const centred = shownOn(driver(kinds), viewport);
			const middle = expectShrunkToRest(centred.surface, viewport);
			expect(Math.abs(middle.x + middle.width / 2 - centred.cardCentreX)).toBeLessThanOrEqual(1);

			const edge = expectShrunkToRest(shownOn(driver(kinds), viewport, 'right').surface, viewport);
			expect(edge.x + edge.width).toBeCloseTo(viewport.width - 8, 5);
		}
	});

	it('shrinks a play card\'s view the same way, an ordinary card\'s and one at its 440 px cap, the detail kept over the card', () => {
		const phone = { width: 390, height: 844 };
		for (const data of [sampleCard('ramming_speed'), capacityCase()]) {
			const { surface } = shownOn(play(data), phone);
			expect(surface).toBeInstanceOf(CardInspectSurface);
			expectShrunkToRest(surface, phone);
		}

		// Just too tall at 800x450: the detail stays centred over the card, its keyword boxes beside it
		const short = { width: 800, height: 450 };
		const { surface, cardCentreX } = shownOn(play(capacityCase()), short);
		const bounds = expectShrunkToRest(surface, short);
		expect(Math.abs(bounds.x + (surface.view.overCardX ?? 0) * surface.viewScale - cardCentreX)).toBeLessThanOrEqual(1);
	});

	it('leaves a view that fits at 1024x600 alone: full size, unclipped, on the bottom edge', () => {
		const screen = { width: 1024, height: 600 };
		for (const owner of [driver(24), play(capacityCase())]) {
			const { surface } = shownOn(owner, screen);
			const bounds = surface.screenBounds;
			expect(surface.viewScale).toBe(1);
			expect(surface.overflow).toBe('visible');
			expect(bounds.height).toBeCloseTo(surface.view.height, 5);
			expect(bounds.y + bounds.height).toBeCloseTo(600 - 10, 5);
		}
	});

	it('lays its view out as it opens, and not again once the service has placed it', () => {
		for (const viewport of [{ width: 1440, height: 882 }, { width: 640, height: 400 }]) {
			const card = driver(24);
			const screen = screenWith(card, viewport);
			const arrange = jest.spyOn(DriverDetailView.prototype, 'arrange');
			screen.tooltips.show(card);
			const opening = arrange.mock.calls.length;
			advance(screen, tokens.motion.dur_fast + 50);
			expect(arrange).toHaveBeenCalledTimes(opening);
			expect(opening).toBeLessThanOrEqual(2);
			arrange.mockRestore();
		}
	});
});
