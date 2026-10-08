import type { Component } from '../../engine/components/Component';
import { Container } from '../../engine/components/Container';
import type { MountContext } from '../../engine/components/MountContext';
import type { Rect } from '../../engine/draw/geometry';
import type { UiPointerEvent } from '../../engine/input/events';
import { TOOLTIP_ANCHOR_OFFSET } from '../../engine/services/TooltipService';
import type { Card as GameCard } from '../mechanics/Card';
import type { Card as UICard } from './Card';
import { CardInspectView, DETAIL, KEYWORD_PANEL, KeywordSide, inspectViewWidth } from './CardDetailView';
import type { DriverCard } from './DriverCard';
import { CardLookup, DriverDetailView } from './DriverDetailView';
import type { DriverCardData } from './driverCardData';

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
 * The left edge of a view `width` wide centred over a card at
 * `cardCentreX`, kept `margin` inside a screen `viewportWidth` wide.
 */
function centredOver({ cardCentreX, width, viewportWidth, margin }: { cardCentreX: number; width: number; viewportWidth: number; margin: number }): number {
	return Math.max(margin, Math.min(cardCentreX - width / 2, viewportWidth - margin - width));
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
	const detailX = centredOver({ cardCentreX, width, viewportWidth, margin });
	if (!hasKeywords) return { detailX, side: 'right', viewX: detailX };
	const panel = KEYWORD_PANEL.width * scale;
	const offset = KEYWORD_PANEL.offset * scale;
	const roomRight = viewportWidth - margin - (detailX + width + offset);
	const roomLeft = detailX - offset - margin;
	const side: KeywordSide = seat === 2 ? (roomLeft >= panel ? 'left' : 'right') : (roomRight >= panel ? 'right' : 'left');
	return { detailX, side, viewX: side === 'left' ? detailX - offset - panel : detailX };
}

/**
 * A tooltip surface holding an inspect view, scaled into viewport pixels.
 * The outer box is the scaled size, which the tooltip service places; the
 * view itself lays out in logical pixels inside a scaling frame.
 *
 * When the view is bigger than the room the service has for it, the
 * service places the surface at its full size, then sizes it to that room
 * (a constrained placement) and clips it. The surface takes that box as
 * its room: it shrinks the view to fit, rests it on the room's bottom edge
 * with its `overCardX` (its middle unless the view says otherwise) over
 * the card and inside the room, and shows the view's shadow past the box
 * again, since the view itself now fits. The fit has no floor: below the
 * 1024x600 the screens are held to, a big view gets small.
 */
export class InspectSurface<View extends Component & { readonly overCardX?: number }> extends Container {
	public readonly view: View;
	private readonly frame: Component;
	private readonly scaleValue: number;
	/** The middle of the card it inspects across the screen, in viewport pixels; null centres a shrunk view in its room. */
	private readonly cardCentreX: number | null;
	/** The scale the view is drawn at: `scaleValue`, less whatever fitting the room took. */
	private drawnScale: number;
	/** The box the service placed and sized it to when the view didn't fit; null while it fits. */
	private room: Rect | null = null;

	constructor({ id, view, scale, cardCentreX = null }: { id: string; view: View; scale: number; cardCentreX?: number | null }) {
		super({ id, width: view.width * scale, height: view.height * scale });
		this.scaleValue = scale;
		this.drawnScale = scale;
		this.cardCentreX = cardCentreX;
		this.view = view;
		this.frame = new Container({ width: view.width, height: view.height, transform: { scale, origin: [0, 0] } });
		this.frame.addChild(view);
		this.addChild(this.frame);
	}

	/** The scale the view is drawn at, below the one it was built for when it had to shrink into its room. */
	public get viewScale(): number {
		return this.drawnScale;
	}

	/**
	 * Only the tooltip service sizes the surface from outside, and only when
	 * the view doesn't fit where it has just placed it, so the box is the
	 * room. The surface's own sizes go through `resizeInLayout`.
	 */
	public setSize(width: number, height: number): this {
		this.room = { x: this.x, y: this.y, width, height };
		return super.setSize(width, height);
	}

	protected layoutChildren(): void {
		// Laid out here for the size the surface takes; the walk below then skips it unless that dirtied it
		this.view.layoutSubtree();
		const { width, height } = this.view;
		const room = this.room;
		const fit = room ? Math.min(1, room.width / (width * this.scaleValue), room.height / (height * this.scaleValue)) : 1;
		const scale = this.scaleValue * fit;
		if (scale !== this.drawnScale) {
			this.drawnScale = scale;
			this.frame.transform = { scale, origin: [0, 0] };
		}
		this.frame.setSize(width, height);
		const scaledWidth = width * scale;
		const scaledHeight = height * scale;
		this.resizeInLayout(scaledWidth, scaledHeight);
		if (!room) return;
		const wanted = this.cardCentreX === null
			? room.x + (room.width - scaledWidth) / 2
			: this.cardCentreX - (this.view.overCardX ?? width / 2) * scale;
		this.x = Math.max(room.x, Math.min(wanted, room.x + room.width - scaledWidth));
		this.y = room.y + room.height - scaledHeight;
		// The service clips a constrained surface; the view fits inside it now, so only its shadow would be cut
		this.overflow = 'visible';
	}
}

/** A play card's detail view and keyword boxes, as the inspector shows them. */
export class CardInspectSurface extends InspectSurface<CardInspectView> {
	constructor({ card, driver, pinned, keywordSide, scale, cardCentreX }: {
		card: GameCard;
		driver: 1 | 2 | null;
		pinned: boolean;
		keywordSide: KeywordSide;
		scale: number;
		cardCentreX?: number | null;
	}) {
		super({ id: 'card_detail', view: new CardInspectView({ id: 'card_detail_inspect', card, driver, pinned, keywordSide }), scale, cardCentreX });
		this.componentType = 'CardInspectSurface';
	}
}

/** A driver card's detail view, as the inspector shows it. */
export class DriverInspectSurface extends InspectSurface<DriverDetailView> {
	constructor({ data, cards, pinned, scale, cardCentreX }: { data: DriverCardData; cards: CardLookup; pinned: boolean; scale: number; cardCentreX?: number | null }) {
		super({ id: 'driver_detail', view: new DriverDetailView({ id: 'driver_detail_view', data, cards, pinned }), scale, cardCentreX });
		this.componentType = 'DriverInspectSurface';
	}
}

/**
 * Where an inspect view rests: on the screen's bottom edge, `SCREEN_MARGIN`
 * up, less the gap the tooltip service leaves between an owner anchor and
 * its tooltip, its left edge at `x`.
 */
function restingAnchor({ x, viewportHeight, scale }: { x: number; viewportHeight: number; scale: number }): Rect {
	return { x, y: viewportHeight - SCREEN_MARGIN * scale + TOOLTIP_ANCHOR_OFFSET, width: 0, height: 0 };
}

/** What an inspect view's owner is told when its view opens. */
export interface InspectOpening {
	/** The screen, in logical pixels. */
	viewport: { width: number; height: number };
	/** Where the owner is on screen. */
	bounds: Rect;
	/** Logical pixels to viewport pixels where the owner lives. */
	scale: number;
	/** Whether the view opens pinned, so its foot can say so. */
	pinned: boolean;
}

/** The view an owner builds when it opens, and the left edge it takes on screen, in viewport pixels. */
export interface InspectedView {
	surface: Component;
	x: number;
}

/**
 * The inspect path every card shares, a play card's detail view, a driver
 * card's, and an escort card's: a tooltip whose factory calls `open` each
 * time the view opens. It opens on hover after the tooltip delay, at once
 * on keyboard focus, and on a touch hold (R9.30's `contextmenu`, see
 * `inspectOnContextMenu`); a secondary click or I pins it
 * (`toggleInspectPin`), and those find their owner by its tooltip pinning.
 * The view rests on the bottom of the screen at the left edge `open` gives,
 * and grows upward.
 */
export function makeDetailInspectable(owner: Component, open: (opening: InspectOpening) => InspectedView, { scale = () => 1 }: { scale?: () => number } = {}): void {
	let anchor: Rect = { x: 0, y: 0, width: 0, height: 0 };
	owner.tooltip = {
		factory: () => {
			const context = owner.context;
			const viewport = context?.viewport.logical ?? { width: 0, height: 0 };
			const factor = scale();
			const { surface, x } = open({ viewport, bounds: owner.screenBounds, scale: factor, pinned: context?.tooltips.pinned === owner });
			anchor = restingAnchor({ x, viewportHeight: viewport.height, scale: factor });
			return surface;
		},
		placement: { anchor: 'owner', side: 'top', align: 'start', ownerRect: () => anchor },
		immediateOnFocus: true,
		pinnable: true,
	};
}

/**
 * Section 5's detail view on a play card, through the tooltip service the
 * hand's preview used (DDB-88), centred over the card with its keyword
 * boxes on the side with room, whatever screen the card is on: hand, pile,
 * browser, or reward.
 */
export function makeInspectable(card: UICard, { scale, driver = () => card.driver }: InspectableOptions = {}): void {
	makeDetailInspectable(card, ({ viewport, bounds, scale: factor, pinned }) => {
		const seat = driver();
		const hasKeywords = inspectViewWidth(card.data) > DETAIL.width;
		const cardCentreX = bounds.x + bounds.width / 2;
		const placed = inspectLayout({ cardCentreX, viewportWidth: viewport.width, scale: factor, seat, hasKeywords });
		return {
			surface: new CardInspectSurface({ card: card.data, driver: seat, pinned, keywordSide: placed.side, scale: factor, cardCentreX }),
			x: placed.viewX,
		};
	}, { scale });
}

export interface DriverInspectableOptions {
	/**
	 * Where the deck's card types are looked up: the screen's loaded cards
	 * (`(type) => CardLoader.getInstance().createCard(type)`). A type it
	 * doesn't know is left out of the view's deck.
	 */
	cards: CardLookup;
}

/**
 * A driver card's detail view (Game Flow 7.0: their full stats and their
 * deck), on the play card's path, centred over the card. The view is built
 * from the card's data each time it opens, and the card pins it again when
 * its data changes while it's pinned.
 */
export function makeDriverInspectable(card: DriverCard, { cards }: DriverInspectableOptions): void {
	makeDetailInspectable(card, ({ viewport, bounds, scale, pinned }) => {
		const cardCentreX = bounds.x + bounds.width / 2;
		const surface = new DriverInspectSurface({ data: card.data, cards, pinned, scale, cardCentreX });
		return { surface, x: centredOver({ cardCentreX, width: surface.width, viewportWidth: viewport.width, margin: SIDE_MARGIN * scale }) };
	});
}

/** Pins `owner`'s detail view open, or lets it go when it already is. */
export function toggleInspectPin(owner: Component): void {
	const tooltips = owner.context?.tooltips;
	if (!tooltips || !owner.tooltip) return;
	if (tooltips.pinned === owner) tooltips.unpin();
	else tooltips.pin(owner);
}

/** Whether a component opens a detail view: its tooltip pins, as every one `makeDetailInspectable` makes does. */
function hasDetailView(node: Component | null): boolean {
	return node?.tooltip?.pinnable === true;
}

/** The owner of the detail view an event landed on, or under. */
function inspectableAt(target: Component | null): Component | null {
	for (let node = target; node; node = node.parent) {
		if (hasDetailView(node)) return node;
	}
	return null;
}

/**
 * A secondary click on anything under `container` with a detail view (a
 * play card, a driver card, an escort card) pins it, and a touch hold opens
 * it (R9.30 synthesises both as `contextmenu`). On the container rather
 * than the card, since a disabled card is skipped by delivery (R9.5) and an
 * unaffordable card must still be readable. `canPin` lets a screen refuse,
 * as combat does mid-drag.
 */
export function inspectOnContextMenu(container: Component, canPin: () => boolean = () => true): void {
	const previous = container.onContextMenu;
	container.onContextMenu = (event: UiPointerEvent) => {
		previous?.(event);
		const owner = inspectableAt(event.target);
		if (!owner) return;
		event.consume();
		if (event.pointerType === 'touch') {
			owner.context?.tooltips.show(owner);
			return;
		}
		if (canPin()) toggleInspectPin(owner);
	};
}

/**
 * The I key: pins the detail view that's showing, or the focused card's,
 * or lets a pinned one go. True when it did something, for a hotkey table
 * to consume.
 */
export function inspectHotkey(context: MountContext): boolean {
	const tooltips = context.tooltips;
	if (tooltips.pinned) {
		tooltips.unpin();
		return true;
	}
	const owner = [tooltips.owner, context.focus.focused].find(hasDetailView);
	if (!owner) return false;
	tooltips.pin(owner);
	return true;
}

/** The keys that pin: I, either case. */
export const INSPECT_KEYS = ['i', 'I'] as const;
