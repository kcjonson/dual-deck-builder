import type { Component } from '../../engine/components/Component';
import { Container } from '../../engine/components/Container';
import type { MountContext } from '../../engine/components/MountContext';
import type { Rect } from '../../engine/draw/geometry';
import type { UiPointerEvent } from '../../engine/input/events';
import { TOOLTIP_ANCHOR_OFFSET } from '../../engine/services/TooltipService';
import type { Card as GameCard } from '../mechanics/Card';
import { Card as UICard } from './Card';
import { CardInspectView, DETAIL, KEYWORD_PANEL, KeywordSide, inspectViewWidth } from './CardDetailView';

/** The detail view rests this far above the screen's bottom edge, and keeps this far from its sides. */
const SCREEN_MARGIN = 10;
const SIDE_MARGIN = 8;

export interface InspectableOptions {
	/**
	 * Logical pixels to viewport pixels where the card lives: the combat
	 * stage scales its whole canvas, so the view does too, to stay the size
	 * the design gives it relative to the hand. 1 when absent.
	 */
	scale?: () => number;
	/** The driver whose card it is, for the frame colour; the card's own when absent. */
	driver?: () => 1 | 2 | null;
}

/**
 * Where an inspect view goes for a card at `cardCentreX` on a screen
 * `viewportWidth` wide: the detail view centred over the card and clamped
 * inside the screen, the keyword boxes on the side with room (driver 2's
 * cards prefer the left, everyone else's the right, as the mock does),
 * never over the view. In viewport pixels at `scale`.
 */
export function inspectLayout({ cardCentreX, viewportWidth, scale, seat, hasKeywords }: {
	cardCentreX: number;
	viewportWidth: number;
	scale: number;
	seat: 1 | 2 | null;
	hasKeywords: boolean;
}): { detailX: number; side: KeywordSide; viewX: number } {
	const width = DETAIL.width * scale;
	const margin = SIDE_MARGIN * scale;
	const detailX = Math.max(margin, Math.min(cardCentreX - width / 2, viewportWidth - margin - width));
	if (!hasKeywords) return { detailX, side: 'right', viewX: detailX };
	const panel = KEYWORD_PANEL.width * scale;
	const offset = KEYWORD_PANEL.offset * scale;
	const roomRight = viewportWidth - margin - (detailX + width + offset);
	const roomLeft = detailX - offset - margin;
	const side: KeywordSide = seat === 2 ? (roomLeft >= panel ? 'left' : 'right') : (roomRight >= panel ? 'right' : 'left');
	return { detailX, side, viewX: side === 'left' ? detailX - offset - panel : detailX };
}

/**
 * The tooltip surface: the inspect view scaled into viewport pixels. The
 * outer box is the scaled size, which the tooltip service places; the
 * view itself lays out in logical pixels inside a scaling frame.
 */
export class CardInspectSurface extends Container {
	public readonly view: CardInspectView;
	private readonly frame: Component;
	private readonly scaleValue: number;

	constructor({ card, driver, pinned, keywordSide, scale }: {
		card: GameCard;
		driver: 1 | 2 | null;
		pinned: boolean;
		keywordSide: KeywordSide;
		scale: number;
	}) {
		super({ id: 'card_detail', width: DETAIL.width * scale, height: DETAIL.maxHeight * scale });
		this.componentType = 'CardInspectSurface';
		this.scaleValue = scale;
		this.view = new CardInspectView({ id: 'card_detail_inspect', card, driver, pinned, keywordSide });
		this.frame = new Container({ width: DETAIL.width, height: DETAIL.maxHeight, transform: { scale, origin: [0, 0] } });
		this.frame.addChild(this.view);
		this.addChild(this.frame);
	}

	protected layoutChildren(): void {
		this.view.arrange();
		const { width, height } = this.view;
		this.frame.setSize(width, height);
		const scaledWidth = width * this.scaleValue;
		const scaledHeight = height * this.scaleValue;
		if (this.width !== scaledWidth || this.height !== scaledHeight) this.setSize(scaledWidth, scaledHeight);
	}
}

/**
 * Section 5's detail view on a card, through the tooltip service the hand's
 * preview used (DDB-88): it opens on hover after the tooltip delay, at once
 * on keyboard focus, and on a touch hold (R9.30's `contextmenu`, see
 * `inspectOnContextMenu`); a secondary click or I pins it (`toggleInspectPin`).
 * It rests on the bottom of the screen, centred over the card, and grows
 * upward, whatever screen the card is on: hand, pile, browser, or reward.
 */
export function makeInspectable(card: UICard, { scale = () => 1, driver = () => card.driver }: InspectableOptions = {}): void {
	let anchor: Rect = { x: 0, y: 0, width: 0, height: 0 };
	card.tooltip = {
		factory: () => {
			const context = card.context;
			const viewport = context?.viewport.logical ?? { width: 0, height: 0 };
			const factor = scale();
			const seat = driver();
			const bounds = card.screenBounds;
			const hasKeywords = inspectViewWidth(card.data) > DETAIL.width;
			const placed = inspectLayout({ cardCentreX: bounds.x + bounds.width / 2, viewportWidth: viewport.width, scale: factor, seat, hasKeywords });
			// The bottom edge the view rests on, less the gap the service leaves
			// between an owner anchor and its tooltip
			anchor = { x: placed.viewX, y: viewport.height - SCREEN_MARGIN * factor + TOOLTIP_ANCHOR_OFFSET, width: 0, height: 0 };
			return new CardInspectSurface({
				card: card.data,
				driver: seat,
				pinned: context?.tooltips.pinned === card,
				keywordSide: placed.side,
				scale: factor,
			});
		},
		placement: { anchor: 'owner', side: 'top', align: 'start', ownerRect: () => anchor },
		immediateOnFocus: true,
		pinnable: true,
	};
}

/** Pins `card`'s detail view open, or lets it go when it already is. */
export function toggleInspectPin(card: Component): void {
	const tooltips = card.context?.tooltips;
	if (!tooltips || !card.tooltip) return;
	if (tooltips.pinned === card) tooltips.unpin();
	else tooltips.pin(card);
}

/** The inspectable card an event landed on, or under. */
function cardAt(target: Component | null): UICard | null {
	for (let node = target; node; node = node.parent) {
		if (node instanceof UICard) return node.tooltip ? node : null;
	}
	return null;
}

/**
 * A secondary click on any inspectable card under `container` pins its
 * detail view, and a touch hold opens it (R9.30 synthesises both as
 * `contextmenu`). On the container rather than the card, since a disabled
 * card is skipped by delivery (R9.5) and an unaffordable card must still be
 * readable. `canPin` lets a screen refuse, as combat does mid-drag.
 */
export function inspectOnContextMenu(container: Component, canPin: () => boolean = () => true): void {
	const previous = container.onContextMenu;
	container.onContextMenu = (event: UiPointerEvent) => {
		previous?.(event);
		const card = cardAt(event.target);
		if (!card) return;
		event.consume();
		if (event.pointerType === 'touch') {
			card.context?.tooltips.show(card);
			return;
		}
		if (canPin()) toggleInspectPin(card);
	};
}

/**
 * The I key: pins the card whose detail view is showing, or the focused
 * card's, or lets a pinned one go. True when it did something, for a
 * hotkey table to consume.
 */
export function inspectHotkey(context: MountContext): boolean {
	const tooltips = context.tooltips;
	if (tooltips.pinned) {
		tooltips.unpin();
		return true;
	}
	const shown = tooltips.owner instanceof UICard ? tooltips.owner : null;
	const focused = context.focus.focused instanceof UICard ? context.focus.focused : null;
	const card = shown ?? focused;
	if (!card?.tooltip) return false;
	tooltips.pin(card);
	return true;
}

/** The keys that pin: I, either case. */
export const INSPECT_KEYS = ['i', 'I'] as const;
