import { Screen } from '../../core/Screen';
import { Renderer } from '../../../engine/rendering/Renderer';
import { Button } from '../../../engine/ui/Button';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Panel } from '../../../engine/ui/Panel';
import { Card } from '../../../engine/ui/Card';
import { CardLoader } from '../../core/CardLoader';
import { Card as GameCard } from '../../mechanics/Card';

/**
 * Screen for showcasing all available cards
 */
export class CardShowcaseScreen extends Screen {
	private title: Text;
	private backButton: Button;
	private onBack: (() => void) | null = null;
	private cardsPanel: Panel;
	private cardLoader: CardLoader;

	constructor(renderer: Renderer) {
		super('cardShowcaseScreen', renderer);

		this.cardLoader = CardLoader.getInstance();

		// Create background
		const background = new Rectangle({
			x: 0,
			y: 0,
			width: this.rootLayer.getWidth(),
			height: this.rootLayer.getHeight(),
			style: {
				backgroundColor: '#1a1a33',
			},
		});
		this.rootLayer.addChild(background);

		// Create title
		this.title = new Text('Card Showcase', {
			x: 50,
			y: 30,
			style: {
				fontSize: 32,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		this.rootLayer.addChild(this.title);

		// Create back button
		this.backButton = new Button('Back to Main Menu', {
			x: 50,
			y: this.rootLayer.getHeight() - 80,
			width: 200,
			height: 50,
			style: {
				backgroundColor: '#444444',
				color: '#ffffff',
			},
		});
		this.backButton.onClick(() => {
			if (this.onBack) {
				this.onBack();
			}
		});
		this.rootLayer.addChild(this.backButton);

		// Create main scrollable container that holds all content
		this.cardsPanel = new Panel({
			width: this.rootLayer.getWidth(),
			height: this.rootLayer.getHeight() - 160, // Leave space for title (80) and back button (80)
			scrollable: true,
			scrollDirection: 'vertical',
			overflow: 'hidden',
			style: {
				backgroundColor: '#1a1a33', // Match the background
			},
		});
		this.cardsPanel.setPosition(0, 80); // Position below title
		this.rootLayer.addChild(this.cardsPanel);

		// Load and display cards
		this.loadCards();
	}

	/**
	 * Load cards from CardLoader and display them
	 */
	private async loadCards(): Promise<void> {
		try {
			// Load cards if not already loaded
			if (!this.cardLoader.isLoaded()) {
				await this.cardLoader.loadCards();
			}

			// Get all cards
			const cards = this.cardLoader.getAllCards();
			
			// Display cards in a grid
			this.displayCards(cards);
		} catch (error) {
			console.error('Failed to load cards:', error);
			
			// Display error message
			const errorText = new Text('Failed to load cards. Check console for details.', {
				x: 20,
				y: 50,
				style: {
					fontSize: 18,
					color: '#ff6666',
				},
			});
			this.cardsPanel.addChild(errorText);
		}
	}

	/**
	 * Display cards in a grid layout
	 */
	private displayCards(cards: GameCard[]): void {
		const cardDimensions = Card.getDimensions();
		const margin = 20;
		const cardSpacing = 20;
		const availableWidth = this.cardsPanel.getWidth() - (margin * 2);
		const cardsPerRow = Math.floor(availableWidth / (cardDimensions.width + cardSpacing));

		let currentX = margin;
		let currentY = margin;
		let cardsInCurrentRow = 0;

		// Add section title
		const sectionTitle = new Text(`All Cards (${cards.length} total)`, {
			x: margin,
			y: currentY,
			style: {
				fontSize: 20,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		this.cardsPanel.addChild(sectionTitle);
		currentY += 40;

		// Display each card
		for (const gameCard of cards) {
			const cardComponent = new Card({
				x: currentX,
				y: currentY,
				data: gameCard,
			});

			this.cardsPanel.addChild(cardComponent);

			// Move to next position
			currentX += cardDimensions.width + cardSpacing;
			cardsInCurrentRow++;

			// Check if we need to move to next row
			if (cardsInCurrentRow >= cardsPerRow) {
				currentX = margin;
				currentY += cardDimensions.height + cardSpacing;
				cardsInCurrentRow = 0;
			}
		}

		// Add spacing for rarity sections
		currentY += cardDimensions.height + 40;

		// Display cards by rarity
		this.displayCardsByRarity(cards, currentY);

		// Set content size for scrolling
		const contentHeight = currentY + (cardDimensions.height * 5) + 100; // Rough estimate
		this.cardsPanel.setContentSize(this.rootLayer.getWidth(), contentHeight);
	}

	/**
	 * Display cards organized by rarity
	 */
	private displayCardsByRarity(cards: GameCard[], startY: number): void {
		const rarities = ['starter', 'common', 'uncommon', 'rare', 'legendary'];
		const cardDimensions = Card.getDimensions();
		const margin = 20;
		const cardSpacing = 20;
		const availableWidth = this.cardsPanel.getWidth() - (margin * 2);
		const cardsPerRow = Math.floor(availableWidth / (cardDimensions.width + cardSpacing));
		
		let currentY = startY;

		for (const rarity of rarities) {
			const rarityCards = cards.filter(card => card.getRarity() === rarity);
			
			if (rarityCards.length === 0) continue;

			// Rarity section title
			const rarityTitle = new Text(`${rarity.toUpperCase()} (${rarityCards.length})`, {
				x: margin,
				y: currentY,
				style: {
					fontSize: 18,
					color: this.getRarityColor(rarity),
					fontWeight: 'bold',
				},
			});
			this.cardsPanel.addChild(rarityTitle);
			currentY += 30;

			// Display cards for this rarity
			let currentX = margin;
			let cardsInCurrentRow = 0;

			for (const gameCard of rarityCards) {
				const cardComponent = new Card({
					x: currentX,
					y: currentY,
					data: gameCard,
				});

				this.cardsPanel.addChild(cardComponent);

				// Move to next position
				currentX += cardDimensions.width + cardSpacing;
				cardsInCurrentRow++;

				// Check if we need to move to next row
				if (cardsInCurrentRow >= cardsPerRow) {
					currentX = margin;
					currentY += cardDimensions.height + cardSpacing;
					cardsInCurrentRow = 0;
				}
			}

			// Move to next rarity section
			if (cardsInCurrentRow > 0) {
				currentY += cardDimensions.height + cardSpacing;
			}
			currentY += 20; // Extra spacing between rarity sections
		}
	}

	/**
	 * Get color for rarity text
	 */
	private getRarityColor(rarity: string): string {
		switch (rarity) {
			case 'starter': return '#666666';
			case 'common': return '#ffffff';
			case 'uncommon': return '#00aa00';
			case 'rare': return '#0088ff';
			case 'legendary': return '#ff8800';
			default: return '#ffffff';
		}
	}

	/**
	 * Set the back button callback
	 */
	public setOnBack(callback: () => void): void {
		this.onBack = callback;
	}

	/**
	 * Handle screen mount
	 */
	protected onMount(): void {
		// Reload cards when screen is mounted in case they changed
		this.loadCards();
	}

	/**
	 * Handle screen unmount
	 */
	protected onUnmount(): void {
		// Nothing to clean up
	}

	/**
	 * Update the screen
	 */
	public onUpdate(_dt: number): void {
		// Handle any updates
	}

	/**
	 * Render the screen
	 */
	public onRender(): void {
		this.rootLayer.render();
	}

	/**
	 * Handle window resize
	 */
	protected onResized(): void {
		// Update background size if needed
		const background = this.rootLayer.getChildren()[0];
		if (background instanceof Rectangle) {
			background.setSize(this.rootLayer.getWidth(), this.rootLayer.getHeight());
		}

		// Force layout update on all children
		this.rootLayer.layout();

		// Update panel size
		if (this.cardsPanel) {
			this.cardsPanel.setSize(
				this.rootLayer.getWidth(),
				this.rootLayer.getHeight() - 160
			);
		}

		// Reposition fixed elements
		if (this.backButton) {
			this.backButton.setPosition(50, this.rootLayer.getHeight() - 80);
		}
	}
}