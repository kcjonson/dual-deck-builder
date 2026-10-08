/**
 * @jest-environment jsdom
 */
import { Text } from '../../engine/components/Text';
import { Container } from '../../engine/components/Container';
import { createMeasuringDrawApi } from '../../engine/text/testing';
import { createTestContext } from '../../engine/components/testing';
import { advance, key, pointer, send } from '../../engine/services/testing';
import type { MountContext } from '../../engine/components/MountContext';
import { Clock } from '../../engine/animation/Clock';
import { renderTree } from '../../engine/components/renderTree';
import { layoutLint } from '../../engine/debug/layoutLint';
import { treeSnapshot } from '../../engine/debug/treeSnapshot';
import { tokens } from '../../engine/theme/tokens';
import type { RGBA, Rect } from '../../engine/draw/geometry';
import { Card as GameCard, CardData } from '../mechanics/Card';
import { DRIVER_CONFIGS, DriverArchetype } from '../mechanics/Driver';
import cardsFile from '../data/cards.json';
import { DRIVER_HP_COLOR, hexRgba } from '../screens/combat/combatStyle';
import { MINI_GRID } from './Card';
import { CARD_GROUND_FILLS } from './cardStyle';
import { DRIVER_CARD_INK, DRIVER_CARD_SIZE, DriverCard, DriverCardStatus } from './DriverCard';
import { DriverInspectSurface, INSPECT_KEYS, inspectHotkey, inspectOnContextMenu, makeDriverInspectable } from './cardInspect';
import { CardLookup } from './DriverDetailView';
import { DriverCardData, driverCardData } from './driverCardData';

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;
const lookup: CardLookup = (type) => {
	const data = cardData.find((entry) => entry.type === type);
	return data ? new GameCard({ ...data }) : null;
};

const ARCHETYPES = Object.keys(DRIVER_CONFIGS) as DriverArchetype[];
const STATUSES: readonly (DriverCardStatus | null)[] = [null, 'injured', 'lost', 'new', 'seat1', 'seat2'];
const HP_FULL = hexRgba(DRIVER_HP_COLOR);

interface Recorded {
	kind: string;
	id?: string | null;
	text?: string;
	rect?: Rect;
	box?: Rect | null;
	center?: { x: number; y: number };
	radius?: number | readonly number[] | null;
	border?: { color: RGBA; width: number } | null;
	fill?: RGBA | null;
}

let measuring: ReturnType<typeof createMeasuringDrawApi>;
let context: MountContext;

beforeEach(() => {
	measuring = createMeasuringDrawApi();
	context = createTestContext({ draw: measuring.api, clock: new Clock() });
});

/** Mounted and laid out, so its words and tags have measured through the context (R1.6). */
function mount(data: DriverCardData, options: { status?: DriverCardStatus | null; customDeck?: boolean; unavailable?: boolean } = {}): DriverCard {
	const card = new DriverCard({ id: 'card', data, ...options });
	card.mount(context);
	context.frame.layout();
	return card;
}

function part(card: DriverCard, suffix: string): Text {
	const found = card.children.find((child) => child.id === `card_${suffix}`);
	if (!(found instanceof Text)) throw new Error(`no ${suffix}`);
	return found;
}

/** One frame of the card's drawing. */
function frame(card: DriverCard): Recorded[] {
	const { api, backend } = measuring;
	context.frame.layout();
	api.beginFrame({ viewport: { width: 400, height: 400 } });
	renderTree(card, api);
	api.endFrame();
	return [...backend.commands] as unknown as Recorded[];
}

const texts = (commands: Recorded[]): string[] => commands.flatMap((command) => (command.kind === 'text' && command.text ? [command.text] : []));
const tagBoxes = (commands: Recorded[]): Rect[] => commands.flatMap((command) => (command.kind === 'rect' && command.rect && command.rect.y < 0 && command.rect.height === 13 ? [command.rect] : []));
const hpFills = (commands: Recorded[]): Rect[] => commands.flatMap((command) => (command.kind === 'rect' && command.rect && command.fill && command.fill.every((channel, index) => channel === HP_FULL[index]) ? [command.rect] : []));

describe('Driver card (Game Flow 7.0)', () => {
	it('is 104x146, a little bigger than a mini card', () => {
		expect(DRIVER_CARD_SIZE).toEqual({ width: 104, height: 146 });
		const card = mount(driverCardData({ archetype: 'road_warrior' }));
		expect([card.width, card.height]).toEqual([104, 146]);
	});

	it('shows the name, specialty, HP, hand limit, and deck size its data gives', () => {
		const card = mount(driverCardData({ archetype: 'interceptor', hitpoints: 22 }));
		expect(part(card, 'name').text).toBe('THE INTERCEPTOR');
		expect(part(card, 'specialty').text).toBe('AGILE STRIKER');
		expect(part(card, 'hp').text).toBe('22/25');
		expect(part(card, 'hand').text).toBe('HAND 7');
		expect(part(card, 'deck').text).toBe('DECK 11');
	});

	it('wraps a long name to a second line and keeps a short one on the first, the lines under it level either way', () => {
		const warrior = mount(driverCardData({ archetype: 'road_warrior' }));
		const interceptor = mount(driverCardData({ archetype: 'interceptor' }));
		expect(part(warrior, 'name').measured?.lines).toBe(2);
		expect(part(interceptor, 'name').measured?.lines).toBe(1);
		for (const suffix of ['name', 'specialty', 'hp', 'hand', 'deck']) {
			expect(part(warrior, suffix).y).toBe(part(interceptor, suffix).y);
		}
	});

	it('fits every archetype\'s words and figures whole, a campaign name on one line, and two-digit stats', () => {
		const cases = [
			...ARCHETYPES.map((archetype) => driverCardData({ archetype })),
			driverCardData({ archetype: 'road_warrior', name: 'Road Warrior 2' }),
			driverCardData({ archetype: 'interceptor', name: 'Interceptor 12', handLimit: 10, deck: { ramming_speed: 20 } }),
			driverCardData({ archetype: 'mechanic', hitpoints: 9 }),
		];
		for (const data of cases) {
			const card = mount(data);
			for (const suffix of ['name', 'specialty', 'hp', 'hand', 'deck']) {
				expect([data.name, suffix, part(card, suffix).overflowOutcome]).toEqual([data.name, suffix, 'none']);
			}
			card.unmount();
		}
		expect(part(mount(driverCardData({ archetype: 'road_warrior', name: 'Road Warrior 2' })), 'name').measured?.lines).toBe(1);
	});

	it('fits three-digit HP whole, its bar the same length as a two-digit driver\'s', () => {
		const tough = mount(driverCardData({ archetype: 'road_warrior', hitpoints: 100, maxHitpoints: 100 }));
		expect(part(tough, 'hp').text).toBe('100/100');
		expect(part(tough, 'hp').overflowOutcome).toBe('none');
		const ordinary = mount(driverCardData({ archetype: 'road_warrior' }));
		expect(hpFills(frame(tough))[0].width).toBe(hpFills(frame(ordinary))[0].width);
	});

	it('keeps a clear gap between the hand limit and the deck size at two digits each', () => {
		const card = mount(driverCardData({ archetype: 'interceptor', handLimit: 10, deck: { ramming_speed: 20 } }));
		const hand = part(card, 'hand');
		const deck = part(card, 'deck');
		expect([hand.text, deck.text]).toEqual(['HAND 10', 'DECK 20']);
		const handRight = hand.x + (hand.measured?.width ?? Infinity);
		const deckLeft = deck.x + deck.width - (deck.measured?.width ?? Infinity);
		expect(deckLeft - handRight).toBeGreaterThanOrEqual(6);
	});

	it('cuts a name too long for two lines with an ellipsis', () => {
		const card = mount(driverCardData({ archetype: 'raider', name: 'The Last Raider Who Drove the Whole Wasteland Alone' }));
		expect(part(card, 'name').overflowOutcome).toBe('ellipsis');
	});

	it('shows a note in the specialty\'s place, in capitals', () => {
		const card = mount(driverCardData({ archetype: 'raider', hitpoints: 0, note: 'Killed day 9' }), { status: 'lost' });
		const specialty = part(card, 'specialty');
		expect(specialty.text).toBe('Killed day 9');
		expect(specialty.style.textTransform).toBe('uppercase');
	});

	it('keeps the specialty when a note is empty, rather than blanking the line', () => {
		const data: DriverCardData = { ...driverCardData({ archetype: 'raider' }), note: '' };
		expect(part(mount(data), 'specialty').text).toBe('BERSERKER');
	});

	it('fills the HP bar in the driver HP hue by the share left, the same length on every card, and an empty bar not at all', () => {
		const full = hpFills(frame(mount(driverCardData({ archetype: 'road_warrior' }))));
		const hurt = hpFills(frame(mount(driverCardData({ archetype: 'interceptor', hitpoints: 22 }))));
		expect(full).toHaveLength(1);
		expect(hurt).toHaveLength(1);
		expect(hurt[0].x).toBe(full[0].x);
		expect(hurt[0].width).toBeCloseTo(full[0].width * (22 / 25), 5);
		expect(hpFills(frame(mount(driverCardData({ archetype: 'raider', hitpoints: 0 }), { status: 'lost' })))).toEqual([]);
		// Past the maximum the bar is full, not longer
		expect(hpFills(frame(mount(driverCardData({ archetype: 'raider', hitpoints: 50 }))))[0].width).toBe(full[0].width);
	});

	it.each(STATUSES.filter((status): status is DriverCardStatus => status !== null))('tags %s on the top edge, hanging past the right one', (status) => {
		const card = mount(driverCardData({ archetype: 'mechanic' }), { status });
		const commands = frame(card);
		const label = { injured: 'INJURED', lost: 'LOST', new: 'NEW', seat1: 'SEAT 1', seat2: 'SEAT 2' }[status];
		expect(texts(commands)).toContain(label);
		const [box] = tagBoxes(commands);
		expect(box.y).toBe(-7);
		expect(box.x + box.width).toBeCloseTo(108);
		expect(card.drawnText).toEqual([label]);
	});

	it('stands CUSTOM left of a seat\'s tag, clear of it and inside the top edge, and at the corner on its own', () => {
		const seated = mount(driverCardData({ archetype: 'interceptor' }), { status: 'seat2', customDeck: true });
		const [seat, custom] = tagBoxes(frame(seated));
		expect(seated.drawnText).toEqual(['SEAT 2', 'CUSTOM']);
		expect(seat.x + seat.width).toBeCloseTo(108);
		expect(custom.x + custom.width).toBeCloseTo(seat.x - 3);
		expect(custom.x).toBeGreaterThan(0);

		const widest = mount(driverCardData({ archetype: 'mechanic' }), { status: 'injured', customDeck: true });
		const [injured, alsoCustom] = tagBoxes(frame(widest));
		expect(alsoCustom.x + alsoCustom.width).toBeLessThan(injured.x);
		expect(alsoCustom.x).toBeGreaterThan(0);

		const alone = mount(driverCardData({ archetype: 'interceptor' }), { customDeck: true });
		const [only] = tagBoxes(frame(alone));
		expect(alone.drawnText).toEqual(['CUSTOM']);
		expect(only.x + only.width).toBeCloseTo(108);
	});

	it('moves CUSTOM to the corner and back as the seat comes and goes', () => {
		const card = mount(driverCardData({ archetype: 'interceptor' }), { status: 'seat1', customDeck: true });
		card.status = null;
		const [corner] = tagBoxes(frame(card));
		expect(corner.x + corner.width).toBeCloseTo(108);
		card.status = 'seat1';
		const [seat, custom] = tagBoxes(frame(card));
		expect(custom.x + custom.width).toBeCloseTo(seat.x - 3);
		card.customDeck = false;
		expect(tagBoxes(frame(card))).toHaveLength(1);
		expect(card.drawnText).toEqual(['SEAT 1']);
	});

	it('fades a lost driver always and an unavailable one, through colours rather than opacity; injured alone stays at full strength', () => {
		const ground = (card: DriverCard): RGBA | null | undefined => frame(card).find((command) => command.kind === 'rect' && command.id === 'card')?.fill;
		const lost = mount(driverCardData({ archetype: 'raider', hitpoints: 0 }), { status: 'lost' });
		const unavailable = mount(driverCardData({ archetype: 'road_warrior' }), { unavailable: true });
		const injured = mount(driverCardData({ archetype: 'mechanic', hitpoints: 18 }), { status: 'injured' });
		const injuredAway = mount(driverCardData({ archetype: 'mechanic', hitpoints: 18 }), { status: 'injured', unavailable: true });
		for (const card of [lost, unavailable, injuredAway]) {
			expect(card.faded).toBe(true);
			expect(card.opacity).toBe(1);
			expect(ground(card)).toEqual(CARD_GROUND_FILLS.dimmed);
		}
		expect(injured.faded).toBe(false);
		expect(ground(injured)).toEqual(CARD_GROUND_FILLS.full);
		const name = (card: DriverCard): RGBA => part(card, 'name').color;
		expect(name(lost)).not.toEqual(name(injured));

		unavailable.unavailable = false;
		expect(unavailable.faded).toBe(false);
		expect(ground(unavailable)).toEqual(CARD_GROUND_FILLS.full);
		lost.status = 'new';
		expect(lost.faded).toBe(false);
	});

	it('stays enabled and focusable when faded, since its detail view still opens', () => {
		const card = mount(driverCardData({ archetype: 'raider', hitpoints: 0 }), { status: 'lost' });
		card.focusable = true;
		expect(card.effectivelyEnabled).toBe(true);
		expect(card.canReceiveFocus()).toBe(true);
	});

	it('outlines in the interaction yellow on hover and keyboard focus, and not while disabled', () => {
		const card = mount(driverCardData({ archetype: 'road_warrior' }));
		const outline = (): { color: RGBA; width: number } | null | undefined => frame(card).find((command) => command.kind === 'rect' && command.id === 'card')?.border;
		const resting = outline();
		card.hovered = true;
		expect(outline()).toEqual({ color: tokens.color.accent, width: 2, position: 'inside' });
		card.hovered = false;
		expect(outline()).toEqual(resting);
		card.focusable = true;
		context.focus.pushScope(card);
		context.focus.focus(card, 'keyboard');
		expect(outline()?.color).toEqual(tokens.color.accent);
		context.focus.blur();
		context.focus.popScope(card);
		card.enabled = false;
		card.hovered = true;
		expect(outline()?.color).not.toEqual(tokens.color.accent);
		expect(card.resolvedColors.fill).toEqual(CARD_GROUND_FILLS.dimmed);
	});

	it('comes back to its resting outline when mounted again after leaving hovered', () => {
		const card = mount(driverCardData({ archetype: 'road_warrior' }));
		const outline = (): RGBA | undefined => frame(card).find((command) => command.kind === 'rect' && command.id === 'card')?.border?.color;
		const resting = outline();
		card.hovered = true;
		expect(outline()).toEqual(tokens.color.accent);
		// Unmounting clears hover without a callback (R9.21)
		card.unmount();
		card.mount(context);
		expect(card.hovered).toBe(false);
		expect(outline()).toEqual(resting);
	});

	it('rings a selected card clear of its frame, as the Crew wireframe does, a different shape from hover\'s outline', () => {
		const card = mount(driverCardData({ archetype: 'road_warrior' }));
		const ring = (): Recorded | undefined => frame(card).find((command) => command.id === 'card.selection_ring');
		const outline = (): { color: RGBA; width: number } | null | undefined => frame(card).find((command) => command.kind === 'rect' && command.id === 'card')?.border;
		const resting = outline();
		expect(ring()).toBeUndefined();
		card.selected = true;
		const selected = ring();
		expect(selected?.rect).toEqual({ x: -4, y: -4, width: 112, height: 154 });
		expect(selected?.border).toEqual({ color: tokens.color.accent_bright, width: 2, position: 'outside' });
		// The frame's own line stays, so selection and hover never read as the same line
		expect(outline()).toEqual(resting);
		card.hovered = true;
		expect(outline()?.color).toEqual(tokens.color.accent);
		expect(ring()).toBeDefined();
		card.hovered = false;
		card.selected = false;
		expect(ring()).toBeUndefined();
	});

	it('forgets its walked group count when its selection ring comes or goes', () => {
		const card = mount(driverCardData({ archetype: 'road_warrior' }));
		frame(card);
		expect(card.walkedGroupCount).toBeGreaterThan(0);
		card.selected = true;
		expect(card.walkedGroupCount).toBe(-1);
		frame(card);
		card.selected = false;
		expect(card.walkedGroupCount).toBe(-1);
	});

	it('selects on a click and on Enter when focused, with the data it shows, and shows the pointer only once something listens', () => {
		const data = driverCardData({ archetype: 'mechanic' });
		const card = mount(data);
		expect(card.cursor).toBeNull();
		const picked: DriverCardData[] = [];
		card.onSelect = (selected) => picked.push(selected);
		expect(card.cursor).toBe('pointer');
		send(context, [pointer('down', 50, 70), pointer('up', 50, 70)]);
		expect(picked).toEqual([data]);
		card.focusable = true;
		context.focus.pushScope(card);
		context.focus.focus(card, 'keyboard');
		send(context, [key('Enter'), key('Enter', 'up')]);
		expect(picked).toEqual([data, data]);
		context.focus.popScope(card);
	});

	it('lets Enter through to the screen\'s hotkeys when nothing listens for its selection, and takes it when something does', () => {
		const screen = new Container({ id: 'screen', x: 0, y: 0, width: 400, height: 400 });
		const card = new DriverCard({ id: 'card', x: 20, y: 20, data: driverCardData({ archetype: 'mechanic' }) });
		card.focusable = true;
		screen.addChild(card);
		screen.mount(context);
		context.frame.layout();
		const heard: string[] = [];
		screen.hotkeys.register('Enter', () => heard.push('screen'));
		context.focus.pushScope(screen);
		context.focus.focus(card, 'keyboard');
		send(context, [key('Enter'), key('Enter', 'up')]);
		expect(heard).toEqual(['screen']);
		card.onSelect = () => heard.push('card');
		send(context, [key('Enter'), key('Enter', 'up')]);
		expect(heard).toEqual(['screen', 'card']);
		context.focus.popScope(screen);
	});

	it('shows another driver in place, measuring only the words that changed', () => {
		const card = mount(driverCardData({ archetype: 'interceptor', hitpoints: 22 }));
		const children = [...card.children];
		const measured = jest.spyOn(measuring.api, 'measureText');
		card.data = driverCardData({ archetype: 'interceptor', hitpoints: 12 });
		context.frame.layout();
		expect(card.children).toEqual(children);
		expect(part(card, 'hp').text).toBe('12/25');
		expect(measured.mock.calls.map(([options]) => options.text)).toEqual(['12/25']);
		measured.mockRestore();
		card.data = driverCardData({ archetype: 'mechanic', deck: { repair_kit: 3 } });
		expect(part(card, 'name').text).toBe('THE MECHANIC');
		expect(part(card, 'deck').text).toBe('DECK 3');
	});

	it('hands the draw API the same objects every frame, and measures its tags once each', () => {
		const card = new DriverCard({ id: 'card', data: driverCardData({ archetype: 'interceptor', hitpoints: 22 }), status: 'seat2', customDeck: true });
		const measured = jest.spyOn(measuring.api, 'measureText');
		card.mount(context);
		context.frame.layout();
		const handed: unknown[][] = [];
		for (let index = 0; index < 3; index++) {
			const calls: unknown[] = [];
			const record = (options: unknown): void => { calls.push(options); };
			const spies = [
				jest.spyOn(measuring.api, 'drawRect').mockImplementation(record),
				jest.spyOn(measuring.api, 'drawCircle').mockImplementation(record),
				jest.spyOn(measuring.api, 'drawText').mockImplementation(record),
			];
			card.render(measuring.api);
			for (const spy of spies) spy.mockRestore();
			handed.push(calls);
			card.invalidateLayout();
			context.frame.layout();
		}
		expect(handed[0].length).toBeGreaterThan(0);
		for (const calls of handed.slice(1)) {
			expect(calls).toHaveLength(handed[0].length);
			calls.forEach((options, index) => expect(options).toBe(handed[0][index]));
		}
		const tags = measured.mock.calls.filter(([options]) => options.text === 'SEAT 2' || options.text === 'CUSTOM');
		expect(tags.map(([options]) => options.text).sort()).toEqual(['CUSTOM', 'SEAT 2']);
		measured.mockRestore();
	});

	it('draws nothing further than DRIVER_CARD_INK past its box, however it is tagged, and selected', () => {
		expect(DRIVER_CARD_INK).toBe(7);
		for (const status of STATUSES) {
			const card = mount(driverCardData({ archetype: 'mechanic' }), { status, customDeck: true });
			card.selected = true;
			expect(card.inkExtent).toBe(DRIVER_CARD_INK);
			for (const command of frame(card)) {
				const box = command.rect ?? command.box ?? null;
				const center = command.center;
				const radius = typeof command.radius === 'number' ? command.radius : 0;
				// A border drawn outside its rect reaches that much further
				const border = command.border as { width: number; position?: string } | null | undefined;
				const outside = border?.position === 'outside' ? border.width : 0;
				const xs = box ? [box.x - outside, box.x + box.width + outside] : center ? [center.x - radius, center.x + radius] : [];
				const ys = box ? [box.y - outside, box.y + box.height + outside] : center ? [center.y - radius, center.y + radius] : [];
				for (const x of xs) expect([status, x >= -DRIVER_CARD_INK && x <= 104 + DRIVER_CARD_INK]).toEqual([status, true]);
				for (const y of ys) expect([status, y >= -DRIVER_CARD_INK && y <= 146 + DRIVER_CARD_INK]).toEqual([status, true]);
			}
		}
	});

	it('is spaced clear of its neighbours\' tags by MINI_GRID, as minis are', () => {
		expect(MINI_GRID.gap).toBeGreaterThanOrEqual(DRIVER_CARD_INK * 2);
		expect(MINI_GRID.margin).toBeGreaterThanOrEqual(DRIVER_CARD_INK);
	});

	it('takes the pointer on its tags, as on its body', () => {
		const card = mount(driverCardData({ archetype: 'interceptor' }), { status: 'seat2', customDeck: true });
		const [seat, custom] = tagBoxes(frame(card));
		expect(card.containsPoint(106, -3)).toBe(true);
		expect(card.containsPoint(custom.x + 1, -3)).toBe(true);
		expect(card.containsPoint(seat.x - 1.5, -3)).toBe(false);
		expect(card.containsPoint(10, -3)).toBe(false);
		expect(card.containsPoint(110, 20)).toBe(false);
		expect(mount(driverCardData({ archetype: 'interceptor' })).containsPoint(106, -3)).toBe(false);
	});

	it('draws its own focus ring, once, under its tags', () => {
		const card = mount(driverCardData({ archetype: 'mechanic' }), { status: 'injured' });
		expect(card.drawsOwnFocusRing).toBe(true);
		card.focusable = true;
		context.focus.pushScope(card);
		context.focus.focus(card, 'keyboard');
		const commands = frame(card);
		const rings = commands.filter((command) => command.id === 'card.focus_ring');
		expect(rings).toHaveLength(1);
		expect(commands.indexOf(rings[0])).toBeLessThan(commands.findIndex((command) => command.text === 'INJURED'));
		context.focus.blur();
		context.focus.popScope(card);
		expect(frame(card).filter((command) => command.id === 'card.focus_ring')).toEqual([]);
	});

	it('forgets its walked group count when a tag or an emptied HP bar changes what it draws', () => {
		const card = mount(driverCardData({ archetype: 'mechanic' }));
		frame(card);
		expect(card.walkedGroupCount).toBeGreaterThan(0);
		card.status = 'injured';
		expect(card.walkedGroupCount).toBe(-1);
		frame(card);
		card.customDeck = true;
		expect(card.walkedGroupCount).toBe(-1);
		frame(card);
		card.data = driverCardData({ archetype: 'mechanic', hitpoints: 0 });
		expect(card.walkedGroupCount).toBe(-1);
	});

	it('lints clean for every archetype with every tag, faded or not', () => {
		for (const archetype of ARCHETYPES) {
			for (const status of STATUSES) {
				for (const customDeck of [false, true]) {
					const card = mount(driverCardData({ archetype, hitpoints: 1 }), { status, customDeck, unavailable: customDeck });
					const result = layoutLint(treeSnapshot([card], { width: 104, height: 146 }));
					expect({ archetype, status, customDeck, violations: result.violations }).toEqual({ archetype, status, customDeck, violations: [] });
					card.unmount();
				}
			}
		}
	});
});

describe('Driver card detail view, through the inspect path', () => {
	/** A card in a container that handles the context menu, as a screen's roster would. */
	function roster(data = driverCardData({ archetype: 'interceptor', hitpoints: 22 }), x = 20): { card: DriverCard; centre: { x: number; y: number } } {
		const deck = new Container({ id: 'roster', x: 0, y: 0, width: 1440, height: 400 });
		const card = new DriverCard({ id: 'card', x, y: 20, data });
		card.focusable = true;
		makeDriverInspectable(card, { cards: lookup });
		deck.addChild(card);
		inspectOnContextMenu(deck);
		deck.mount(context);
		context.frame.layout();
		const box = card.screenBounds;
		return { card, centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
	}

	function settleHidden(): void {
		advance(context, tokens.motion.dur_tooltip_hide + 100);
		expect(context.tooltips.surface).toBeNull();
	}

	it('opens on hover after the delay, at once on keyboard focus, and on a touch hold, for the card\'s own driver', () => {
		const { card, centre } = roster();
		send(context, [pointer('move', centre.x, centre.y)]);
		advance(context, tokens.control.tooltip_delay + tokens.motion.dur_fast + 100);
		expect(context.tooltips.owner).toBe(card);
		const surface = context.tooltips.surface;
		expect(surface).toBeInstanceOf(DriverInspectSurface);
		if (surface instanceof DriverInspectSurface) expect(surface.view.data).toBe(card.data);
		send(context, [pointer('move', 1200, 600)]);
		settleHidden();

		context.focus.pushScope(card.parent as Container);
		context.focus.focus(card, 'keyboard');
		context.frame.layout();
		expect(context.tooltips.owner).toBe(card);
		expect(context.tooltips.surface).toBeInstanceOf(DriverInspectSurface);
		context.focus.popScope(card.parent as Container);
		context.tooltips.hide();
		settleHidden();

		send(context, [pointer('down', centre.x, centre.y, { pointerType: 'touch', pointerId: 2 })]);
		advance(context, 600);
		expect(context.tooltips.owner).toBe(card);
		expect(context.tooltips.surface).toBeInstanceOf(DriverInspectSurface);
		send(context, [pointer('up', centre.x, centre.y, { pointerType: 'touch', pointerId: 2 })]);
		context.tooltips.hide();
	});

	it('pins on a secondary click, its foot saying so, and lets go on the next', () => {
		const { card, centre } = roster();
		send(context, [pointer('down', centre.x, centre.y, { button: 2 }), pointer('up', centre.x, centre.y, { button: 2 })]);
		expect(context.tooltips.pinned).toBe(card);
		const surface = context.tooltips.surface;
		expect(surface).toBeInstanceOf(DriverInspectSurface);
		const texts = (surface as DriverInspectSurface).view.children.filter((child): child is Text => child instanceof Text).map((child) => child.text);
		expect(texts).toContain('PINNED');
		send(context, [pointer('down', centre.x, centre.y, { button: 2 }), pointer('up', centre.x, centre.y, { button: 2 })]);
		expect(context.tooltips.pinned).toBeNull();
	});

	/** A card at the bottom middle of a screen this size, its view shown as hover would show it. */
	function shownOn(width: number, height: number, data: DriverCardData): { surface: DriverInspectSurface; viewport: { width: number; height: number } } {
		const screen = createTestContext({ draw: createMeasuringDrawApi().api, viewport: { logical: { width, height } }, clock: new Clock() });
		const root = new Container({ id: 'screen', x: 0, y: 0, width, height });
		const card = new DriverCard({ id: 'card', x: width / 2 - 52, y: height - 200, data });
		makeDriverInspectable(card, { cards: lookup });
		root.addChild(card);
		root.mount(screen);
		screen.frame.layout();
		screen.tooltips.show(card);
		advance(screen, tokens.motion.dur_fast + 50);
		return { surface: screen.tooltips.surface as DriverInspectSurface, viewport: { width, height } };
	}

	// A run deck at its largest: 20 cards and four escorts' signature cards, every one a different card
	const RUN_DECK = Object.fromEntries(cardData.slice(0, 24).map((data) => [data.type, 1]));

	it('fits a run deck of 24 kinds with a note on a 1024x600 screen at full size, resting on its bottom edge', () => {
		const { surface } = shownOn(1024, 600, driverCardData({ archetype: 'road_warrior', name: 'Road Warrior 2', deck: RUN_DECK, note: 'Killed day 9' }));
		expect(surface.view.deckGrid).toEqual({ columns: 8, rows: 3 });
		expect(surface.viewScale).toBe(1);
		const bounds = surface.screenBounds;
		expect(bounds.height).toBeCloseTo(surface.view.height, 5);
		// The service's room: from its 8 px gap at the top down to the resting edge, 10 px up
		expect(bounds.y).toBeGreaterThanOrEqual(8);
		expect(bounds.y + bounds.height).toBeCloseTo(600 - 10, 5);
		expect(bounds.x).toBeGreaterThanOrEqual(8);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(1024 - 8);
	});

	it('shrinks a view that still doesn\'t fit into the room it has, rather than running past its resting edge', () => {
		const { surface } = shownOn(640, 400, driverCardData({ archetype: 'road_warrior', deck: RUN_DECK, note: 'Killed day 9' }));
		expect(surface.viewScale).toBeLessThan(1);
		const bounds = surface.screenBounds;
		expect(bounds.height).toBeCloseTo(surface.view.height * surface.viewScale, 5);
		expect(bounds.y).toBeGreaterThanOrEqual(8);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(400 - 10 + 1e-6);
		expect(bounds.x).toBeGreaterThanOrEqual(8);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(640 - 8 + 1e-6);
	});

	it('keeps a pinned view on the card\'s data when the data changes under it', () => {
		const { card, centre } = roster();
		send(context, [pointer('down', centre.x, centre.y, { button: 2 }), pointer('up', centre.x, centre.y, { button: 2 })]);
		expect(context.tooltips.pinned).toBe(card);
		const changed = driverCardData({ archetype: 'interceptor', hitpoints: 5, deck: { ram: 12 } });
		card.data = changed;
		context.frame.layout();
		expect(context.tooltips.pinned).toBe(card);
		const surface = context.tooltips.surface;
		expect(surface).toBeInstanceOf(DriverInspectSurface);
		const view = (surface as DriverInspectSurface).view;
		expect(view.data).toBe(changed);
		const words = view.children.filter((child): child is Text => child instanceof Text).map((child) => child.text);
		expect(words).toEqual(expect.arrayContaining(['HP 5/25', 'DECK / 12 CARDS', 'PINNED']));
		expect(view.deckCards.map((mini) => [mini.data.type, mini.copies])).toEqual([['ram', 12]]);
	});

	it('leaves the tooltip alone when the data changes on a card whose view isn\'t pinned', () => {
		const { card } = roster();
		const other = new DriverCard({ id: 'other', x: 300, y: 20, data: driverCardData({ archetype: 'mechanic' }) });
		makeDriverInspectable(other, { cards: lookup });
		card.parent?.addChild(other);
		context.frame.layout();
		context.tooltips.pin(other, { fade: false });
		const surface = context.tooltips.surface;
		card.data = driverCardData({ archetype: 'interceptor', hitpoints: 5 });
		expect(context.tooltips.pinned).toBe(other);
		expect(context.tooltips.surface).toBe(surface);
		context.tooltips.unpin();
	});

	it('pins on I while its view shows or while it has focus, and lets go on the next I', () => {
		const { card } = roster();
		expect(INSPECT_KEYS).toContain('i');
		context.focus.pushScope(card.parent as Container);
		context.focus.focus(card, 'keyboard');
		context.frame.layout();
		expect(inspectHotkey(context)).toBe(true);
		expect(context.tooltips.pinned).toBe(card);
		expect(inspectHotkey(context)).toBe(true);
		expect(context.tooltips.pinned).toBeNull();
		context.focus.popScope(card.parent as Container);
	});

	it('rests on the screen\'s bottom edge, centred over the card and kept inside the screen', () => {
		const middle = roster(driverCardData({ archetype: 'interceptor' }), 668);
		context.tooltips.show(middle.card);
		advance(context, tokens.motion.dur_fast + 50);
		const surface = context.tooltips.surface as DriverInspectSurface;
		const bounds = surface.screenBounds;
		expect(bounds.x + bounds.width / 2).toBeCloseTo(middle.centre.x, 0);
		expect(bounds.y + bounds.height).toBeCloseTo(882 - 10, 0);
		context.tooltips.hide();
		settleHidden();

		const edge = roster(driverCardData({ archetype: 'interceptor' }), 0);
		context.tooltips.show(edge.card);
		advance(context, tokens.motion.dur_fast + 50);
		expect((context.tooltips.surface as DriverInspectSurface).screenBounds.x).toBeCloseTo(8, 0);
		context.tooltips.hide();
	});
});
