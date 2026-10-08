/**
 * @jest-environment jsdom
 */
import { Text } from '../../engine/components/Text';
import { createMeasuringDrawApi } from '../../engine/text/testing';
import { createTestContext } from '../../engine/components/testing';
import type { MountContext } from '../../engine/components/MountContext';
import { layoutLint } from '../../engine/debug/layoutLint';
import { treeSnapshot } from '../../engine/debug/treeSnapshot';
import { Card as GameCard, CardData } from '../mechanics/Card';
import cardsFile from '../data/cards.json';
import { MINI_GRID } from './Card';
import { DRIVER_DETAIL, DriverDetailView, CardLookup, driverDeckGrid } from './DriverDetailView';
import { DriverCardData, driverCardData } from './driverCardData';

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;
const lookup: CardLookup = (type) => {
	const data = cardData.find((entry) => entry.type === type);
	return data ? new GameCard({ ...data }) : null;
};

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

function words(detail: DriverDetailView): string[] {
	return detail.children.filter((child): child is Text => child instanceof Text).map((child) => child.text);
}

function part(detail: DriverDetailView, suffix: string): Text {
	const found = detail.children.find((child) => child.id === `detail_${suffix}`);
	if (!(found instanceof Text)) throw new Error(`no ${suffix}`);
	return found;
}

describe('Driver detail view (Game Flow 7.0)', () => {
	it('shows their full stats: name, specialty, vehicle, HP, hand limit, and skills', () => {
		const detail = view(driverCardData({ archetype: 'interceptor', hitpoints: 22 }));
		expect(words(detail)).toEqual(expect.arrayContaining([
			'THE INTERCEPTOR', 'AGILE STRIKER', 'Lightning Bike', 'HP 22/25', 'HAND LIMIT 7', 'RAMMING 3', 'GUNNERY 9', 'EVADE 8', 'SPEED +3', 'DECK / 11 CARDS', 'RMB / I: PIN',
		]));
	});

	it('leaves out what a card\'s data doesn\'t carry, and shows a note under the rest', () => {
		const full = driverCardData({ archetype: 'raider', hitpoints: 0, note: 'Killed day 9' });
		const bare: DriverCardData = {
			name: full.name,
			specialty: full.specialty,
			hitpoints: full.hitpoints,
			maxHitpoints: full.maxHitpoints,
			handLimit: full.handLimit,
			deck: full.deck,
			note: full.note,
		};
		const detail = view(bare);
		expect(words(detail)).not.toContain('Spike Buggy');
		expect(words(detail).some((text) => text.startsWith('RAMMING'))).toBe(false);
		expect(part(detail, 'note').text).toBe('Killed day 9');
		expect(part(detail, 'note').y).toBeGreaterThan(part(detail, 'specialty').y);
		expect(words(detail)).toContain('HP 0/33');
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

	it('leaves out a card type the lookup doesn\'t know, and an entry of no copies', () => {
		const detail = view(driverCardData({ archetype: 'mechanic', deck: { repair_kit: 2, mystery_card: 1, ram: 0 } }));
		expect(detail.deckCards.map((card) => card.data.type)).toEqual(['repair_kit']);
	});

	it.each([
		[0, 4, 0], [1, 4, 1], [4, 4, 1], [6, 6, 1], [7, 7, 1], [8, 4, 2], [9, 5, 2], [14, 7, 2], [15, 5, 3], [20, 7, 3], [21, 7, 3], [22, 6, 4],
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

	it('wraps a long name to a second line and pushes the lines under it down', () => {
		const short = view(driverCardData({ archetype: 'mechanic' }));
		const long = view(driverCardData({ archetype: 'mechanic', name: 'The Mechanic Who Fixed the Whole Convoy Twice Over' }));
		expect(part(long, 'name').height).toBe(DRIVER_DETAIL.name.lineHeight * 2);
		expect(part(long, 'specialty').y).toBe(part(short, 'specialty').y + DRIVER_DETAIL.name.lineHeight);
	});

	it('wraps its stats at its right edge rather than running past it', () => {
		const detail = view(driverCardData({ archetype: 'interceptor', deck: {}, handLimit: 12, skills: { ramming: 10, gunnery: 10, evade: 10, speed: 5 } }));
		const right = detail.width - DRIVER_DETAIL.pad;
		for (const suffix of ['hand_limit', 'ramming', 'gunnery', 'evade', 'speed']) {
			const stat = part(detail, suffix);
			expect(stat.x + stat.width).toBeLessThanOrEqual(right + 1e-6);
		}
		// Two-digit skills in the narrowest view take a second row
		expect(part(detail, 'speed').x).toBe(DRIVER_DETAIL.pad);
		expect(part(detail, 'speed').y).toBeGreaterThan(part(detail, 'hand_limit').y);
	});

	it('holds a deck of every kind a 20-card deck can have inside a 600-tall screen', () => {
		const deck = Object.fromEntries(cardData.slice(0, 20).map((data) => [data.type, 1]));
		const detail = view(driverCardData({ archetype: 'road_warrior', deck, name: 'The Road Warrior Who Kept Every Card' }));
		expect(detail.deckGrid.rows).toBe(3);
		expect(detail.height).toBeLessThanOrEqual(600 - 10);
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
