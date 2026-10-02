/**
 * @jest-environment jsdom
 */
import { createMeasuringDrawApi } from '../../engine/text/testing';
import { createTestContext } from '../../engine/components/testing';
import type { MountContext } from '../../engine/components/MountContext';
import { layoutLint } from '../../engine/debug/layoutLint';
import { treeSnapshot } from '../../engine/debug/treeSnapshot';
import { Card as GameCard, CardData } from '../mechanics/Card';
import cardsFile from '../data/cards.json';
import { cardKeywords, keywordWords } from '../data/keywords';
import { capacityCase } from '../screens/developer/CardDetailSection';
import { CardInspectView, DETAIL, KEYWORD_PANEL } from './CardDetailView';
import { inspectLayout } from './cardInspect';

jest.setTimeout(30_000);

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;
let context: MountContext;

function inspect(card: GameCard, options: { driver?: 1 | 2 | null; pinned?: boolean; keywordSide?: 'left' | 'right' } = {}): CardInspectView {
	const view = new CardInspectView({ card, ...options });
	view.mount(context);
	context.frame.layout();
	return view;
}

beforeAll(() => {
	context = createTestContext({ draw: createMeasuringDrawApi().api });
});

describe('Card detail view (Battle Screen Design, section 5)', () => {
	it('is 250 wide and holds every card\'s full text under its 440 px cap, the art whole', () => {
		for (const data of cardData) {
			for (const upgraded of [false, true]) {
				const view = inspect(new GameCard({ ...data, upgraded }));
				const label = `${data.name}${upgraded ? '+' : ''}`;
				expect([label, view.detail.width]).toEqual([label, DETAIL.width]);
				expect([label, view.detail.height <= DETAIL.maxHeight]).toEqual([label, true]);
				expect([label, view.detail.artHeight]).toEqual([label, DETAIL.art.height]);
				view.unmount();
			}
		}
	});

	it('takes a text at capacity to the cap by shrinking the art first, and loses no line', () => {
		const view = inspect(capacityCase(), { driver: 1 });
		expect(view.detail.height).toBeLessThanOrEqual(DETAIL.maxHeight);
		expect(view.detail.artHeight).toBeLessThan(DETAIL.art.height);
		expect(view.detail.artHeight).toBeGreaterThanOrEqual(DETAIL.art.min);
		const rules = view.detail.children.find((child) => child.id?.endsWith('_rules'));
		expect(rules?.height).toBe(view.detail.ruleLines * DETAIL.rules.lineHeight);
	});

	it('holds the 330-character full-text budget with a two-line name, with room to spare', () => {
		// The longest prefix, at a word, that the view shows whole once the art
		// has shrunk as far as it goes: the mock measured about 357, and the
		// engine's Open Sans gives about 410
		const source = capacityCase();
		const long = `${source.description} ${source.description}`;
		const fits = (length: number) => {
			const text = long.slice(0, long.lastIndexOf(' ', length));
			const view = inspect(new GameCard({ ...source, description: text }));
			const whole = view.detail.ruleLines * DETAIL.rules.lineHeight === view.detail.children.find((child) => child.id?.endsWith('_rules'))?.height;
			view.unmount();
			return whole;
		};
		let low = 100;
		let high = long.length;
		while (high - low > 1) {
			const middle = Math.floor((low + high) / 2);
			if (fits(middle)) low = middle;
			else high = middle;
		}
		expect(low).toBeGreaterThanOrEqual(330);
	});

	it('highlights keywords in the unmarked full text', () => {
		const words = keywordWords('Ignores Evade. Within range 1 of an escort. Exhaust.', 'auto');
		const keywords = words.flat().filter((piece) => piece.keyword).map((piece) => piece.text);
		expect(keywords).toEqual(['Evade', 'range', '1', 'escort', 'Exhaust']);
	});

	it('explains the card\'s keywords beside it, the range included, three at most', () => {
		const ramming = new GameCard({ ...(cardData.find((data) => data.type === 'ramming_speed') as CardData) });
		expect(cardKeywords(ramming)).toEqual(expect.arrayContaining(['Range 1', 'Vulnerable']));
		const view = inspect(ramming);
		expect(view.keywords.isMounted).toBe(true);
		expect(view.keywords.children.length / 2).toBeLessThanOrEqual(KEYWORD_PANEL.max);
	});

	it('rests the view and its keyword boxes on one bottom edge, boxes on the side asked', () => {
		const card = new GameCard({ ...(cardData.find((data) => data.type === 'ramming_speed') as CardData) });
		const right = inspect(card, { keywordSide: 'right' });
		expect(right.detail.x).toBe(0);
		expect(right.keywords.x).toBe(DETAIL.width + KEYWORD_PANEL.offset);
		expect(right.detail.y + right.detail.height).toBe(right.height);
		expect(right.keywords.y + right.keywords.height).toBe(right.height);

		const left = inspect(card, { keywordSide: 'left' });
		expect(left.keywords.x).toBe(0);
		expect(left.detail.x).toBe(KEYWORD_PANEL.width + KEYWORD_PANEL.offset);
	});

	it('says whether it is pinned in its foot', () => {
		const card = new GameCard({ ...cardData[0] });
		const footText = (view: CardInspectView) => view.detail.children.find((child) => child.id?.endsWith('_pin')) as unknown as { text: string };
		expect(footText(inspect(card)).text).toBe('RMB / I: PIN');
		expect(footText(inspect(card, { pinned: true })).text).toBe('PINNED');
	});

	it('lints clean for every card, either side', () => {
		for (const data of cardData) {
			for (const keywordSide of ['left', 'right'] as const) {
				const view = inspect(new GameCard({ ...data }), { driver: 2, keywordSide });
				const result = layoutLint(treeSnapshot([view], { width: 1440, height: 900 }));
				expect({ card: data.name, keywordSide, violations: result.violations }).toEqual({ card: data.name, keywordSide, violations: [] });
				view.unmount();
			}
		}
	});
});

describe('inspectLayout: where the view goes', () => {
	const at = (cardCentreX: number, seat: 1 | 2 | null, scale = 1) => inspectLayout({ cardCentreX, viewportWidth: 1280, scale, seat, hasKeywords: true });

	it('centres the detail view over the card, clamped inside the screen', () => {
		expect(at(640, 1).detailX).toBe(640 - DETAIL.width / 2);
		expect(at(20, 1).detailX).toBe(8);
		expect(at(1270, 2).detailX).toBe(1280 - 8 - DETAIL.width);
	});

	it('puts driver 1\'s keyword boxes right and driver 2\'s left, flipping when there is no room', () => {
		expect(at(300, 1).side).toBe('right');
		expect(at(1150, 1).side).toBe('left');
		expect(at(900, 2).side).toBe('left');
		expect(at(150, 2).side).toBe('right');
	});

	it('starts the whole view left of the detail view when the boxes go left', () => {
		const placed = at(900, 2);
		expect(placed.viewX).toBe(placed.detailX - KEYWORD_PANEL.offset - KEYWORD_PANEL.width);
	});

	it('scales with the stage', () => {
		const placed = at(640, 1, 0.8);
		expect(placed.detailX).toBeCloseTo(640 - (DETAIL.width * 0.8) / 2, 6);
	});
});
