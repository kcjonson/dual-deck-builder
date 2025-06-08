import { Component } from '../components/Component';
import { Layer } from '../components/Layer';
import { Text } from '../components/Text';
import { Rectangle } from '../components/Rectangle';
import { RenderContext } from '../rendering/RenderContext';
import { InputSystem } from '../input/InputSystem';
import { Card as GameCard } from '../../game/mechanics/Card';

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
	[CardSize.NORMAL]: { width: 160, height: 224 },
	[CardSize.LARGE]: { width: 240, height: 336 }
} as const;

/**
 * Visual component for displaying a card
 */
export class Card extends Component {
	private data: GameCard;
	private size: CardSize;
	private name: Text;
	private cost: Text;
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
	private activateHandler: ((card: GameCard) => void) | null = null;
	private targetHandler: ((card: GameCard) => void) | null = null;
	
	// Selection state
	private selected = false;

	constructor({ x, y, data, size = CardSize.NORMAL, driverNumber }: { 
		x: number; 
		y: number; 
		data: GameCard; 
		size?: CardSize;
		driverNumber?: 1 | 2 | null;
	}) {
		const dimensions = CARD_DIMENSIONS[size];
		super({
			x,
			y,
			width: dimensions.width,
			height: dimensions.height,
		});

		this.data = data;
		this.size = size;
		this.driverNumber = driverNumber || null;

		// Create card border with rarity color
		this.cardBorder = new Rectangle({
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
		
		// Card name
		this.name = new Text(data.displayName, {
			x: padding,
			y: Math.floor(20 * scaleFactor),
			width: dimensions.width - Math.floor(60 * scaleFactor),
			style: {
				fontSize: Math.floor(18 * scaleFactor),
				color: '#ffffff',
				fontWeight: 'bold',
				whiteSpace: 'nowrap',
				textOverflow: 'ellipsis',
			},
		});
		this.addChild(this.name);

		// Cost
		this.cost = new Text(`${data.cost}`, {
			x: dimensions.width - Math.floor(30 * scaleFactor),
			y: Math.floor(20 * scaleFactor),
			style: {
				fontSize: Math.floor(24 * scaleFactor),
				color: '#ffaa00',
				fontWeight: 'bold',
				textAlign: 'center',
			},
		});
		this.addChild(this.cost);

		// Description with automatic text wrapping
		// Skip description for mini cards
		if (size !== CardSize.MINI) {
			this.description = new Text(data.getDescription(), {
				x: padding,
				y: Math.floor(60 * scaleFactor),
				width: dimensions.width - padding * 2,
				height: Math.floor(140 * scaleFactor),
				style: {
					fontSize: Math.floor(14 * scaleFactor),
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
				x: padding,
				y: dimensions.height - Math.floor(60 * scaleFactor),
				style: {
					fontSize: Math.floor(12 * scaleFactor),
					color: Card.getRarityColor(data.rarity),
					fontWeight: 'bold',
				},
			});
			this.addChild(this.rarity);

			// Tags
			const tagsStr = data.tags.join(', ');
			this.tags = new Text(tagsStr, {
				x: padding,
				y: dimensions.height - Math.floor(35 * scaleFactor),
				width: dimensions.width - padding * 2,
				style: {
					fontSize: Math.floor(10 * scaleFactor),
					color: '#888888',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
				},
			});
			this.addChild(this.tags);

			// Target type
			const targetText = new Text(data.targetType, {
				x: padding,
				y: dimensions.height - Math.floor(20 * scaleFactor),
				style: {
					fontSize: Math.floor(10 * scaleFactor),
					color: '#666666',
				},
			});
			this.addChild(targetText);
		}

		// Driver indicator (if specified)
		if (this.driverNumber && size !== CardSize.MINI) {
			const indicatorBg = new Rectangle({
				x: Math.floor(10 * scaleFactor),
				y: Math.floor(10 * scaleFactor),
				width: Math.floor(25 * scaleFactor),
				height: Math.floor(25 * scaleFactor),
				style: {
					backgroundColor: this.driverNumber === 1 ? '#4a4a8a' : '#4a8a4a',
					borderRadius: Math.floor(12.5 * scaleFactor),
					borderColor: this.driverNumber === 1 ? '#6a6aaa' : '#6aaa6a',
					borderWidth: 2,
				},
			});
			this.addChild(indicatorBg);
			
			this.driverIndicator = new Text(`D${this.driverNumber}`, {
				x: Math.floor(22.5 * scaleFactor),
				y: Math.floor(22.5 * scaleFactor),
				style: {
					fontSize: Math.floor(12 * scaleFactor),
					color: '#ffffff',
					textAlign: 'center',
					fontWeight: 'bold',
				},
			});
			this.addChild(this.driverIndicator);
		}

		// Setup event handling
		this.setupEvents();
	}

	/**
	 * Setup mouse event handling
	 */
	private setupEvents(): void {
		// Register event handlers with the global input system
		InputSystem.registerMouseOver(this, () => this.handleMouseOver());
		InputSystem.registerMouseOut(this, () => this.handleMouseOut());
		InputSystem.registerMouseDown(this, () => this.handleMouseDown());
		InputSystem.registerMouseUp(this, () => this.handleMouseUp());
	}

	/**
	 * Handle mouse over
	 */
	private handleMouseOver(): void {
		if (!this.enabled) return;
		this.setHovered(true);
	}

	/**
	 * Handle mouse out
	 */
	private handleMouseOut(): void {
		this.setHovered(false);
	}

	/**
	 * Handle mouse down
	 */
	private handleMouseDown(): void {
		if (!this.enabled) return;
		// Visual feedback for press
		this.cardBorder.setFillColor(this.adjustBrightness(Card.getRarityColor(this.data.rarity), -20));
	}

	/**
	 * Handle mouse up
	 */
	private handleMouseUp(): void {
		if (!this.enabled) return;
		
		// Reset visual
		this.cardBorder.setFillColor(Card.getRarityColor(this.data.rarity));
		
		// Trigger click (InputSystem already verified mouse is over component)
		this.onClick();
	}

	/**
	 * Handle click event - maps to semantic events
	 */
	private onClick(): void {
		// Legacy click handler for backwards compatibility
		if (this.clickHandler) {
			this.clickHandler(this.data);
		}
		
		// Primary semantic event: select the card
		this.select();
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

	public setOnActivate(handler: (card: GameCard) => void): void {
		this.activateHandler = handler;
	}

	public setOnTarget(handler: (card: GameCard) => void): void {
		this.targetHandler = handler;
	}

	/**
	 * Set selected state
	 */
	public setSelected(selected: boolean): void {
		this.selected = selected;
		this.updateVisuals();
	}

	/**
	 * Get selected state
	 */
	public isSelected(): boolean {
		return this.selected;
	}

	/**
	 * Override hover lifecycle methods to update visuals
	 */
	protected onHover(): void {
		this.updateVisuals();
	}

	protected onUnhover(): void {
		this.updateVisuals();
	}

	/**
	 * Update card visuals based on current state
	 */
	private updateVisuals(): void {
		// Reset position first
		if (this.getY() % 10 !== 0) { // Simple check if lifted
			this.setY(this.getY() + 5);
		}

		if (this.selected) {
			// Selected state - blue glow and lift
			this.cardBorder.setBorderWidth(3);
			this.cardBorder.setBorderColor('#00aaff');
			this.setY(this.getY() - 5);
		} else if (this.hovered && this.enabled) {
			// Hovered state - white glow and lift
			this.cardBorder.setBorderWidth(3);
			this.cardBorder.setBorderColor('#ffffff');
			this.setY(this.getY() - 5);
		} else {
			// Normal state
			this.cardBorder.setBorderWidth(0);
		}
	}

	/**
	 * Override enabled lifecycle methods to update visuals
	 */
	protected onEnabled(): void {
		this.cardBackground.setFillColor('#2a2a3a');
	}

	protected onDisabled(): void {
		// Dim the card when disabled
		this.cardBackground.setFillColor('#1a1a2a');
	}

	/**
	 * Semantic event implementations
	 */
	protected onSelect(): void {
		this.setSelected(true);
		if (this.selectHandler) {
			this.selectHandler(this.data);
		}
	}

	protected onDeselect(): void {
		this.setSelected(false);
	}

	protected onActivate(): void {
		if (this.activateHandler) {
			this.activateHandler(this.data);
		}
	}

	protected onTarget(): void {
		if (this.targetHandler) {
			this.targetHandler(this.data);
		}
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
	 * Render the card component
	 */
	public render(context?: RenderContext): void {
		// Use Layer's render method to handle children rendering
		Layer.prototype.render.call(this, context);
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