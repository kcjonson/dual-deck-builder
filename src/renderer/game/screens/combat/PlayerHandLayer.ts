import { Stack, StackOptions } from '../../../engine/components/Stack';
import type { Component } from '../../../engine/components/Component';
import type { UiDragEvent, UiPointerEvent } from '../../../engine/input/events';
import { Card as UICard, CardSize } from '../../ui/Card';
import { inspectOnContextMenu, makeInspectable } from '../../ui/cardInspect';
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
	private unaffordableCardIds: Set<string> = new Set();
	private readonly halves: Record<DriverSeat, HandHalf>;

	// Callbacks
	/** A card clicked or activated in the hand (R8.25). */
	public onCardSelect: ((card: Card) => void) | null = null;
	private onCardPress: ((card: Card, element: UICard, event: UiPointerEvent) => void) | null = null;
	private onCardDragEnd: ((card: Card, event: UiDragEvent) => void) | null = null;
	private onOtherButton: (() => boolean) | null = null;
	/** The secondary press now down cancelled a drag or a target choice, so its release pins nothing. */
	private pressCancelled = false;
	/** A driver's tab clicked: show their draw and discard piles. */
	public onOpenPiles: ((seat: DriverSeat) => void) | null = null;
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
		for (const seat of [1, 2] as const) {
			const tab = this.halves[seat].tab;
			tab.pointerEvents = 'unit';
			tab.onClick = () => this.onOpenPiles?.(seat);
			tab.tooltip = 'Draw and discard piles';
		}
		this.addChild(this.halves[1]);
		this.addChild(this.halves[2]);
		// A secondary click pins a card's detail view and a touch hold opens
		// it, on any card in the hand, playable or not; never mid-drag, where
		// a secondary button cancels the drag instead (section 6)
		// Another button pressed anywhere in the hand, on a card or on one
		// disabled while another is being targeted (delivery skips it and the
		// press bubbles here), cancels
		this.onPointerDown = (event) => {
			if (event.button !== 0) this.pressCancelled = this.onOtherButton?.() ?? false;
		};
		inspectOnContextMenu(this, () => {
			const cancelled = this.pressCancelled;
			this.pressCancelled = false;
			return !cancelled && !this.targeting && !this.context?.drag.isDragging;
		});
	}

	/**
	 * Show both drivers' cards, each in its driver's half, with the
	 * unplayable ones disabled
	 */
	public set hand({ cards, seatOf, playable, unaffordable }: PlayerHandView) {
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
		this.unaffordableCardIds = unaffordable;
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
		/** True when it cancelled something (a drag, a target choice). */
		otherButton: () => boolean;
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
			// Section 5's detail view, through the tooltip factory as DDB-88's
			// preview was: hover, focus, a touch hold, and a pin. The stage
			// scales the whole canvas, so the view scales with it
			makeInspectable(cardElement, { scale: () => this.stageScale, driver: () => cardElement.driver });
			cardElement.onPointerDown = (event) => {
				if (event.button === 0) this.onCardPress?.(card, cardElement, event);
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

	/** The combat stage's scale: logical pixels to the tooltip root's. */
	private get stageScale(): number {
		const matrix = this.screenMatrix;
		return Math.hypot(matrix[0], matrix[1]);
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
			cardElement.unaffordable = this.unaffordableCardIds.has(card.id);
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
