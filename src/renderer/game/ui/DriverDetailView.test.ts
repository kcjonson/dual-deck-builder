/**
 * @jest-environment jsdom
 */
import type { Component } from '../../engine/components/Component';
import { Text } from '../../engine/components/Text';
import { createMeasuringDrawApi } from '../../engine/text/testing';
import { createTestContext } from '../../engine/components/testing';
import type { MountContext } from '../../engine/components/MountContext';
import { layoutLint } from '../../engine/debug/layoutLint';
import { treeSnapshot } from '../../engine/debug/treeSnapshot';
import { Card as GameCard, CardData } from '../mechanics/Card';
import { MINI_GRID } from './Card';
import { drawPileOrder } from './CardPileView';
import { DRIVER_DETAIL, DriverDetailView, CardLookup, driverDeckGrid } from './DriverDetailView';
import { DriverCardData, driverCardData } from './driverCardData';
import { cardData, lookup, part } from './testing';

let context: MountContext;

beforeEach(() => {
	context = createTestContext({ draw: createMeasuringDrawApi().api });
});

function view(data: DriverCardData, options: { pinned?: boolean; cards?: CardLookup } = {}): DriverDetailView {
	const detail = new DriverDetailView({ id: 'detail', data, cards: options.cards ?? lookup, pinned: options.pinned });
	detail.mount(context);
	context.frame.layout();
	return detail;
}

/** Every word in the view, its stats' too, which flow in a row of their own. */
function words(detail: Component): string[] {
	return detail.children.flatMap((child) => (child instanceof Text ? [child.text] : words(child)));
}

/** Where a part sits in the view, wherever it's nested. */
function placed(detail: DriverDetailView, suffix: string): { x: number; y: number; width: number } {
	const bounds = part(detail, suffix).screenBounds;
	const origin = detail.screenBounds;
	return { x: bounds.x - origin.x, y: bounds.y - origin.y, width: bounds.width };
}

describe('Driver detail view (Game Flow 7.0)', () => {
	it('shows their full stats: name, vehicle and specialty, HP, hand limit, and skills', () => {
		const detail = view(driverCardData({ archetype: 'interceptor', hitpoints: 22 }));
		expect(words(detail)).toEqual(expect.arrayContaining([
			'THE INTERCEPTOR', 'Lightning Bike / AGILE STRIKER', 'HP 22/25', 'HAND LIMIT 7', 'RAMMING 3', 'GUNNERY 9', 'EVADE 8', 'SPEED +3', 'DECK / 11 CARDS', 'RMB / I: PIN',
		]));
	});

	it('leaves out what a card\'s data doesn\'t carry', () => {
		const full = driverCardData({ archetype: 'raider', hitpoints: 0 });
		const bare: DriverCardData = {
			name: full.name,
			specialty: 'Berserker',
			hitpoints: full.hitpoints,
			maxHitpoints: full.maxHitpoints,
			handLimit: full.handLimit,
			deck: full.deck,
		};
		const detail = view(bare);
		expect(part(detail, 'identity').text).toBe('BERSERKER');
		expect(words(detail).some((text) => text.startsWith('RAMMING'))).toBe(false);
		expect(detail.children.some((child) => child.id === 'detail_note')).toBe(false);
		expect(words(detail)).toContain('HP 0/33');
	});

	it('puts a note in the foot beside the pin hint, so it adds no row', () => {
		const plain = view(driverCardData({ archetype: 'raider', hitpoints: 0 }));
		const noted = view(driverCardData({ archetype: 'raider', hitpoints: 0, note: 'Killed day 9' }));
		const note = part(noted, 'note');
		const pin = part(noted, 'pin');
		expect(note.text).toBe('Killed day 9');
		expect(note.y).toBe(pin.y);
		expect(note.x).toBe(DRIVER_DETAIL.pad);
		expect(note.x + note.width).toBeLessThanOrEqual(pin.x - DRIVER_DETAIL.foot.between + 1e-6);
		expect(noted.height).toBe(plain.height);
		// A note too long for the room left of the hint is cut, not run into it
		const long = view(driverCardData({ archetype: 'raider', hitpoints: 0, deck: {}, note: 'Killed day 9 holding the bridge at Collins Ford so the convoy could cross' }));
		expect(part(long, 'note').overflowOutcome).toBe('ellipsis');
		expect(part(long, 'note').x + part(long, 'note').width).toBeLessThanOrEqual(part(long, 'pin').x);
	});

	it('says it\'s pinned in its foot when it is', () => {
		expect(words(view(driverCardData({ archetype: 'mechanic' }), { pinned: true }))).toContain('PINNED');
	});

	it('lays the deck out as minis stacked to their copies, cheapest first and then by name', () => {
		const detail = view(driverCardData({ archetype: 'road_warrior' }));
		expect(detail.deckCards.map((card) => [card.data.name, card.data.cost, card.copies])).toEqual([
			['Armor Plating', 1, 3],
			['Nitro Boost', 1, 2],
			['Repair Kit', 1, 2],
			['Ramming Speed', 2, 5],
		]);
		expect(words(detail)).toContain('DECK / 12 CARDS');
		expect(words(view(driverCardData({ archetype: 'mechanic', deck: { emp_blast: 1 } })))).toContain('DECK / 1 CARD');
	});

	it('leaves out a card type the lookup doesn\'t know, and an entry of no copies, and counts only what it shows', () => {
		const detail = view(driverCardData({ archetype: 'mechanic', deck: { repair_kit: 2, mystery_card: 1, ram: 0 } }));
		expect(detail.deckCards.map((card) => card.data.type)).toEqual(['repair_kit']);
		expect(part(detail, 'deck').text).toBe('DECK / 2 CARDS');
	});

	it.each([
		[0, 4, 0], [1, 4, 1], [4, 4, 1], [6, 6, 1], [7, 7, 1], [8, 4, 2], [9, 5, 2], [14, 7, 2], [15, 5, 3], [20, 7, 3], [21, 7, 3], [22, 8, 3], [24, 8, 3], [25, 9, 3],
	])('lays %i kinds of card out in %i columns and %i rows', (kinds, columns, rows) => {
		expect(driverDeckGrid(kinds)).toEqual({ columns, rows });
	});

	it('is as wide as its deck\'s columns, its minis spaced by MINI_GRID inside it', () => {
		const detail = view(driverCardData({ archetype: 'interceptor' }));
		expect(detail.deckGrid).toEqual({ columns: 6, rows: 1 });
		const { pad } = DRIVER_DETAIL;
		expect(detail.width).toBe(pad * 2 + 6 * 80 + 5 * MINI_GRID.gap + MINI_GRID.margin * 2);
		const [first, second] = detail.deckCards;
		expect(first.x).toBe(pad + MINI_GRID.margin);
		expect(second.x - first.x).toBe(80 + MINI_GRID.gap);
		const last = detail.deckCards[detail.deckCards.length - 1];
		expect(last.x + 80 + MINI_GRID.margin).toBe(detail.width - pad);

		const rows = view(driverCardData({ archetype: 'road_warrior', deck: { ram: 1, ramming_speed: 1, repair_kit: 1, armor_plating: 1, nitro_boost: 1, medical_kit: 1, oil_slick: 1, caltrops: 1, point_blank: 1 } }));
		expect(rows.deckGrid).toEqual({ columns: 5, rows: 2 });
		const fifth = rows.deckCards[4];
		const sixth = rows.deckCards[5];
		expect(sixth.x).toBe(rows.deckCards[0].x);
		expect(sixth.y - fifth.y).toBe(112 + MINI_GRID.gap);
	});

	it('puts its minis under its stats and its pin hint under its minis, inside its frame', () => {
		const detail = view(driverCardData({ archetype: 'interceptor', hitpoints: 22 }));
		const heading = part(detail, 'deck');
		const pin = part(detail, 'pin');
		for (const card of detail.deckCards) {
			expect(card.y).toBeGreaterThanOrEqual(heading.y + heading.height + MINI_GRID.margin);
			expect(card.y + card.height + MINI_GRID.margin).toBeLessThanOrEqual(pin.y);
		}
		expect(pin.x + pin.width).toBeCloseTo(detail.width - DRIVER_DETAIL.pad, 5);
		expect(pin.y + pin.height + DRIVER_DETAIL.pad).toBeCloseTo(detail.height, 5);
	});

	it('wraps a long name to a second line and pushes the line under it down', () => {
		const short = view(driverCardData({ archetype: 'mechanic' }));
		const long = view(driverCardData({ archetype: 'mechanic', name: 'The Mechanic Who Fixed the Whole Convoy Twice Over' }));
		expect(part(long, 'name').height).toBe(DRIVER_DETAIL.name.lineHeight * 2);
		expect(part(long, 'identity').y).toBe(part(short, 'identity').y + DRIVER_DETAIL.name.lineHeight);
	});

	it('wraps its stats at its right edge rather than running past it', () => {
		const detail = view(driverCardData({ archetype: 'interceptor', deck: {}, handLimit: 12, skills: { ramming: 10, gunnery: 10, evade: 10, speed: 5 } }));
		const right = detail.width - DRIVER_DETAIL.pad;
		for (const suffix of ['hand_limit', 'ramming', 'gunnery', 'evade', 'speed']) {
			const stat = placed(detail, suffix);
			expect(stat.x + stat.width).toBeLessThanOrEqual(right + 1e-6);
		}
		// Two-digit skills in the narrowest view take a second row, and the rule comes down with it
		expect(placed(detail, 'speed').x).toBe(DRIVER_DETAIL.pad);
		expect(placed(detail, 'speed').y).toBeGreaterThan(placed(detail, 'hand_limit').y);
		const oneRow = view(driverCardData({ archetype: 'interceptor', deck: {} }));
		expect(placed(detail, 'deck').y - placed(oneRow, 'deck').y).toBe(DRIVER_DETAIL.mono.height + DRIVER_DETAIL.stats.rowGap);
	});

	it('breaks a tie in cost by name as a pile orders names, not by character code', () => {
		const named = (type: string, name: string): GameCard => new GameCard({ ...(cardData.find((entry) => entry.type === type) as CardData), name });
		// All cost 1: by character code "Gamma" would come before "beta"
		const renamed: Record<string, GameCard> = { repair_kit: named('repair_kit', 'beta'), nitro_boost: named('nitro_boost', 'Gamma'), armor_plating: named('armor_plating', 'alpha') };
		const detail = view(driverCardData({ archetype: 'mechanic', deck: { repair_kit: 1, nitro_boost: 1, armor_plating: 1 } }), { cards: (type) => renamed[type] ?? null });
		const names = detail.deckCards.map((card) => card.data.name);
		expect(names).toEqual(['alpha', 'beta', 'Gamma']);
		expect(names).toEqual(drawPileOrder(Object.values(renamed)).map((card) => card.name));
	});

	// The room a 1024x600 screen has for the view: 600, less the 10 px it rests
	// above the bottom edge and the service's 8 px gap at the top. The
	// inspect path's own test shows one there through the tooltip service.
	it('keeps a run deck of 24 kinds, a note, and even a two-line name inside the 582 px a 1024x600 screen has', () => {
		const deck = Object.fromEntries(cardData.slice(0, 24).map((data) => [data.type, 1]));
		// Eight columns leave the name 700 px, so it takes a name this long to wrap
		const name = 'The Road Warrior Who Kept Every Card the Compound Ever Found Out on the Long Roads Home and Back Again';
		const detail = view(driverCardData({ archetype: 'road_warrior', deck, name, note: 'Killed day 9' }));
		expect(detail.deckGrid).toEqual({ columns: 8, rows: 3 });
		expect(part(detail, 'name').height).toBe(DRIVER_DETAIL.name.lineHeight * 2);
		expect(detail.height).toBeLessThanOrEqual(582);
		expect(detail.width).toBeLessThanOrEqual(1024 - 16);
	});

	it('keeps its minis from taking the pointer, since it is a view to read', () => {
		const detail = view(driverCardData({ archetype: 'interceptor' }));
		expect(detail.deckCards.every((card) => card.pointerEvents === 'none')).toBe(true);
	});

	it.each([
		['a starting deck', driverCardData({ archetype: 'interceptor', hitpoints: 22 })],
		['a lost driver with an empty deck', driverCardData({ archetype: 'raider', hitpoints: 0, deck: {}, note: 'Killed day 9' })],
		['a campaign deck in two rows', driverCardData({ archetype: 'road_warrior', name: 'Road Warrior 2', deck: Object.fromEntries(cardData.slice(0, 9).map((data) => [data.type, 2])) })],
	])('lints clean for %s', (_name, data) => {
		const detail = view(data);
		const result = layoutLint(treeSnapshot([detail], { width: detail.width, height: detail.height }));
		expect(result.violations).toEqual([]);
	});
});
