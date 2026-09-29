import { Layer, LayerOptions } from '../../../engine/components/Layer';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import { CARD_LIFT, Card as UICard, CardSize } from '../../ui/Card';
import { Card } from '../../mechanics/Card';
import { DriverSeat, PlayerHandView } from './PlayerHandView';
import { DriverResourceData, DriverTab } from './DriverTab';

const CARD_DIMENSIONS = UICard.getDimensions(CardSize.NORMAL);
/**
 * Hand cards are 128x180 on the battle screen (section 4). The card face is
 * laid out at 150x210, so the fan scales it rather than laying it out again.
 */
export const HAND_CARD_SCALE = 128 / CARD_DIMENSIONS.width;
/** Between cards when a half has room for them, in the card's own units. */
const NATURAL_CARD_GAP = 10;
/** Between the two drivers' halves. */
const HALF_GAP = 20;

/**
 * Player hand layer, the dock's hand area: each driver owns half, with
 * their tab above a fan of their cards. A card is played by clicking it,
 * then its target.
 */
export class PlayerHandLayer extends Stack {
	private handCards: Card[] = [];
	private cardElements: UICard[] = [];
	private playableCardIds: Set<string> = new Set();
	private readonly halves: Record<DriverSeat, HandHalf>;

	// Callbacks
	private onCardSelect: ((card: Card) => void) | null = null;

	// Selection state
	private selectedCard: Card | null = null; // The card player has selected to play (waiting for target)
	private targetingMode = false;
	private cardDriverMap: Map<string, DriverSeat> = new Map();

	constructor(options: StackOptions = {}) {
		super({
			direction: 'horizontal',
			gap: HALF_GAP,
			crossAlign: 'stretch',
			// R9.29: the hand is one Tab stop; Left and Right move between its cards.
			focusGroup: { orientation: 'horizontal' },
			...options,
		});
		this.halves = {
			1: new HandHalf({ seat: 1 }),
			2: new HandHalf({ seat: 2 }),
		};
		this.addChild(this.halves[1]);
		this.addChild(this.halves[2]);
	}

	/**
	 * Show both drivers' cards, each in its driver's half, with the
	 * unplayable ones disabled
	 */
	public setHand({ cards, seatOf, playable }: PlayerHandView): void {
		this.handCards = cards;
		this.cardDriverMap = seatOf;
		this.playableCardIds = playable;
		this.createCardElements();
	}

	/** A driver's tab: name, passenger tag, adrenaline, and pile counts. */
	public setDriverData(seat: DriverSeat, data: Partial<DriverResourceData>): void {
		this.halves[seat].tab.setData(data);
	}

	/**
	 * Set card select callback (semantic)
	 */
	public setOnCardSelect(callback: (card: Card) => void): void {
		this.onCardSelect = callback;
	}

	/**
	 * Set card selection state
	 */
	public setCardSelected(card: Card | null): void {
		this.selectedCard = card;
		this.updateCardSelectionVisuals();
	}

	/**
	 * Set targeting mode
	 */
	public setTargetingMode(targeting: boolean): void {
		this.targetingMode = targeting;
		this.updateCardSelectionVisuals();
	}

	/**
	 * Clear card selection
	 */
	public clearCardSelection(): void {
		this.selectedCard = null;
		this.targetingMode = false;
		this.updateCardSelectionVisuals();
	}

	/**
	 * Build a card element per card in the hand, in hand order, and deal
	 * each into its driver's fan
	 */
	private createCardElements(): void {
		// Every fan is dealt again, which unmounts the cards it held and so
		// releases their input registrations.
		this.cardElements = this.handCards.map((card, index) => {
			// Model ids re-roll every load, so the id is the hand slot plus the
			// card type. The slot carries uniqueness on its own, since a type
			// can repeat in a hand; the whole string still varies between runs
			// because the shuffle decides which type lands in which slot.
			const cardElement = new UICard({
				id: `hand_card_${index}_${card.type}`,
				x: 0,
				y: 0,
				data: card,
				size: CardSize.NORMAL,
				driverNumber: this.cardDriverMap.get(card.id) ?? null,
			});
			cardElement.focusable = true;
			cardElement.setOnSelect(() => {
				if (this.canPlayCard(card) && this.onCardSelect) {
					this.onCardSelect(card);
				}
			});
			return cardElement;
		});

		for (const seat of [1, 2] as const) {
			this.halves[seat].fan.setCards(this.cardElements.filter((_element, index) => this.cardDriverMap.get(this.handCards[index].id) === seat));
		}
		this.updateCardSelectionVisuals();
	}

	/**
	 * Whether the card's driver can play it now: adrenaline, and no attacks
	 * from a passenger
	 */
	private canPlayCard(card: Card): boolean {
		return this.playableCardIds.has(card.id);
	}

	/**
	 * While targeting only the selected card stays enabled, and it shows as
	 * selected; otherwise each card is enabled when it can be played
	 */
	private updateCardSelectionVisuals(): void {
		this.cardElements.forEach((cardElement, index) => {
			const card = this.handCards[index];
			const selected = this.targetingMode && this.selectedCard !== null && card.id === this.selectedCard.id;
			cardElement.setSelected(selected);
			cardElement.enabled = this.targetingMode ? selected : this.canPlayCard(card);
		});
	}

	/** The slot `card` holds in the hand, or -1. */
	public slotOf(card: Card): number {
		return this.handCards.findIndex(held => held.id === card.id);
	}

	/**
	 * Focuses the card that can take focus nearest `slot`, at or after it
	 * first, for a keyboard player whose card was just played or put back:
	 * the hand is rebuilt on every change, so the focused card is gone.
	 * False when no card can take focus.
	 */
	public focusNearSlot(slot: number): boolean {
		const focus = this.context?.focus;
		if (!focus) return false;
		const after = this.cardElements.slice(Math.max(0, slot));
		const before = this.cardElements.slice(0, Math.max(0, slot)).reverse();
		for (const cardElement of [...after, ...before]) {
			if (focus.focus(cardElement)) return true;
		}
		return false;
	}

	/**
	 * Get current hand cards
	 */
	public getHandCards(): Card[] {
		return [...this.handCards];
	}

	/**
	 * Get the UI card element for a given card
	 */
	public getCardElementByCard(card: Card): UICard | null {
		const cardIndex = this.handCards.findIndex(c => c.id === card.id);
		if (cardIndex >= 0 && cardIndex < this.cardElements.length) {
			return this.cardElements[cardIndex];
		}
		return null;
	}
}

/**
 * One driver's half of the hand: their tab, and their fan below it.
 */
class HandHalf extends Stack {
	public readonly tab: DriverTab;
	public readonly fan: HandFan;

	constructor({ seat }: { seat: DriverSeat }) {
		super({ direction: 'vertical', crossAlign: 'stretch', widthMode: 'fill', heightMode: 'fill' });
		this.tab = new DriverTab({ id: `driver${seat}_tab`, seat });
		this.fan = new HandFan({ id: `driver${seat}_hand`, widthMode: 'fill', heightMode: 'fill' });
		this.addChild(this.tab);
		this.addChild(this.fan);
	}
}

/**
 * A driver's cards in a row, centred in the half and scaled to hand size.
 * The row overlaps its cards through a negative gap when they would not
 * otherwise fit, so however many cards a driver holds, every one of them
 * starts inside the half (DDB-183) and shows its left edge: cost, badge,
 * and the start of its name.
 */
class HandFan extends Layer {
	private readonly row: Stack;
	private cards: UICard[] = [];

	constructor(options: LayerOptions) {
		super(options);
		// Scaled about its top centre and hung from the fan's top centre, a
		// lift below the top so a hovered card rises inside the fan
		this.row = new Stack({
			direction: 'horizontal',
			gap: NATURAL_CARD_GAP,
			anchor: 'top',
			y: CARD_LIFT * HAND_CARD_SCALE,
			transform: { scale: HAND_CARD_SCALE, origin: [0.5, 0] },
		});
		this.addChild(this.row);
	}

	public setCards(cards: UICard[]): void {
		for (const card of this.cards) this.row.removeChild(card);
		this.cards = cards;
		for (const card of cards) this.row.addChild(card);
		this.fitCards();
	}

	protected onResized(): void {
		this.fitCards();
	}

	/**
	 * The gap that fits the row into the fan's width: the natural gap when
	 * there is room, otherwise the overlap that spreads the cards across it.
	 */
	private fitCards(): void {
		const count = this.cards.length;
		if (count < 2) {
			this.row.gap = NATURAL_CARD_GAP;
			return;
		}
		const room = this.getWidth() / HAND_CARD_SCALE;
		const spread = (room - count * CARD_DIMENSIONS.width) / (count - 1);
		this.row.gap = Math.min(NATURAL_CARD_GAP, Math.floor(spread));
	}
}
