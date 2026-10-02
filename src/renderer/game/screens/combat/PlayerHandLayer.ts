import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import type { Component } from '../../../engine/components/Component';
import type { UiDragEvent, UiPointerEvent } from '../../../engine/input/events';
import { Card as UICard, CardSize } from '../../ui/Card';
import { inspectOnContextMenu, makeInspectable } from '../../ui/cardInspect';
import { Card } from '../../mechanics/Card';
import { DriverSeat, PlayerHandView } from './PlayerHandView';
import { DriverResourceData, DriverTab } from './DriverTab';
import { HandFan } from './HandFan';
import { rgba } from './combatStyle';

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
	/** Each card's element while it stays in the hand, so a re-deal keeps it (and a pin on it). */
	private readonly elementOf = new Map<Card, UICard>();
	/** Counts the elements built, for their ids; the first deal's match their slots. */
	private builtElements = 0;
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
			this.halves[seat].tab.pileButton.onClick = () => this.onOpenPiles?.(seat);
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

	/** A driver's discard pile on their tab, where their discards fly. */
	public pilesOf(seat: DriverSeat): Component {
		return this.halves[seat].tab.piles;
	}

	/** A driver's tab. */
	public tabOf(seat: DriverSeat): DriverTab {
		return this.halves[seat].tab;
	}

	/** A driver's tab (name, tag, mods, adrenaline, piles), and whether their half has a hand. */
	public setDriverData(seat: DriverSeat, data: Partial<DriverResourceData>): void {
		this.halves[seat].tab.setData(data);
		if (data.crashedOut !== undefined) this.halves[seat].crashedOut = data.crashedOut;
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
	 * Deal each card into its driver's fan, in hand order. A card still in
	 * the hand keeps its element, so hover, focus, and a pinned detail view
	 * survive the deal; a new card gets a new one, and a card gone from the
	 * hand takes its element with it, which unmounts and releases its input
	 * registrations.
	 */
	private createCardElements(): void {
		const dealt = new Set(this.dealtCards);
		for (const card of [...this.elementOf.keys()]) {
			if (!dealt.has(card)) this.elementOf.delete(card);
		}
		this.cardElements = this.dealtCards.map((card) => {
			const existing = this.elementOf.get(card);
			if (existing) return existing;
			const element = this.buildCardElement(card);
			this.elementOf.set(card, element);
			return element;
		});

		for (const seat of [1, 2] as const) {
			this.halves[seat].fan.cards = this.cardElements.filter((_element, index) => this.cardDriverMap.get(this.dealtCards[index].id) === seat);
		}
		this.updateCardSelectionVisuals();
	}

	private buildCardElement(card: Card): UICard {
		// Model ids re-roll every load, so the id is a build count plus the
		// card type. The count carries uniqueness on its own, since a type can
		// repeat in a hand, and on the first deal it is the hand slot; the
		// whole string still varies between runs because the shuffle decides
		// which type lands where.
		const cardElement = new UICard({
			id: `hand_card_${this.builtElements++}_${card.type}`,
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
	 * first, for a keyboard player whose card was just played or put back,
	 * and so has left the hand or been dealt again.
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
 * One driver's half of the hand: their tab, and their fan below it. A
 * driver who crashed out has no hand for the rest of the fight (section 9),
 * so their half says so where the fan was.
 */
class HandHalf extends Stack {
	public readonly tab: DriverTab;
	public readonly fan: HandFan;
	private readonly crashNote: Stack;

	constructor({ seat }: { seat: DriverSeat }) {
		super({ direction: 'vertical', crossAlign: 'stretch', widthMode: 'fill', heightMode: 'fill' });
		this.tab = new DriverTab({ id: `driver${seat}_tab`, seat });
		this.fan = new HandFan({ id: `driver${seat}_hand`, widthMode: 'fill', heightMode: 'fill' });
		this.crashNote = new Stack({
			id: `driver${seat}_crashed_out`,
			widthMode: 'fill',
			heightMode: 'fill',
			distribution: 'center',
			crossAlign: 'center',
			visible: false,
		});
		this.crashNote.addChild(new Text({
			text: 'No free seat after the wreck: out of this fight',
			style: { fontRole: 'mono', fontSize: 12, color: rgba('text_dim') },
			wrap: 'none',
			textOverflow: 'ellipsis',
		}));
		this.addChild(this.tab);
		this.addChild(this.fan);
		this.addChild(this.crashNote);
	}

	public get crashedOut(): boolean {
		return this.crashNote.visible;
	}

	public set crashedOut(crashedOut: boolean) {
		this.fan.visible = !crashedOut;
		this.crashNote.visible = crashedOut;
	}
}
