import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Container } from '../../../engine/components/Container';
import type { Component } from '../../../engine/components/Component';
import type { UiDragEvent, UiPointerEvent } from '../../../engine/input/events';
import { Card as UICard, CardSize } from '../../ui/Card';
import { Card } from '../../mechanics/Card';
import { DriverSeat, PlayerHandView } from './PlayerHandView';
import { DriverResourceData, DriverTab } from './DriverTab';
import { HandFan } from './HandFan';

/** A card the last deal dropped, and its element as it sat in the fan. */
export interface LeavingCard {
	card: Card;
	element: UICard;
	seat: DriverSeat | null;
}

/** Between the two drivers' halves. */
const HALF_GAP = 20;

/**
 * Player hand layer, the dock's hand area: each driver owns half, with
 * their tab above a fan of their cards. A card is played by clicking it,
 * then its target, or by dragging it onto its target.
 */
export class PlayerHandLayer extends Stack {
	private dealtCards: Card[] = [];
	private cardElements: UICard[] = [];
	private playableCardIds: Set<string> = new Set();
	private readonly halves: Record<DriverSeat, HandHalf>;

	// Callbacks
	/** A card clicked or activated in the hand (R8.25). */
	public onCardSelect: ((card: Card) => void) | null = null;
	private onCardPress: ((card: Card, element: UICard, event: UiPointerEvent) => void) | null = null;
	private onCardDragEnd: ((card: Card, event: UiDragEvent) => void) | null = null;
	private onOtherButton: (() => void) | null = null;
	/** Cards gone from the hand since the last deal, told before the hand deals again. */
	public onCardsLeave: ((leaving: LeavingCard[]) => void) | null = null;

	// Selection state
	private heldCard: Card | null = null; // The card player has selected to play (waiting for target)
	private targeting = false;
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
	public set hand({ cards, seatOf, playable }: PlayerHandView) {
		// Cards that left since the last deal, while their elements still sit
		// in the fan, so whoever listens can see where they were
		if (this.onCardsLeave) {
			const staying = new Set(cards);
			const leaving: LeavingCard[] = [];
			this.dealtCards.forEach((card, index) => {
				const element = this.cardElements[index];
				if (!staying.has(card) && element?.isMounted) leaving.push({ card, element, seat: this.cardDriverMap.get(card.id) ?? null });
			});
			if (leaving.length > 0) this.onCardsLeave(leaving);
		}
		this.dealtCards = cards;
		this.cardDriverMap = seatOf;
		this.playableCardIds = playable;
		this.createCardElements();
	}

	/** The half a card in the hand is dealt to. */
	public seatOf(card: Card): DriverSeat | null {
		return this.cardDriverMap.get(card.id) ?? null;
	}

	/** A driver's "DRAW n   DISCARD n" counts on their tab. */
	public pilesOf(seat: DriverSeat): Component {
		return this.halves[seat].tab.piles;
	}

	/** A driver's tab: name, passenger tag, adrenaline, and pile counts. */
	public setDriverData(seat: DriverSeat, data: Partial<DriverResourceData>): void {
		this.halves[seat].tab.setData(data);
	}

	/**
	 * A primary press on a card, which may grow into a drag to play it; how
	 * that drag ended; and any other button on a card, pressed or chorded
	 * onto the held one (R9.30), which cancels a drag
	 */
	public setOnCardDrag({ press, end, otherButton }: {
		press: (card: Card, element: UICard, event: UiPointerEvent) => void;
		end: (card: Card, event: UiDragEvent) => void;
		otherButton: () => void;
	}): void {
		this.onCardPress = press;
		this.onCardDragEnd = end;
		this.onOtherButton = otherButton;
	}

	/** The card picked to play, waiting for its target. */
	public get selectedCard(): Card | null {
		return this.heldCard;
	}

	public set selectedCard(card: Card | null) {
		this.heldCard = card;
		this.updateCardSelectionVisuals();
	}

	/** Whether a picked card is waiting for its target. */
	public get targetingMode(): boolean {
		return this.targeting;
	}

	public set targetingMode(targeting: boolean) {
		this.targeting = targeting;
		this.updateCardSelectionVisuals();
	}

	/**
	 * Clear card selection
	 */
	public clearCardSelection(): void {
		this.heldCard = null;
		this.targeting = false;
		this.updateCardSelectionVisuals();
	}

	/**
	 * Build a card element per card in the hand, in hand order, and deal
	 * each into its driver's fan
	 */
	private createCardElements(): void {
		// Every fan is dealt again, which unmounts the cards it held and so
		// releases their input registrations.
		this.cardElements = this.dealtCards.map((card, index) => {
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
			cardElement.onPointerDown = (event) => {
				if (event.button === 0) this.onCardPress?.(card, cardElement, event);
				else this.onOtherButton?.();
			};
			cardElement.onPointerMove = (event) => {
				if (event.button > 0) this.onOtherButton?.();
			};
			cardElement.onDragEnd = (event) => this.onCardDragEnd?.(card, event);
			cardElement.onSelect = () => {
				if (this.canPlayCard(card) && this.onCardSelect) {
					this.onCardSelect(card);
				}
			};
			return cardElement;
		});

		for (const seat of [1, 2] as const) {
			this.halves[seat].fan.cards = this.cardElements.filter((_element, index) => this.cardDriverMap.get(this.dealtCards[index].id) === seat);
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
			const card = this.dealtCards[index];
			const selected = this.targeting && this.heldCard !== null && card.id === this.heldCard.id;
			cardElement.selected = selected;
			cardElement.enabled = this.targeting ? selected : this.canPlayCard(card);
		});
	}

	/** The slot `card` holds in the hand, or -1. */
	public slotOf(card: Card): number {
		return this.dealtCards.findIndex(held => held.id === card.id);
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

	/** The cards in the hand, a copy. */
	public get handCards(): Card[] {
		return [...this.dealtCards];
	}

	/**
	 * Get the UI card element for a given card
	 */
	public getCardElementByCard(card: Card): UICard | null {
		const cardIndex = this.dealtCards.findIndex(c => c.id === card.id);
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
