import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Container } from '../../../engine/components/Container';
import type { Component } from '../../../engine/components/Component';
import { Card as UICard, CardSize } from '../../ui/Card';
import { Card } from '../../mechanics/Card';
import { DriverSeat, PlayerHandView } from './PlayerHandView';
import { DriverResourceData, DriverTab } from './DriverTab';
import { HandFan } from './HandFan';

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
			// R12.22's factory: the pointer resting on a card, or keyboard
			// focus reaching it, shows it large with its full rules text, centred
			// over the card so it never covers the rest of the hand. A swap
			// between cards places it before the new card has finished rising,
			// so it goes against the card's lifted pose
			cardElement.tooltip = {
				factory: () => this.createCardPreview(card, cardElement.driver),
				placement: { anchor: 'owner', side: 'top', align: 'center', ownerRect: () => cardElement.liftedScreenBounds },
				immediateOnFocus: true,
			};
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
	 * A hand card at preview size with its full rules text, scaled by the
	 * combat stage's scale so it keeps its size relative to the hand. The
	 * tooltip root is in viewport pixels, outside the stage's transform.
	 * The pinnable detail view of section 5 replaces it (DDB-137).
	 */
	private createCardPreview(card: Card, driverNumber: DriverSeat | null): Component {
		const { width, height } = UICard.getDimensions(CardSize.LARGE);
		const matrix = this.screenMatrix;
		const stageScale = Math.hypot(matrix[0], matrix[1]);
		// The outer box is the scaled size, which the tooltip places; the
		// card owns its own transform for its lift, so a frame scales it
		const preview = new Container({ id: 'card_preview', width: width * stageScale, height: height * stageScale });
		const frame = new Container({ width, height, transform: { scale: stageScale, origin: [0, 0] } });
		preview.addChild(frame);
		frame.addChild(new UICard({
			id: 'card_preview_face',
			x: 0,
			y: 0,
			data: card,
			size: CardSize.LARGE,
			driverNumber,
			fullText: true,
		}));
		return preview;
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
