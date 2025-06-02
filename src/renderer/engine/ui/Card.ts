import { Component } from '../components/Component';
import { Layer } from '../components/Layer';
import { Text } from '../components/Text';
import { Rectangle } from '../components/Rectangle';
import { RenderContext } from '../rendering/RenderContext';
import { InputSystem } from '../input/InputSystem';
import { Card as CardData } from '../../game/mechanics/Card';

/**
 * Visual component for displaying a card
 */
export class Card extends Component {
	private data: CardData;
	private name: Text;
	private cost: Text;
	private description: Text;
	private rarity: Text;
	private tags: Text;
	private cardBorder: Rectangle;
	private cardBackground: Rectangle;

	// Event callbacks
	private clickHandler: ((card: CardData) => void) | null = null;
	private selectHandler: ((card: CardData) => void) | null = null;
	private activateHandler: ((card: CardData) => void) | null = null;
	private targetHandler: ((card: CardData) => void) | null = null;
	
	// Selection state
	private selected: boolean = false;

	private static readonly WIDTH = 240;
	private static readonly HEIGHT = 340;

	constructor({ x, y, data }: { x: number; y: number; data: CardData }) {
		super({
			x,
			y,
			width: Card.WIDTH,
			height: Card.HEIGHT,
		});

		this.data = data;

		// Create card border with rarity color
		this.cardBorder = new Rectangle({
			x: 0,
			y: 0,
			width: Card.WIDTH,
			height: Card.HEIGHT,
			style: {
				backgroundColor: Card.getRarityColor(data.getRarity()),
				borderRadius: 8,
			},
		});
		this.addChild(this.cardBorder);

		// Create card background
		this.cardBackground = new Rectangle({
			x: 4,
			y: 4,
			width: Card.WIDTH - 8,
			height: Card.HEIGHT - 8,
			style: {
				backgroundColor: '#2a2a3a',
				borderRadius: 6,
			},
		});
		this.addChild(this.cardBackground);

		// Card name
		this.name = new Text(data.getName(), {
			x: 12,
			y: 20,
			width: Card.WIDTH - 60,
			style: {
				fontSize: 18,
				color: '#ffffff',
				fontWeight: 'bold',
				whiteSpace: 'nowrap',
				textOverflow: 'ellipsis',
			},
		});
		this.addChild(this.name);

		// Cost
		this.cost = new Text(`${data.getCost()}`, {
			x: Card.WIDTH - 30,
			y: 20,
			style: {
				fontSize: 24,
				color: '#ffaa00',
				fontWeight: 'bold',
				textAlign: 'center',
			},
		});
		this.addChild(this.cost);

		// Description with automatic text wrapping
		this.description = new Text(data.getDescription(), {
			x: 12,
			y: 60,
			width: Card.WIDTH - 24,
			height: 140,
			style: {
				fontSize: 14,
				color: '#cccccc',
				lineHeight: 1.4,
				textOverflow: 'ellipsis',
			},
		});
		this.addChild(this.description);

		// Rarity
		this.rarity = new Text(data.getRarity().toUpperCase(), {
			x: 12,
			y: Card.HEIGHT - 60,
			style: {
				fontSize: 12,
				color: Card.getRarityColor(data.getRarity()),
				fontWeight: 'bold',
			},
		});
		this.addChild(this.rarity);

		// Tags
		const tagsStr = data.getTags().join(', ');
		this.tags = new Text(tagsStr, {
			x: 12,
			y: Card.HEIGHT - 35,
			width: Card.WIDTH - 24,
			style: {
				fontSize: 10,
				color: '#888888',
				textOverflow: 'ellipsis',
				whiteSpace: 'nowrap',
			},
		});
		this.addChild(this.tags);

		// Target type
		const targetText = new Text(data.getTargetType(), {
			x: 12,
			y: Card.HEIGHT - 20,
			style: {
				fontSize: 10,
				color: '#666666',
			},
		});
		this.addChild(targetText);

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
		this.cardBorder.setFillColor(this.adjustBrightness(Card.getRarityColor(this.data.getRarity()), -20));
	}

	/**
	 * Handle mouse up
	 */
	private handleMouseUp(): void {
		if (!this.enabled) return;
		
		// Reset visual
		this.cardBorder.setFillColor(Card.getRarityColor(this.data.getRarity()));
		
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
	public setOnClick(handler: (card: CardData) => void): void {
		this.clickHandler = handler;
	}

	/**
	 * Set semantic event handlers
	 */
	public setOnSelect(handler: (card: CardData) => void): void {
		this.selectHandler = handler;
	}

	public setOnActivate(handler: (card: CardData) => void): void {
		this.activateHandler = handler;
	}

	public setOnTarget(handler: (card: CardData) => void): void {
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
	public getData(): CardData {
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
	 * Get standard card dimensions
	 */
	public static getDimensions(): { width: number; height: number } {
		return {
			width: Card.WIDTH,
			height: Card.HEIGHT,
		};
	}
}