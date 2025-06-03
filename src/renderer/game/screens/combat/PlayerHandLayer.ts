import { Layer } from '../../../engine/components/Layer';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Card as UICard, CardSize } from '../../../engine/ui/Card';
import { Card } from '../../mechanics/Card';

/**
 * Player hand layer for the bottom 20% of combat screen
 * Displays hand of cards with hover effects and drag targeting
 */
export class PlayerHandLayer extends Layer {
	private handCards: Card[] = [];
	private cardElements: UICard[] = [];
	private currentAdrenaline = 0;
	
	// Card layout settings
	private readonly CARD_SIZE = CardSize.NORMAL;
	private readonly CARD_DIMENSIONS = UICard.getDimensions(CardSize.NORMAL);
	private readonly CARD_SPACING = 10;
	private readonly HOVER_LIFT = 20;
	
	// Callbacks
	private onCardHover: ((card: Card | null) => void) | null = null;
	private onCardClick: ((card: Card) => void) | null = null;
	private onCardSelect: ((card: Card) => void) | null = null;
	
	// Selection state
	private selectedCard: Card | null = null; // The card player has selected to play (waiting for target)
	private targetingMode = false;

	/**
	 * Create player hand layer
	 */
	constructor(options: { x: number; y: number; width: number; height: number }) {
		super(options);
		
		// Hand background
		const background = new Rectangle({
			x: 0,
			y: 0,
			width: this.getWidth(),
			height: this.getHeight(),
			style: {
				backgroundColor: '#2a2a3a', // Visible hand area background
				borderColor: '#3a3a4a',
				borderWidth: 1,
			},
		});
		this.addChild(background);
	}

	/**
	 * Set the current hand of cards
	 */
	public setHand(cards: Card[]): void {
		this.handCards = cards;
		this.clearCardElements();
		this.createCardElements();
	}

	/**
	 * Set current adrenaline for card playability
	 */
	public setAdrenaline(adrenaline: number): void {
		this.currentAdrenaline = adrenaline;
		this.updateCardPlayability();
	}

	/**
	 * Add a card to the hand
	 */
	public addCard(card: Card): void {
		this.handCards.push(card);
		this.createCardElements();
	}

	/**
	 * Remove a card from the hand
	 */
	public removeCard(card: Card): void {
		const index = this.handCards.findIndex(c => c.getId() === card.getId());
		if (index >= 0) {
			this.handCards.splice(index, 1);
			this.createCardElements();
		}
	}

	/**
	 * Set card hover callback
	 */
	public setOnCardHover(callback: (card: Card | null) => void): void {
		this.onCardHover = callback;
	}

	/**
	 * Set card click callback (legacy)
	 */
	public setOnCardClick(callback: (card: Card) => void): void {
		this.onCardClick = callback;
	}

	/**
	 * Set card select callback (semantic)
	 */
	public setOnCardSelect(callback: (card: Card) => void): void {
		this.onCardSelect = callback;
	}

	/**
	 * Set card selection state
	 */
	public setCardSelected(card: Card | null): void {
		this.selectedCard = card;
		this.updateCardSelectionVisuals();
	}

	/**
	 * Get selected card
	 */
	public getSelectedCard(): Card | null {
		return this.selectedCard;
	}

	/**
	 * Set targeting mode
	 */
	public setTargetingMode(targeting: boolean): void {
		this.targetingMode = targeting;
		this.updateCardSelectionVisuals();
	}

	/**
	 * Clear card selection
	 */
	public clearCardSelection(): void {
		this.selectedCard = null;
		this.targetingMode = false;
		this.updateCardSelectionVisuals();
	}

	/**
	 * Clear all card visual elements
	 */
	private clearCardElements(): void {
		this.cardElements.forEach(cardElement => {
			this.removeChild(cardElement);
		});
		this.cardElements = [];
	}

	/**
	 * Create visual elements for all cards in hand
	 */
	private createCardElements(): void {
		this.clearCardElements();
		
		if (this.handCards.length === 0) return;

		const layerWidth = this.getWidth();
		const layerHeight = this.getHeight();
		
		// Calculate card positioning
		const totalCardWidth = this.handCards.length * this.CARD_DIMENSIONS.width + (this.handCards.length - 1) * this.CARD_SPACING;
		const startX = Math.floor((layerWidth - totalCardWidth) / 2);
		const cardY = Math.floor((layerHeight - this.CARD_DIMENSIONS.height) / 2);

		this.handCards.forEach((card, index) => {
			const x = startX + index * (this.CARD_DIMENSIONS.width + this.CARD_SPACING);
			
			const cardElement = new UICard({
				x,
				y: cardY,
				data: card,
				size: this.CARD_SIZE,
			});

			// Set up card interactivity
			this.setupCardInteractivity(cardElement, card);
			
			this.cardElements.push(cardElement);
			this.addChild(cardElement);
		});

		this.updateCardPlayability();
	}

	/**
	 * Set up mouse interactivity for a card
	 */
	private setupCardInteractivity(cardElement: UICard, card: Card): void {
		// Set up legacy click handler
		cardElement.setOnClick((_cardData) => {
			if (this.canPlayCard(card) && this.onCardClick) {
				this.onCardClick(card);
			}
		});

		// Set up semantic select handler
		cardElement.setOnSelect((_cardData) => {
			if (this.canPlayCard(card) && this.onCardSelect) {
				this.onCardSelect(card);
			}
		});
		
		// Update enabled state based on playability
		cardElement.setEnabled(this.canPlayCard(card));
	}


	/**
	 * Check if a card can be played with current adrenaline
	 */
	private canPlayCard(card: Card): boolean {
		// In single player mode with combined hand, we use combined adrenaline
		// TODO: In the future, track which driver owns which card
		return this.currentAdrenaline >= card.getCost();
	}

	/**
	 * Update visual playability of all cards
	 */
	private updateCardPlayability(): void {
		this.cardElements.forEach((cardElement, index) => {
			const card = this.handCards[index];
			const playable = this.canPlayCard(card);
			cardElement.setEnabled(playable);
		});
	}

	/**
	 * Update card selection visuals based on current state
	 */
	private updateCardSelectionVisuals(): void {
		this.cardElements.forEach((cardElement, index) => {
			const card = this.handCards[index];
			
			if (this.targetingMode) {
				// During targeting mode
				if (this.selectedCard && card.getId() === this.selectedCard.getId()) {
					// Selected card - show as selected
					cardElement.setSelected(true);
					cardElement.setEnabled(true);
				} else {
					// Other cards - disable during targeting
					cardElement.setSelected(false);
					cardElement.setEnabled(false);
				}
			} else {
				// Normal mode - clear selection, show normal playability
				cardElement.setSelected(false);
				cardElement.setEnabled(this.canPlayCard(card));
			}
		});
	}

	/**
	 * Get card at screen position
	 */
	public getCardAtPosition(x: number, y: number): Card | null {
		// Convert to local coordinates
		const localPos = this.globalToLocal(x, y);
		
		for (let i = 0; i < this.cardElements.length; i++) {
			const cardElement = this.cardElements[i];
			if (localPos.x >= cardElement.getX() && 
				localPos.x <= cardElement.getX() + cardElement.getWidth() &&
				localPos.y >= cardElement.getY() && 
				localPos.y <= cardElement.getY() + cardElement.getHeight()) {
				return this.handCards[i];
			}
		}
		
		return null;
	}

	/**
	 * Animate card to discard pile
	 */
	public animateCardToDiscard(card: Card, _discardX: number, _discardY: number): void {
		const cardIndex = this.handCards.findIndex(c => c.getId() === card.getId());
		if (cardIndex >= 0) {
			// const cardElement = this.cardElements[cardIndex]; // For future animation use
			
			// TODO: Add tween animation to move card to discard pile
			// For now, just remove it
			setTimeout(() => {
				this.removeCard(card);
			}, 300);
		}
	}

	/**
	 * Fan out cards in hand
	 */
	private fanCards(): void {
		// TODO: Implement card fanning for better visual presentation
		// This would slightly rotate and offset cards for a more natural hand look
	}

	/**
	 * Get current hand cards
	 */
	public getHandCards(): Card[] {
		return [...this.handCards];
	}

	/**
	 * Get the UI card element for a given card
	 */
	public getCardElementByCard(card: Card): UICard | null {
		const cardIndex = this.handCards.findIndex(c => c.getId() === card.getId());
		if (cardIndex >= 0 && cardIndex < this.cardElements.length) {
			return this.cardElements[cardIndex];
		}
		return null;
	}
}