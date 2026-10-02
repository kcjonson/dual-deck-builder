import { Container, ContainerOptions } from '../../../engine/components/Container';
import { Stack } from '../../../engine/components/Stack';
import { Card as UICard, CardSize, FanPose } from '../../ui/Card';

const CARD_DIMENSIONS = UICard.getDimensions(CardSize.NORMAL);
/**
 * Hand cards are 128x180 on the battle screen (section 4). The card face is
 * laid out at 150x210, so the fan scales it rather than laying it out again.
 */
export const HAND_CARD_SCALE = 128 / CARD_DIMENSIONS.width;
/** Between cards when a half has room for them, in the card's own units. */
const NATURAL_CARD_GAP = 10;
/** The mock's fan (`fanHand`): degrees of turn per card from the middle, gentler past seven. */
const FAN_TURN_DEGREES = 0.9;
const FAN_TURN_DEGREES_CROWDED = 0.5;
const CROWDED_HAND = 7;
/** How far an edge card drops below the middle one, logical pixels: 0.6 per card squared, at most 5. */
const FAN_DROP_PER_STEP = 0.6;
const FAN_DROP_MAX = 5;

/**
 * Each card's pose in a fan of `count`, per the mock: turned about its
 * bottom centre by 0.9 degrees per step from the middle (0.5 past seven
 * cards), and dropped along a shallow arc that bottoms out at 5 logical
 * pixels. Drops are in the card's own units, which the row scales down to
 * hand size. Each card stacks over the one before it.
 */
export function fanPoses(count: number): FanPose[] {
	const turn = ((count > CROWDED_HAND ? FAN_TURN_DEGREES_CROWDED : FAN_TURN_DEGREES) * Math.PI) / 180;
	return Array.from({ length: count }, (_unused, index) => {
		const step = index - (count - 1) / 2;
		return {
			rotate: step * turn,
			drop: Math.min(FAN_DROP_MAX, step * step * FAN_DROP_PER_STEP) / HAND_CARD_SCALE,
			order: index,
		};
	});
}

/**
 * How far a card in `pose` reaches past its own box on each side, in its
 * own units: turned by the angle about its bottom centre, its top outer
 * corner leans out and up and its bottom outer corner swings down, and then
 * the whole card drops.
 */
export function fanReach(pose: FanPose): { top: number; right: number; bottom: number; left: number } {
	const { width, height } = CARD_DIMENSIONS;
	const sin = Math.sin(Math.abs(pose.rotate));
	const cos = Math.cos(pose.rotate);
	const side = Math.ceil((width / 2) * cos + height * sin - width / 2);
	return {
		top: Math.max(0, Math.ceil((width / 2) * sin - height * (1 - cos) - pose.drop)),
		right: side,
		bottom: Math.ceil((width / 2) * sin + pose.drop),
		left: side,
	};
}

/**
 * A driver's cards in a fan, centred in the half and scaled to hand size.
 * The row overlaps its cards through a negative gap when they would not
 * otherwise fit, so however many cards a driver holds, every one of them
 * starts inside the half (DDB-183) and shows its left edge: cost, badge,
 * and the start of its name. Each card turns and drops through its own
 * transform (`FanPose`), which layout never sees, and a hovered card
 * straightens and rises out of it onto the `raised` layer.
 */
export class HandFan extends Container {
	private readonly row: Stack;
	private cards: UICard[] = [];

	constructor(options: ContainerOptions) {
		super(options);
		// Scaled about its top centre and hung from the fan's top centre, as
		// the mock hangs its cards 38 below the dock's edge. A lifted card
		// rises over the tab on the raised layer.
		this.row = new Stack({
			direction: 'horizontal',
			gap: NATURAL_CARD_GAP,
			anchor: 'top',
			transform: { scale: HAND_CARD_SCALE, origin: [0.5, 0] },
		});
		this.addChild(this.row);
	}

	public setCards(cards: UICard[]): void {
		for (const card of this.cards) this.row.removeChild(card);
		this.cards = cards;
		const poses = fanPoses(cards.length);
		cards.forEach((card, index) => {
			card.fanPose = poses[index];
			this.row.addChild(card);
		});
		this.fitCards();
	}

	protected onResized(): void {
		this.fitCards();
	}

	/**
	 * The gap that fits the row into the fan's width: the natural gap when
	 * there is room, otherwise the overlap that spreads the cards across it.
	 * A single card doesn't turn, so it needs no room to lean.
	 */
	private fitCards(): void {
		const count = this.cards.length;
		if (count < 2) {
			this.row.gap = NATURAL_CARD_GAP;
			this.row.padding = 0;
			return;
		}
		// The edge cards turn outward about their bottom centres and drop, so
		// their corners reach past where the row puts them. The row's padding
		// is that reach, so the posed cards stay inside the row's box and the
		// fan's width holds them.
		const edge = fanPoses(count)[0];
		const reach = fanReach(edge);
		this.row.padding = reach;
		const room = this.getWidth() / HAND_CARD_SCALE - reach.left - reach.right;
		const spread = (room - count * CARD_DIMENSIONS.width) / (count - 1);
		this.row.gap = Math.min(NATURAL_CARD_GAP, Math.floor(spread));
	}
}
