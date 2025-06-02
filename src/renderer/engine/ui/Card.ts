import { Component } from '../components/Component';
import { Layer } from '../components/Layer';
import { Text } from '../components/Text';
import { Rectangle } from '../components/Rectangle';
import { RenderContext } from '../rendering/RenderContext';
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
		const cardBorder = new Rectangle({
			x: 0,
			y: 0,
			width: Card.WIDTH,
			height: Card.HEIGHT,
			style: {
				backgroundColor: Card.getRarityColor(data.getRarity()),
				borderRadius: 8,
			},
		});
		this.addChild(cardBorder);

		// Create card background
		const cardBackground = new Rectangle({
			x: 4,
			y: 4,
			width: Card.WIDTH - 8,
			height: Card.HEIGHT - 8,
			style: {
				backgroundColor: '#2a2a3a',
				borderRadius: 6,
			},
		});
		this.addChild(cardBackground);

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