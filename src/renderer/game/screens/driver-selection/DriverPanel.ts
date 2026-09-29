import { Container, ContainerOptions } from '../../../engine/components/Container';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Button } from '../../../engine/ui/Button';
import { Driver } from '../../mechanics/Driver';
import { isSameDriver, nextOpenDriverIndex } from '../../mechanics/DriverPair';
import { Card as UICard, CardSize } from '../../ui/Card';
import { CardLoader } from '../../core/CardLoader';

/** Space between the bottom of the deck preview and the selector button. */
const DECK_PREVIEW_GAP = 10;
/** Space between mini cards, across and down. */
const DECK_CARD_SPACING = 10;

/** One card of the starting deck preview, and its quantity when above one. */
interface DeckEntry {
	card: UICard;
	quantity: Text | null;
}

/**
 * Driver selection panel for the Driver Selection Screen
 * Implements the left/right panel layout from Game Flow Spec 1.2
 */
export class DriverPanel extends Container {
	private panelSide: 'left' | 'right';
	private idPrefix: string;
	private isEmpty = true;
	private selectedDriver: Driver | null = null;
	private availableDrivers: Driver[] = [];
	private currentDriverIndex = 0;
	private partner: Driver | null = null;
	
	// UI elements
	private background: Rectangle;
	private emptyStateText: Text | null = null;
	private portraitArea: Rectangle | null = null;
	private driverName: Text | null = null;
	private vehicleName: Text | null = null;
	private specialtyTag: Text | null = null;
	private flavorText: Text | null = null;
	private startingDeckContainer: Container | null = null;
	private deckTitle: Text | null = null;
	private driverSelector: Button | null = null;
	private deckEntries: DeckEntry[] = [];
	/** Bumped per preview build, so a build that awaited the card data can tell a newer one started. */
	private deckRequest = 0;
	
	// Callbacks
	private onDriverChanged: ((driver: Driver | null) => void) | null = null;

	/**
	 * Create a new driver panel. Its contents are placed from its size in the
	 * layout phase, so the screen resizes it rather than rebuilding it.
	 */
	constructor(side: 'left' | 'right', options: ContainerOptions) {
		super(options);

		this.panelSide = side;
		this.idPrefix = `driver_panel_${side}_`;

		this.background = new Rectangle({
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
			this.selectFrom(0);
		}
	}

	/**
	 * The driver the other panel holds. This panel never selects it, and moves
	 * off it if it already holds it.
	 */
	public set partnerDriver(driver: Driver | null) {
		this.partner = driver;
		if (driver && this.selectedDriver && isSameDriver(driver, this.selectedDriver)) {
			this.selectFrom(this.currentDriverIndex + 1);
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
		this.selectFrom(this.currentDriverIndex);
	}

	/**
	 * Select the first driver at or after `index` that the partner panel doesn't hold
	 */
	private selectFrom(index: number): void {
		const openIndex = nextOpenDriverIndex({
			drivers: this.availableDrivers,
			fromIndex: index,
			partner: this.partner,
		});
		if (openIndex === -1) {
			this.selectedDriver = null;
		} else {
			this.currentDriverIndex = openIndex;
			this.selectedDriver = this.availableDrivers[openIndex];
		}
		
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
			
		// Centred in the panel
		this.emptyStateText = new Text(emptyText, {
			style: {
				fontSize: 24,
				color: '#888888',
				textAlign: 'center',
			},
			verticalAlign: 'middle',
			wrap: 'none',
		});
		
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
		this.emptyStateText = null;
		this.portraitArea = null;
		this.driverName = null;
		this.vehicleName = null;
		this.specialtyTag = null;
		this.flavorText = null;
		this.startingDeckContainer = null;
		this.deckTitle = null;
		this.driverSelector = null;
		this.deckEntries = [];
		this.deckRequest += 1;
	}

	/**
	 * Reset panel to initial state
	 */
	public reset(): void {
		this.selectedDriver = null;
		this.currentDriverIndex = 0;
		this.partner = null;
		this.isEmpty = true;
		this.clearPanelContents();
		
		this.createEmptyState();
	}

	/**
	 * Create the driver display; placeContents sizes and places it
	 */
	private createDriverDisplay(): void {
		this.portraitArea = new Rectangle({
			style: {
				backgroundColor: '#555577',
				borderColor: '#777799',
				borderWidth: 2,
			},
		});
		this.addChild(this.portraitArea);

		// Driver name (large, bold); it and the two lines under it are centred across the panel
		this.driverName = new Text('', {
			id: `${this.idPrefix}driver_name`,
			style: {
				fontSize: 20,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
			wrap: 'none',
		});
		this.addChild(this.driverName);

		// Vehicle name (smaller)
		this.vehicleName = new Text('', {
			style: {
				fontSize: 14,
				color: '#cccccc',
				textAlign: 'center',
			},
			wrap: 'none',
		});
		this.addChild(this.vehicleName);

		// Specialty tag (2-3 words)
		this.specialtyTag = new Text('', {
			style: {
				fontSize: 16,
				color: '#ffaa00',
				textAlign: 'center',
				fontWeight: 'bold',
			},
			wrap: 'none',
		});
		this.addChild(this.specialtyTag);

		this.flavorText = new Text('', {
			style: {
				fontSize: 12,
				color: '#aaaaaa',
				textAlign: 'center',
			},
			wrap: 'word',
		});
		this.addChild(this.flavorText);

		// The deck preview fills the space down to the selector and clips
		// there. It is submitted before the selector, so anything it drew past
		// that line would now sit under the button rather than over it.
		this.startingDeckContainer = new Container({
			id: `${this.idPrefix}deck_preview`,
			overflow: 'hidden',
		});
		this.addChild(this.startingDeckContainer);

		// Driver selector (at the very bottom as per spec)
		this.driverSelector = new Button('', {
			id: `${this.idPrefix}cycle_button`,
			height: 35,
			style: {
				fontSize: 14,
			},
		});
		this.driverSelector.onClick = () => this.cycleDriver();
		this.addChild(this.driverSelector);

		this.placeContents();
	}

	/** The frame's layout phase: the panel was sized, or what it holds changed (R8.18). */
	protected layoutChildren(): void {
		this.placeContents();
	}

	/**
	 * Every element from the panel's size: the portrait takes 40 percent of
	 * the height, the text lines stack under it, the selector sits at the
	 * bottom, and the deck preview fills the space between.
	 */
	private placeContents(): void {
		const panelWidth = this.getWidth();
		const panelHeight = this.getHeight();

		this.background.setSize(panelWidth, panelHeight);
		this.emptyStateText?.setSize(panelWidth, panelHeight);

		const portraitHeight = Math.floor(panelHeight * 0.4);
		this.portraitArea?.setPosition(Math.floor(panelWidth * 0.05), 20);
		this.portraitArea?.setSize(Math.floor(panelWidth * 0.9), portraitHeight);

		this.driverName?.setPosition(0, portraitHeight + 30);
		this.driverName?.setWidth(panelWidth);
		this.vehicleName?.setPosition(0, portraitHeight + 55);
		this.vehicleName?.setWidth(panelWidth);
		this.specialtyTag?.setPosition(0, portraitHeight + 80);
		this.specialtyTag?.setWidth(panelWidth);
		this.flavorText?.setPosition(Math.floor(panelWidth * 0.05), portraitHeight + 105);
		this.flavorText?.setWidth(Math.floor(panelWidth * 0.9));

		const selectorY = panelHeight - 50;
		const deckY = portraitHeight + 140;
		if (this.startingDeckContainer) {
			this.startingDeckContainer.setPosition(Math.floor(panelWidth * 0.05), deckY);
			this.startingDeckContainer.setSize(Math.floor(panelWidth * 0.9), Math.max(0, selectorY - DECK_PREVIEW_GAP - deckY));
			this.placeDeck();
		}

		this.driverSelector?.setPosition(Math.floor(panelWidth * 0.1), selectorY);
		this.driverSelector?.setWidth(Math.floor(panelWidth * 0.8));
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
	 * Rebuild the starting deck preview for the selected driver. The card data
	 * may still be loading; a build that awaited it gives way to any build
	 * started since, so two quick selections never leave two decks stacked
	 * in the preview.
	 */
	private async updateStartingDeckDisplay(): Promise<void> {
		const request = ++this.deckRequest;
		const driver = this.selectedDriver;
		const container = this.startingDeckContainer;
		if (!driver || !container) return;

		const cardLoader = CardLoader.getInstance();
		if (!cardLoader.isLoaded()) {
			await cardLoader.loadCards();
		}
		if (request !== this.deckRequest) return;

		container.clearChildren();
		this.deckEntries = [];

		// Centred across the preview by placeDeck
		this.deckTitle = new Text('Starting Deck:', {
			y: 20,
			style: {
				fontSize: 16,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
			wrap: 'none',
		});
		container.addChild(this.deckTitle);

		const availableCards = cardLoader.getAllCardsAsMap();
		for (const cardConfig of driver.startingDeck.cards) {
			const cardData = availableCards.get(cardConfig.type);
			if (!cardData) continue;

			const card = new UICard({
				x: 0,
				y: 0,
				data: cardData,
				size: CardSize.MINI,
			});
			// Display only
			card.enabled = false;
			container.addChild(card);

			let quantity: Text | null = null;
			if (cardConfig.quantity > 1) {
				quantity = new Text(`x${cardConfig.quantity}`, {
					style: {
						fontSize: 10,
						color: '#ffaa00',
						fontWeight: 'bold',
					},
				});
				container.addChild(quantity);
			}
			this.deckEntries.push({ card, quantity });
		}
		this.placeDeck();
	}

	/**
	 * The mini cards hug the deck: as many to a row as the preview's width
	 * holds, centred, so a starting deck fits in one row at the reference
	 * size instead of stacking into rows that run past the selector.
	 */
	private placeDeck(): void {
		const container = this.startingDeckContainer;
		if (!container) return;
		const containerWidth = container.getWidth();
		this.deckTitle?.setWidth(containerWidth);

		const cardDimensions = UICard.getDimensions(CardSize.MINI);
		const deckSize = this.deckEntries.length;
		const fittingPerRow = Math.floor((containerWidth + DECK_CARD_SPACING) / (cardDimensions.width + DECK_CARD_SPACING));
		const cardsPerRow = Math.max(1, Math.min(deckSize, fittingPerRow));
		const startX = Math.floor((containerWidth - (cardsPerRow * cardDimensions.width + (cardsPerRow - 1) * DECK_CARD_SPACING)) / 2);

		this.deckEntries.forEach(({ card, quantity }, index) => {
			const row = Math.floor(index / cardsPerRow);
			const col = index % cardsPerRow;
			const x = startX + col * (cardDimensions.width + DECK_CARD_SPACING);
			const y = 40 + row * (cardDimensions.height + DECK_CARD_SPACING);
			card.setPosition(x, y);
			quantity?.setPosition(x + cardDimensions.width - 10, y + 5);
		});
	}

	/**
	 * Cycle to the next driver the partner panel doesn't hold (the selector button's action)
	 */
	public cycleDriver(): void {
		// In a full implementation, this could show a dropdown menu
		this.selectFrom(this.currentDriverIndex + 1);
	}
}