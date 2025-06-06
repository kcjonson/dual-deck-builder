import { Layer } from '../../../engine/components/Layer';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Button } from '../../../engine/ui/Button';
import { Driver } from '../../mechanics/Driver';
import { Card as UICard, CardSize } from '../../../engine/ui/Card';
import { CardLoader } from '../../core/CardLoader';

/**
 * Driver selection panel for the Driver Selection Screen
 * Implements the left/right panel layout from Game Flow Spec 1.2
 */
export class DriverPanel extends Layer {
	private panelSide: 'left' | 'right';
	private isEmpty = true;
	private selectedDriver: Driver | null = null;
	private availableDrivers: Driver[] = [];
	private currentDriverIndex = 0;
	
	// UI elements
	private background: Rectangle;
	private emptyStateText: Text | null = null;
	private portraitArea: Rectangle | null = null;
	private driverName: Text | null = null;
	private vehicleName: Text | null = null;
	private specialtyTag: Text | null = null;
	private flavorText: Text | null = null;
	private startingDeckContainer: Layer | null = null;
	private driverSelector: Button | null = null;
	private miniCards: UICard[] = [];
	
	// Callbacks
	private onDriverChanged: ((driver: Driver | null) => void) | null = null;

	/**
	 * Create a new driver panel
	 */
	constructor(side: 'left' | 'right', options: { x: number; y: number; width: number; height: number }) {
		super(options);
		
		this.panelSide = side;
		
		// Create background
		this.background = new Rectangle({
			x: 0,
			y: 0,
			width: this.getWidth(),
			height: this.getHeight(),
			style: {
				backgroundColor: '#3a3a5a',
				borderColor: '#5a5a7a',
				borderWidth: 2,
			},
		});
		this.addChild(this.background);
		
		this.createEmptyState();
	}

	/**
	 * Set available drivers for selection
	 */
	public setAvailableDrivers(drivers: Driver[]): void {
		this.availableDrivers = drivers;
		if (drivers.length > 0 && this.panelSide === 'left') {
			// Left panel can be activated immediately
			this.setDriverIndex(0);
		}
	}

	/**
	 * Activate this panel for driver selection
	 */
	public activate(): void {
		if (this.availableDrivers.length === 0) return;
		
		this.isEmpty = false;
		this.clearPanelContents();
		this.createDriverDisplay();
		this.setDriverIndex(this.currentDriverIndex);
	}

	/**
	 * Set the selected driver by index
	 */
	public setDriverIndex(index: number): void {
		if (index < 0 || index >= this.availableDrivers.length) return;
		
		this.currentDriverIndex = index;
		this.selectedDriver = this.availableDrivers[index];
		
		if (!this.isEmpty) {
			this.updateDriverDisplay();
		}
		
		if (this.onDriverChanged) {
			this.onDriverChanged(this.selectedDriver);
		}
	}

	/**
	 * Get the currently selected driver
	 */
	public getSelectedDriver(): Driver | null {
		return this.selectedDriver;
	}

	/**
	 * Set callback for when driver selection changes
	 */
	public setOnDriverChanged(callback: (driver: Driver | null) => void): void {
		this.onDriverChanged = callback;
	}

	/**
	 * Check if this panel is empty
	 */
	public getIsEmpty(): boolean {
		return this.isEmpty;
	}

	/**
	 * Create the empty state display
	 */
	private createEmptyState(): void {
		const emptyText = this.panelSide === 'left' 
			? 'Choose Your First Driver' 
			: 'Choose Your Second Driver';
			
		this.emptyStateText = new Text(emptyText, {
			style: {
				fontSize: 24,
				color: '#888888',
				textAlign: 'center',
			},
		});
		
		// Center in panel
		this.emptyStateText.setPosition(
			this.getWidth() / 2,
			this.getHeight() / 2
		);
		
		this.addChild(this.emptyStateText);
	}

	/**
	 * Clear panel contents except background
	 */
	public clearPanelContents(): void {
		const children = [...this.getChildren()];
		children.forEach(child => {
			if (child !== this.background) {
				this.removeChild(child);
			}
		});
		this.miniCards = [];
	}

	/**
	 * Reset panel to initial state
	 */
	public reset(): void {
		this.selectedDriver = null;
		this.currentDriverIndex = 0;
		this.isEmpty = true;
		this.clearPanelContents();
		
		// Re-add empty panel text
		const emptyText = new Text(this.panelSide === 'left' ? 'Select First Driver' : 'Select Second Driver', {
			style: {
				fontSize: 24,
				color: '#666666',
				textAlign: 'center',
			},
		});
		emptyText.setPosition(this.getWidth() / 2, this.getHeight() / 2);
		this.addChild(emptyText);
	}

	/**
	 * Create the driver display layout
	 */
	private createDriverDisplay(): void {
		const panelWidth = this.getWidth();
		const panelHeight = this.getHeight();
		
		// Portrait area (40% of panel height, not screen height)
		const portraitHeight = Math.floor(panelHeight * 0.4);
		this.portraitArea = new Rectangle({
			x: Math.floor(panelWidth * 0.05),
			y: 20,
			width: Math.floor(panelWidth * 0.9),
			height: portraitHeight,
			style: {
				backgroundColor: '#555577',
				borderColor: '#777799',
				borderWidth: 2,
			},
		});
		this.addChild(this.portraitArea);
		
		// Driver name (large, bold)
		this.driverName = new Text('', {
			style: {
				fontSize: 20,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
		});
		this.driverName.setPosition(Math.floor(panelWidth / 2), portraitHeight + 30);
		this.addChild(this.driverName);
		
		// Vehicle name (smaller)
		this.vehicleName = new Text('', {
			style: {
				fontSize: 14,
				color: '#cccccc',
				textAlign: 'center',
			},
		});
		this.vehicleName.setPosition(Math.floor(panelWidth / 2), portraitHeight + 55);
		this.addChild(this.vehicleName);
		
		// Specialty tag (2-3 words)
		this.specialtyTag = new Text('', {
			style: {
				fontSize: 16,
				color: '#ffaa00',
				textAlign: 'center',
				fontWeight: 'bold',
			},
		});
		this.specialtyTag.setPosition(Math.floor(panelWidth / 2), portraitHeight + 80);
		this.addChild(this.specialtyTag);
		
		// Flavor text
		this.flavorText = new Text('', {
			width: Math.floor(panelWidth * 0.9),
			style: {
				fontSize: 12,
				color: '#aaaaaa',
				textAlign: 'center',
				whiteSpace: 'normal',
			},
		});
		this.flavorText.setPosition(Math.floor(panelWidth * 0.05), portraitHeight + 105);
		this.addChild(this.flavorText);
		
		// Starting deck container
		this.startingDeckContainer = new Layer({
			x: Math.floor(panelWidth * 0.05),
			y: portraitHeight + 140,
			width: Math.floor(panelWidth * 0.9),
			height: Math.floor(panelHeight - portraitHeight - 220),
		});
		this.addChild(this.startingDeckContainer);
		
		// Driver selector dropdown/carousel (at very bottom as per spec)
		this.driverSelector = new Button('', {
			width: Math.floor(panelWidth * 0.8),
			height: 35,
			style: {
				fontSize: 14,
			},
		});
		this.driverSelector.setPosition(
			Math.floor(panelWidth * 0.1),
			panelHeight - 50
		);
		this.driverSelector.onClick(() => this.showDriverSelector());
		this.addChild(this.driverSelector);
	}

	/**
	 * Update the driver display with current selection
	 */
	private updateDriverDisplay(): void {
		if (!this.selectedDriver) return;
		
		// Update driver name
		if (this.driverName) {
			this.driverName.setText(this.selectedDriver.metadata.name);
		}
		
		// Update vehicle name
		if (this.vehicleName) {
			this.vehicleName.setText(`Vehicle: ${this.selectedDriver.metadata.vehicleName}`);
		}
		
		// Update specialty tag
		if (this.specialtyTag) {
			this.specialtyTag.setText(this.selectedDriver.metadata.specialty);
		}
		
		// Update flavor text
		if (this.flavorText) {
			this.flavorText.setText(this.selectedDriver.metadata.flavorText);
		}
		
		// Update starting deck display
		this.updateStartingDeckDisplay();
		
		// Update selector button text
		if (this.driverSelector) {
			this.driverSelector.setLabel(
				`${this.selectedDriver.metadata.name} (${this.currentDriverIndex + 1}/${this.availableDrivers.length})`
			);
		}
	}

	/**
	 * Update the starting deck display with mini-cards
	 */
	private async updateStartingDeckDisplay(): Promise<void> {
		if (!this.selectedDriver || !this.startingDeckContainer) return;
		
		// Clear existing contents
		const children = [...this.startingDeckContainer.getChildren()];
		children.forEach(child => {
			if (this.startingDeckContainer) {
				this.startingDeckContainer.removeChild(child);
			}
		});
		this.miniCards = [];
		
		// Add "Starting Deck:" title
		const deckTitle = new Text('Starting Deck:', {
			style: {
				fontSize: 16,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
		});
		deckTitle.setPosition(this.startingDeckContainer.getWidth() / 2, 20);
		this.startingDeckContainer.addChild(deckTitle);
		
		// Get card loader for actual card data
		const cardLoader = CardLoader.getInstance();
		if (!cardLoader.isLoaded()) {
			await cardLoader.loadCards();
		}
		
		// Create mini-cards for starting deck
		const startingDeckConfig = this.selectedDriver.startingDeck;
		const availableCards = cardLoader.getAllCardsAsMap();
		
		const cardDimensions = UICard.getDimensions(CardSize.MINI);
		const cardSpacing = 10;
		const cardsPerRow = 2;
		const containerWidth = this.startingDeckContainer.getWidth();
		const startX = Math.floor((containerWidth - (cardsPerRow * cardDimensions.width + (cardsPerRow - 1) * cardSpacing)) / 2);
		
		let cardIndex = 0;
		for (const cardConfig of startingDeckConfig.cards) {
			const cardData = availableCards.get(cardConfig.type);
			if (!cardData) continue;
			
			const row = Math.floor(cardIndex / cardsPerRow);
			const col = cardIndex % cardsPerRow;
			
			const x = startX + col * (cardDimensions.width + cardSpacing);
			const y = 40 + row * (cardDimensions.height + cardSpacing);
			
			// Create proper mini card using Card component
			const miniCard = new UICard({
				x,
				y,
				data: cardData,
				size: CardSize.MINI,
			});
			
			// Disable interaction for display purposes
			miniCard.setEnabled(false);
			
			this.startingDeckContainer.addChild(miniCard);
			
			// Quantity indicator if > 1
			if (cardConfig.quantity > 1) {
				const quantityText = new Text(`x${cardConfig.quantity}`, {
					style: {
						fontSize: 10,
						color: '#ffaa00',
						fontWeight: 'bold',
					},
				});
				quantityText.setPosition(x + cardDimensions.width - 10, y + 5);
				this.startingDeckContainer.addChild(quantityText);
			}
			
			cardIndex++;
		}
	}

	/**
	 * Show driver selector (carousel functionality)
	 */
	private showDriverSelector(): void {
		// For now, cycle to next driver
		// In a full implementation, this could show a dropdown menu
		const nextIndex = (this.currentDriverIndex + 1) % this.availableDrivers.length;
		this.setDriverIndex(nextIndex);
	}
}