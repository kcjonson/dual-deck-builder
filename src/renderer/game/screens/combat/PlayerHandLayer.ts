import { Layer } from '../../../engine/components/Layer';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Text } from '../../../engine/components/Text';
import { Card as UICard, CardSize } from '../../ui/Card';
import { Card } from '../../mechanics/Card';

/**
 * Player hand layer for the bottom 20% of combat screen
 * Displays hand of cards with hover effects and drag targeting
 */
export class PlayerHandLayer extends Layer {
	private handCards: Card[] = [];
	private cardElements: UICard[] = [];
	private currentAdrenaline = 0;
	private driverAdrenaline: Map<number, number> = new Map([[1, 0], [2, 0]]);
	
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
	private cardDriverMap: Map<string, 1 | 2> = new Map();
	
	// Driver grouping visuals
	private driverDivider: Rectangle | null = null;
	private driver1Label: Text | null = null;
	private driver2Label: Text | null = null;

	/**
	 * Create player hand layer
	 */
	constructor(options: { x: number; y: number; width: number; height: number }) {
		super(options);
		
		// Set overflow hidden to clip cards that extend beyond layer bounds
		this.setOverflow('hidden');
		
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
	 * @deprecated Use setDriverAdrenaline instead for dual-driver support
	 */
	public setAdrenaline(adrenaline: number): void {
		this.currentAdrenaline = adrenaline;
		this.updateCardPlayability();
	}
	
	/**
	 * Set adrenaline for a specific driver
	 */
	public setDriverAdrenaline(driverNumber: 1 | 2, adrenaline: number): void {
		this.driverAdrenaline.set(driverNumber, adrenaline);
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
		const index = this.handCards.findIndex(c => c.id === card.id);
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
	 * Set card driver mapping
	 */
	public setCardDriverMap(map: Map<string, 1 | 2>): void {
		this.cardDriverMap = map;
		// Re-create card elements to update driver indicators
		if (this.handCards.length > 0) {
			this.createCardElements();
		}
	}

	/**
	 * Clear all card visual elements
	 */
	private clearCardElements(): void {
		this.cardElements.forEach(cardElement => {
			// Unmount the card to unregister from InputSystem
			cardElement.unmount();
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

		this.handCards.forEach((card, _index) => {
			const driverNumber = this.cardDriverMap.get(card.id) || null;
			const cardElement = new UICard({
				x: 0, // Will be positioned by layoutCardElements
				y: 0,
				data: card,
				size: this.CARD_SIZE,
				driverNumber: driverNumber,
			});

			// Set up card interactivity
			this.setupCardInteractivity(cardElement, card);
			
			this.cardElements.push(cardElement);
			this.addChild(cardElement);
		});
		
		// Layout the newly created cards
		this.layoutCardElements();

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
		cardElement.enabled = this.canPlayCard(card);
	}


	/**
	 * Check if a card can be played with current adrenaline
	 */
	private canPlayCard(card: Card): boolean {
		// Check which driver owns this card
		const driverNumber = this.cardDriverMap.get(card.id);
		if (!driverNumber) {
			// Fallback to old behavior if no driver mapping
			return this.currentAdrenaline >= card.cost;
		}
		
		// Check the specific driver's adrenaline
		const driverAdrenaline = this.driverAdrenaline.get(driverNumber) || 0;
		return driverAdrenaline >= card.cost;
	}

	/**
	 * Update visual playability of all cards
	 */
	private updateCardPlayability(): void {
		this.cardElements.forEach((cardElement, index) => {
			const card = this.handCards[index];
			const playable = this.canPlayCard(card);
			cardElement.enabled = playable;
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
				if (this.selectedCard && card.id === this.selectedCard.id) {
					// Selected card - show as selected
					cardElement.setSelected(true);
					cardElement.enabled = true;
				} else {
					// Other cards - disable during targeting
					cardElement.setSelected(false);
					cardElement.enabled = false;
				}
			} else {
				// Normal mode - clear selection, show normal playability
				cardElement.setSelected(false);
				cardElement.enabled = this.canPlayCard(card);
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
		const cardIndex = this.handCards.findIndex(c => c.id === card.id);
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
		const cardIndex = this.handCards.findIndex(c => c.id === card.id);
		if (cardIndex >= 0 && cardIndex < this.cardElements.length) {
			return this.cardElements[cardIndex];
		}
		return null;
	}
	
	/**
	 * Handle layer resize
	 */
	protected onResized(): void {
		// Update background size
		const background = this.children[0] as Rectangle;
		if (background) {
			background.setWidth(this.getWidth());
			background.setHeight(this.getHeight());
		}
		
		// Re-layout existing cards without recreating them
		this.layoutCardElements();
	}

	/**
	 * Layout existing card elements without recreating them
	 */
	private layoutCardElements(): void {
		if (this.cardElements.length === 0) return;
		
		const layerWidth = this.getWidth();
		const layerHeight = this.getHeight();
		
		// Group cards by driver
		const driver1Cards: { card: UICard; index: number }[] = [];
		const driver2Cards: { card: UICard; index: number }[] = [];
		
		this.cardElements.forEach((cardElement, index) => {
			const card = this.handCards[index];
			const driverNumber = this.cardDriverMap.get(card.id);
			if (driverNumber === 1) {
				driver1Cards.push({ card: cardElement, index });
			} else if (driverNumber === 2) {
				driver2Cards.push({ card: cardElement, index });
			}
		});
		
		// Calculate positions
		const verticalPadding = 10;
		const dividerWidth = 2;
		const dividerGap = 20;
		const labelHeight = 15;
		
		// Calculate total width needed
		const driver1Width = driver1Cards.length > 0 ? 
			driver1Cards.length * this.CARD_DIMENSIONS.width + (driver1Cards.length - 1) * this.CARD_SPACING : 0;
		const driver2Width = driver2Cards.length > 0 ? 
			driver2Cards.length * this.CARD_DIMENSIONS.width + (driver2Cards.length - 1) * this.CARD_SPACING : 0;
		const totalWidth = driver1Width + (driver1Cards.length > 0 && driver2Cards.length > 0 ? dividerGap : 0) + driver2Width;
		
		const startX = Math.floor((layerWidth - totalWidth) / 2);
		const cardY = verticalPadding + labelHeight;
		
		// Remove old divider and labels
		if (this.driverDivider) {
			this.removeChild(this.driverDivider);
			this.driverDivider = null;
		}
		if (this.driver1Label) {
			this.removeChild(this.driver1Label);
			this.driver1Label = null;
		}
		if (this.driver2Label) {
			this.removeChild(this.driver2Label);
			this.driver2Label = null;
		}
		
		// Create divider first but don't add it yet
		let divider: Rectangle | null = null;
		if (driver1Cards.length > 0 && driver2Cards.length > 0) {
			const dividerX = startX + driver1Width + dividerGap / 2 - dividerWidth / 2;
			divider = new Rectangle({
				x: dividerX,
				y: verticalPadding,
				width: dividerWidth,
				height: layerHeight - verticalPadding * 2,
				style: {
					backgroundColor: '#4a4a5a',
				},
			});
		}
		
		// Add divider first so it appears behind cards
		if (divider) {
			this.driverDivider = divider;
			this.addChild(this.driverDivider);
		}
		
		// Layout driver 1 cards
		let currentX = startX;
		driver1Cards.forEach(({ card }, i) => {
			const x = currentX + i * (this.CARD_DIMENSIONS.width + this.CARD_SPACING);
			card.setPosition(x, cardY);
		});
		
		// Add driver 1 label
		if (driver1Cards.length > 0) {
			this.driver1Label = new Text('Driver 1', {
				style: {
					fontSize: 10,
					color: '#8a8aff',
					textAlign: 'center',
				},
			});
			this.driver1Label.setPosition(startX + driver1Width / 2, verticalPadding);
			this.addChild(this.driver1Label);
		}
		
		// Layout driver 2 cards
		currentX = startX + driver1Width + (driver1Cards.length > 0 && driver2Cards.length > 0 ? dividerGap : 0);
		driver2Cards.forEach(({ card }, i) => {
			const x = currentX + i * (this.CARD_DIMENSIONS.width + this.CARD_SPACING);
			card.setPosition(x, cardY);
		});
		
		// Add driver 2 label
		if (driver2Cards.length > 0) {
			this.driver2Label = new Text('Driver 2', {
				style: {
					fontSize: 10,
					color: '#88ff88',
					textAlign: 'center',
				},
			});
			this.driver2Label.setPosition(currentX + driver2Width / 2, verticalPadding);
			this.addChild(this.driver2Label);
		}
	}
}