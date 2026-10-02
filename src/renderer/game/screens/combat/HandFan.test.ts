/**
 * @jest-environment jsdom
 */
import { HAND_CARD_SCALE, HandFan, fanPoses, fanReach } from './HandFan';
import { Stack } from '../../../engine/components/Stack';
import { createTestContext } from '../../../engine/components/testing';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { Card as GameCard, CardData } from '../../mechanics/Card';
import { Card as UICard } from '../../ui/Card';
import cardsFile from '../../data/cards.json';

const DEGREE = Math.PI / 180;

describe('fanPoses', () => {
	it('leaves a single card upright and level', () => {
		expect(fanPoses(1)).toEqual([{ rotate: 0, drop: 0, order: 0 }]);
	});

	it('turns each card 0.9 degrees per step from the middle, mirrored about it', () => {
		const poses = fanPoses(5);
		expect(poses.map((pose) => pose.rotate / DEGREE)).toEqual([-1.8, -0.9, 0, 0.9, 1.8].map((degrees) => expect.closeTo(degrees, 9)));
		expect(poses[0].drop).toBeCloseTo(poses[4].drop, 9);
		expect(poses[2].drop).toBe(0);
	});

	it('drops the edges along a shallow arc, never more than 5 logical pixels', () => {
		const poses = fanPoses(7);
		// 0.6 per step squared: 5.4 at three steps out, held to 5
		expect(poses[0].drop * HAND_CARD_SCALE).toBeCloseTo(5, 9);
		expect(poses[1].drop * HAND_CARD_SCALE).toBeCloseTo(2.4, 9);
		expect(poses[2].drop * HAND_CARD_SCALE).toBeCloseTo(0.6, 9);
	});

	it('stacks each card over the one before it', () => {
		expect(fanPoses(4).map((pose) => pose.order)).toEqual([0, 1, 2, 3]);
	});

	it('reaches past the card by its lean and drop, and not at all upright', () => {
		expect(fanReach({ rotate: 0, drop: 0, order: 0 })).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
		const [edge] = fanPoses(5);
		const reach = fanReach(edge);
		// 1.8 degrees: the top corner leans about 6.6 out, the bottom one swings 2.4 down
		expect(reach.left).toBe(reach.right);
		expect(reach.left).toBe(7);
		expect(reach.bottom).toBe(Math.ceil(75 * Math.sin(1.8 * DEGREE) + edge.drop));
	});

	it('turns a crowded hand more gently', () => {
		expect(fanPoses(8)[0].rotate / DEGREE).toBeCloseTo(-3.5 * 0.5, 9);
	});
});

/**
 * The fan declares its overlap with `zIndex` (DDB-91), which exempts every
 * neighbouring pair from the lint's overlap rule, so the lint would no longer
 * see a fan that stacked its cards. This holds the overlap to what the row's
 * negative gap and the posed cards' reach intend.
 *
 * The per-pair bound reads the gap from the fan under test, so it checks the
 * poses against that gap and cannot catch a gap that is itself too negative.
 * The span check is what catches that: the cards have to reach across the
 * fan, or their natural width. Don't loosen it on the strength of the pair
 * bound.
 */
describe('HandFan overlap', () => {
	const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;
	// The combat stage is 1280 logical wide at both gate sizes (1440x882 and
	// 1024x600), which gives each half a 532 wide fan; the others bracket it.
	const FAN_WIDTHS = [420, 532, 700];
	const COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
	/** The row's gap when the cards fit, in the card's own units. */
	const NATURAL_GAP = 10;

	function mountFan(width: number, count: number): { fan: HandFan; cards: UICard[]; root: Stack } {
		const context = createTestContext({ draw: createMeasuringDrawApi().api });
		const root = new Stack({ width, height: 260 });
		const fan = new HandFan({ widthMode: 'fill', heightMode: 'fill' });
		root.addChild(fan);
		root.mount(context);
		context.frame.layout();
		const cards = Array.from({ length: count }, (_unused, index) => new UICard({
			id: `card_${index}`,
			x: 0,
			y: 0,
			data: new GameCard(cardData[index % cardData.length]),
		}));
		fan.setCards(cards);
		context.frame.layout();
		return { fan, cards, root };
	}

	describe.each(FAN_WIDTHS)('in a %i wide fan', (width) => {
		it.each(COUNTS)('overlaps %i cards by no more than the gap and their lean', (count) => {
			const { fan, cards, root } = mountFan(width, count);
			const poses = fanPoses(count);
			const overlap = Math.max(0, -fan.cardGap);
			for (let index = 0; index + 1 < count; index++) {
				const left = cards[index].screenBounds;
				const right = cards[index + 1].screenBounds;
				const lean = fanReach(poses[index]).right + fanReach(poses[index + 1]).left;
				expect(left.x + left.width - right.x).toBeLessThanOrEqual((overlap + lean) * HAND_CARD_SCALE + 1e-6);
				// Each card starts to the right of the one before it, so its left edge shows
				expect(right.x).toBeGreaterThan(left.x);
			}
			// Spread across the fan, not bunched: the posed cards stay inside it,
			// and span it, or their natural width where that is less, to within
			// the pixel a card the floored gap can lose
			const fanBounds = fan.screenBounds;
			const first = cards[0].screenBounds;
			const last = cards[count - 1].screenBounds;
			expect(first.x).toBeGreaterThanOrEqual(fanBounds.x - 1e-6);
			expect(last.x + last.width).toBeLessThanOrEqual(fanBounds.x + fanBounds.width + 1e-6);
			const cardWidth = cards[0].width * HAND_CARD_SCALE;
			const natural = (count * cardWidth) + (count - 1) * NATURAL_GAP * HAND_CARD_SCALE;
			const reach = fanReach(poses[0]);
			const room = fanBounds.width - (reach.left + reach.right) * HAND_CARD_SCALE;
			expect(last.x + last.width - first.x).toBeGreaterThanOrEqual(Math.min(natural, room) - count * HAND_CARD_SCALE);
			root.unmount();
		});
	});

	it('hides the row when the hand is empty, so nothing reports a zero size', () => {
		const { fan, root } = mountFan(532, 3);
		fan.setCards([]);
		const [row] = fan.getChildren();
		expect(row.visible).toBe(false);
		fan.setCards([new UICard({ x: 0, y: 0, data: new GameCard(cardData[0]) })]);
		expect(row.visible).toBe(true);
		root.unmount();
	});
});
