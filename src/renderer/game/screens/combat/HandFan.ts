import { Container, ContainerOptions } from '../../../engine/components/Container';
import { Stack } from '../../../engine/components/Stack';
import { Card as UICard, CardSize, FanPose } from '../../ui/Card';

/** Hand cards are the face's own 128x180 (section 4). */
const CARD_DIMENSIONS = UICard.getDimensions(CardSize.NORMAL);
/** Between cards when a half has room for them: the mock's `CW + 8` step. */
export const NATURAL_CARD_GAP = 8;
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
 * pixels. Each card stacks over the one before it.
 */
export function fanPoses(count: number): FanPose[] {
	const turn = ((count > CROWDED_HAND ? FAN_TURN_DEGREES_CROWDED : FAN_TURN_DEGREES) * Math.PI) / 180;
	return Array.from({ length: count }, (_unused, index) => {
		const step = index - (count - 1) / 2;
		return {
			rotate: step * turn,
			drop: Math.min(FAN_DROP_MAX, step * step * FAN_DROP_PER_STEP),
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
 * A driver's cards in a fan, centred in the half. The row overlaps its
 * cards through a negative gap when they would not otherwise fit, so
 * however many cards a driver holds, every one of them starts inside the
 * half (DDB-183) and shows its left edge: cost, badge, and the start of its
 * name. At the cap of seven about 68 px of each shows. Each card turns and
 * drops through its own transform (`FanPose`), which layout never sees, and
 * a hovered card straightens and rises out of it onto the `raised` layer.
 *
 * The row is reconciled by card, so a card still in the hand after a deal
 * keeps its element: its lift, its focus, and a pinned detail view stay put
 * while the cards around it come and go.
 */
export class HandFan extends Container {
	private readonly row: Stack;
	private fanCards: UICard[] = [];
	/** Each element's reconcile key: its identity, as the row's diff needs a string. */
	private readonly cardKeys = new WeakMap<UICard, string>();
	private nextKey = 0;

	constructor(options: ContainerOptions) {
		super(options);
		// Hung from the fan's top centre, as the mock hangs its cards 38 below
		// the dock's edge. A lifted card rises over the tab on the raised layer.
		this.row = new Stack({
			direction: 'horizontal',
			gap: NATURAL_CARD_GAP,
			anchor: 'top',
		});
		this.addChild(this.row);
	}

	public get cards(): UICard[] {
		return this.fanCards;
	}

	/** Deals `cards` into the row in order; an element already in it stays mounted and only moves. */
	public set cards(cards: UICard[]) {
		this.fanCards = cards;
		const poses = fanPoses(cards.length);
		cards.forEach((card, index) => {
			card.fanPose = poses[index];
		});
		this.row.reconcileChildren<UICard, UICard>(cards, {
			key: (card) => this.keyOf(card),
			create: (card) => card,
		});
		// An empty row would hug to nothing, a zero-size box the lint reports.
		this.row.visible = cards.length > 0;
		this.fitCards();
	}

	private keyOf(card: UICard): string {
		let key = this.cardKeys.get(card);
		if (key === undefined) {
			key = String(this.nextKey++);
			this.cardKeys.set(card, key);
		}
		return key;
	}

	/** The row's gap: the natural one, or the overlap that fits the cards in. */
	public get cardGap(): number {
		return this.row.gap;
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
		const count = this.fanCards.length;
		if (count < 2) {
			this.row.gap = NATURAL_CARD_GAP;
			this.row.padding = 0;
			return;
		}
		// Turned cards reach past where the row puts them: the edge cards'
		// corners out to the sides and down, and the cards beside the middle
		// up, since they turn without dropping far enough to hide it. The
		// row's padding is the most any card reaches each way, so the posed
		// cards stay inside the row's box and the fan's width holds them.
		const reach = fanPoses(count).map(fanReach).reduce((most, each) => ({
			top: Math.max(most.top, each.top),
			right: Math.max(most.right, each.right),
			bottom: Math.max(most.bottom, each.bottom),
			left: Math.max(most.left, each.left),
		}));
		this.row.padding = reach;
		const room = this.width - reach.left - reach.right;
		const spread = (room - count * CARD_DIMENSIONS.width) / (count - 1);
		this.row.gap = Math.min(NATURAL_CARD_GAP, Math.floor(spread));
	}
}
