import { Component, PointerEvents } from '../../engine/components/Component';
import { Text } from '../../engine/components/Text';
import { Rectangle } from '../../engine/components/Rectangle';
import type { AnyUiEvent } from '../../engine/input/events';
import { Card as GameCard } from '../mechanics/Card';

/**
 * Card size variants for different UI contexts
 */
export enum CardSize {
	MINI = 'mini',       // For deck previews, small displays
	NORMAL = 'normal',   // Standard card size for hand and battlefield
	LARGE = 'large'      // For detailed view/inspection
}

/**
 * Card dimensions for each size variant
 */
const CARD_DIMENSIONS = {
	[CardSize.MINI]: { width: 50, height: 70 },
	[CardSize.NORMAL]: { width: 150, height: 210 },
	[CardSize.LARGE]: { width: 240, height: 336 }
} as const;

/** A card title gets up to two lines, at the display face's own line height. */
const TITLE_LINES = 2;
const TITLE_LINE_HEIGHT = 1.2;
/** Space between the title slot and the cost's digits. */
const TITLE_COST_GAP = 4;
/** How far a hovered or selected card rises, through its transform so layout never sees it (R8.26). */
export const CARD_LIFT = 5;
const LIFTED = { translate: [0, -CARD_LIFT] as const };
const RESTING = {};

/**
 * Visual component for displaying a card. One composite target (R8.29):
 * its frame and text are parts, and every state it shows (hovered,
 * selected, disabled, pressed) comes from the framework's flags.
 */
export class Card extends Component {
	private data: GameCard;
	private size: CardSize;
	private name: Text;
	private cost: Text;
	/** Where the cost's digits are centred, and where the title starts and stops short of them. */
	private readonly costCentre: number;
	private readonly titleX: number;
	private readonly titleGap: number;
	private description: Text | null = null;
	private rarity: Text | null = null;
	private tags: Text | null = null;
	private cardBorder: Rectangle;
	private cardBackground: Rectangle;
	private driverIndicator: Text | null = null;
	private driverNumber: 1 | 2 | null = null;

	// Event callbacks
	private clickHandler: ((card: GameCard) => void) | null = null;
	private selectHandler: ((card: GameCard) => void) | null = null;

	constructor({ id, x, y, data, size = CardSize.NORMAL, driverNumber }: { 
		id?: string;
		x: number; 
		y: number; 
		data: GameCard; 
		size?: CardSize;
		driverNumber?: 1 | 2 | null;
	}) {
		const dimensions = CARD_DIMENSIONS[size];
		super({
			id,
			x,
			y,
			width: dimensions.width,
			height: dimensions.height,
		});
		this.componentType = 'Card';

		this.data = data;
		this.size = size;
		this.driverNumber = driverNumber || null;

		// Create card border with rarity color
		this.cardBorder = new Rectangle({
			id: this.childId('border'),
			x: 0,
			y: 0,
			width: dimensions.width,
			height: dimensions.height,
			style: {
				backgroundColor: Card.getRarityColor(data.rarity),
				borderRadius: size === CardSize.MINI ? 4 : 8,
			},
		});
		this.addChild(this.cardBorder);

		// Create card background
		const borderWidth = size === CardSize.MINI ? 2 : 4;
		this.cardBackground = new Rectangle({
			id: this.childId('background'),
			x: borderWidth,
			y: borderWidth,
			width: dimensions.width - borderWidth * 2,
			height: dimensions.height - borderWidth * 2,
			style: {
				backgroundColor: '#2a2a3a',
				borderRadius: size === CardSize.MINI ? 3 : 6,
			},
		});
		this.addChild(this.cardBackground);

		// Scale factors for different card sizes
		const scaleFactor = size === CardSize.MINI ? 0.35 : size === CardSize.LARGE ? 1.2 : 1;
		const padding = Math.floor(12 * scaleFactor);
		const hasDriverBadge = this.driverNumber !== null && size !== CardSize.MINI;
		const badgeX = Math.floor(10 * scaleFactor);
		const badgeSize = Math.floor(25 * scaleFactor);
		// The badge paints over anything submitted before it (chapter 3), so the
		// title starts past it rather than under it.
		const titleX = hasDriverBadge ? badgeX + badgeSize + Math.floor(6 * scaleFactor) : padding;
		const headerY = Math.floor(20 * scaleFactor);
		const titleSize = Math.floor(14 * scaleFactor);

		// Cost: hugs its digits, centred 30 px in from the right edge
		this.cost = new Text(`${data.cost}`, {
			id: this.childId('cost'),
			y: headerY,
			style: {
				fontSize: Math.floor(20 * scaleFactor),
				color: '#ffaa00',
				fontWeight: 'bold',
				whiteSpace: 'nowrap',
			},
		});
		this.costCentre = dimensions.width - Math.floor(30 * scaleFactor);
		this.titleX = titleX;
		this.titleGap = TITLE_COST_GAP * scaleFactor;

		// Card name: runs up to the cost's measured left edge, wraps to a second
		// line rather than under it, and a name that needs a third is cut with
		// an ellipsis. Two line boxes end above the description. Both are
		// placed by placeHeader once the cost has measured.
		this.name = new Text(data.displayName, {
			id: this.childId('title'),
			x: titleX,
			y: headerY,
			height: Math.ceil(TITLE_LINES * titleSize * TITLE_LINE_HEIGHT),
			style: {
				fontSize: titleSize,
				lineHeight: TITLE_LINE_HEIGHT,
				color: '#ffffff',
				fontWeight: 'bold',
				textOverflow: 'ellipsis',
			},
		});
		this.addChild(this.name);
		this.addChild(this.cost);
		this.placeHeader();

		// Description with automatic text wrapping
		// Skip description for mini cards
		if (size !== CardSize.MINI) {
			// The face shows the summary (Card System Design 1.1); the full rules
			// text is for the detail view. Keyword brackets become highlights
			// with DDB-137, plain until then. The box ends above the rarity line
			// and the ellipsis is only a backstop: no summary reaches it.
			const descriptionY = Math.floor(60 * scaleFactor);
			this.description = new Text(Card.faceText(data.displaySummary), {
				id: this.childId('description'),
				x: padding,
				y: descriptionY,
				width: dimensions.width - padding * 2,
				height: dimensions.height - Math.floor(60 * scaleFactor) - Math.floor(4 * scaleFactor) - descriptionY,
				style: {
					fontSize: Math.floor(11 * scaleFactor),
					color: '#cccccc',
					lineHeight: 1.4,
					textOverflow: 'ellipsis',
				},
			});
			this.addChild(this.description);
		}

		// Rarity - only show on normal and large cards
		if (size !== CardSize.MINI) {
			this.rarity = new Text(data.rarity.toUpperCase(), {
				id: this.childId('rarity'),
				x: padding,
				y: dimensions.height - Math.floor(60 * scaleFactor),
				style: {
					fontSize: Math.floor(10 * scaleFactor),
					color: Card.getRarityColor(data.rarity),
					fontWeight: 'bold',
				},
			});
			this.addChild(this.rarity);

			// Tags
			const tagsStr = data.tags.join(', ');
			this.tags = new Text(tagsStr, {
				id: this.childId('tags'),
				x: padding,
				y: dimensions.height - Math.floor(35 * scaleFactor),
				width: dimensions.width - padding * 2,
				style: {
					fontSize: Math.floor(8 * scaleFactor),
					color: '#888888',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
				},
			});
			this.addChild(this.tags);

			// Target type
			const targetText = new Text(data.targetType, {
				id: this.childId('target_type'),
				x: padding,
				y: dimensions.height - Math.floor(20 * scaleFactor),
				style: {
					fontSize: Math.floor(8 * scaleFactor),
					color: '#666666',
				},
			});
			this.addChild(targetText);
		}

		// Driver indicator (if specified)
		if (hasDriverBadge) {
			const indicatorBg = new Rectangle({
				id: this.childId('driver_badge_background'),
				x: badgeX,
				y: badgeX,
				width: badgeSize,
				height: badgeSize,
				style: {
					backgroundColor: this.driverNumber === 1 ? '#4a4a8a' : '#4a8a4a',
					borderRadius: Math.floor(12.5 * scaleFactor),
					borderColor: this.driverNumber === 1 ? '#6a6aaa' : '#6aaa6a',
					borderWidth: 2,
				},
			});
			this.addChild(indicatorBg);
			
			// Centred in the badge
			this.driverIndicator = new Text(`D${this.driverNumber}`, {
				id: this.childId('driver_badge'),
				x: badgeX,
				y: badgeX,
				width: badgeSize,
				height: badgeSize,
				style: {
					fontSize: Math.floor(10 * scaleFactor),
					color: '#ffffff',
					textAlign: 'center',
					verticalAlign: 'middle',
					whiteSpace: 'nowrap',
					fontWeight: 'bold',
				},
			});
			this.addChild(this.driverIndicator);
		}
	}

	/**
	 * Composite internals derive their ids from the card's own, so a caller
	 * names the card once and the lint can still address `<card>_title` and
	 * `<card>_driver_badge`. Unnamed cards leave their children unnamed too.
	 */
	private childId(suffix: string): string | undefined {
		return this.id === null ? undefined : `${this.id}_${suffix}`;
	}

	/**
	 * The cost hugs its digits and the title runs up to their left edge, so
	 * both are placed from the cost's measured width: on construction, and in
	 * the layout phase once the cost has measured through the mount context
	 * (R1.6, R8.18).
	 */
	private placeHeader(): void {
		this.cost.setX(this.costCentre - this.cost.getWidth() / 2);
		this.name.setWidth(Math.floor(this.cost.getX() - this.titleGap - this.titleX));
	}

	protected layoutChildren(): void {
		this.placeHeader();
	}

	/** R8.29: a card is one target; its text and frame are internals. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'unit';
	}

	/**
	 * Hover arrives through `onHover` and `onUnhover`, which the dispatcher
	 * drives (R9.8); the press shades the frame, and the click is the
	 * dispatcher's, synthesised when press and release both land on this card
	 * (R9.31). A disabled card receives none of these (R9.5). A focused card
	 * treats `activate` (Enter or Space) as a click (R9.27); only the hand
	 * makes its cards focusable.
	 */
	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		switch (event.type) {
			case 'activate':
				event.consume();
				this.activate();
				return;
			case 'pointerdown':
				if (event.button === 0) {
					this.cardBorder.setFillColor(this.adjustBrightness(Card.getRarityColor(this.data.rarity), -20));
				}
				return;
			case 'pointerup':
			case 'pointerleave':
			case 'pointercancel':
				this.cardBorder.setFillColor(Card.getRarityColor(this.data.rarity));
				return;
			case 'click':
				this.activate();
				return;
		}
	}

	/** A click, as the two semantic callbacks. */
	private activate(): void {
		if (this.clickHandler) {
			this.clickHandler(this.data);
		}
		if (this.selectHandler) {
			this.selectHandler(this.data);
		}
	}

	/**
	 * Set click handler (legacy - prefer semantic handlers)
	 */
	public setOnClick(handler: (card: GameCard) => void): void {
		this.clickHandler = handler;
	}

	/**
	 * Set semantic event handlers
	 */
	public setOnSelect(handler: (card: GameCard) => void): void {
		this.selectHandler = handler;
	}

	/**
	 * Set selected state
	 */
	public setSelected(selected: boolean): void {
		this.selected = selected;
	}

	/**
	 * Get selected state
	 */
	public isSelected(): boolean {
		return this.selected;
	}

	/**
	 * Hover, selection, and enabled state, the last inherited (R8.3): a
	 * selected card, or a hovered one that can be played, rises and takes a
	 * glow; a disabled card dims. The dispatcher keeps `hovered` true over a
	 * disabled card (R9.8), so the glow checks enabled itself.
	 */
	protected onStateChange(): void {
		const enabled = this.effectivelyEnabled;
		if (this.selected) {
			this.cardBorder.setBorderWidth(3);
			this.cardBorder.setBorderColor('#00aaff');
		} else if (this.hovered && enabled) {
			this.cardBorder.setBorderWidth(3);
			this.cardBorder.setBorderColor('#ffffff');
		} else {
			this.cardBorder.setBorderWidth(0);
		}
		this.transform = this.selected || (this.hovered && enabled) ? LIFTED : RESTING;
		this.cardBackground.setFillColor(enabled ? '#2a2a3a' : '#1a1a2a');
	}

	/**
	 * Adjust color brightness
	 */
	private adjustBrightness(color: string, amount: number): string {
		// Simple brightness adjustment for hex colors
		if (color.startsWith('#')) {
			const hex = color.slice(1);
			const r = Math.max(0, Math.min(255, parseInt(hex.slice(0, 2), 16) + amount));
			const g = Math.max(0, Math.min(255, parseInt(hex.slice(2, 4), 16) + amount));
			const b = Math.max(0, Math.min(255, parseInt(hex.slice(4, 6), 16) + amount));
			return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
		}
		return color;
	}

	/** A summary as the face draws it: `[keyword]` brackets stripped. */
	public static faceText(summary: string): string {
		return summary.replace(/\[(.+?)\]/g, '$1');
	}

	/**
	 * Get color based on card rarity
	 */
	private static getRarityColor(rarity: string): string {
		switch (rarity) {
			case 'starter':
				return '#666666';
			case 'common':
				return '#ffffff';
			case 'uncommon':
				return '#00aa00';
			case 'rare':
				return '#0088ff';
			case 'legendary':
				return '#ff8800';
			case 'signature':
				return '#cc66ff';
			default:
				return '#ffffff';
		}
	}

	/**
	 * Get the card data
	 */
	public getData(): GameCard {
		return this.data;
	}

	/**
	 * Get card dimensions for a specific size
	 */
	public static getDimensions(size: CardSize = CardSize.NORMAL): { width: number; height: number } {
		return CARD_DIMENSIONS[size];
	}
	
	/**
	 * Get the current size of this card
	 */
	public getSize(): CardSize {
		return this.size;
	}
	
	/**
	 * Set driver number and update indicator
	 */
	public setDriverNumber(driverNumber: 1 | 2 | null): void {
		if (this.driverNumber === driverNumber) return;
		
		this.driverNumber = driverNumber;
		
		// Update visual indicator if needed
		if (this.driverIndicator) {
			this.driverIndicator.setText(driverNumber ? `D${driverNumber}` : '');
		}
	}
	
	/**
	 * Get driver number
	 */
	public get driver(): 1 | 2 | null {
		return this.driverNumber;
	}
}