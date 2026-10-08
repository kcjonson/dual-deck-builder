import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { Select } from '../../../engine/ui/Select';
import type { Card as GameCard } from '../../mechanics/Card';
import { Driver } from '../../mechanics/Driver';
import { isSameDriver, nextOpenDriverIndex } from '../../mechanics/DriverPair';
import { Card as UICard, CardSize, MINI_GRID, miniGridHeight } from '../../ui/Card';
import { CardLoader } from '../../core/CardLoader';
import { FlowWrap } from '../../ui/FlowWrap';
import { contains } from '../../../engine/services/OverlayService';
import { inspectOnContextMenu, makeInspectable } from '../../ui/cardInspect';

export type DriverPanelSide = 'left' | 'right';

export interface DriverPanelOptions extends StackOptions {
	side: DriverPanelSide;
}

/**
 * Every deck takes two rows' height, the most an unlocked driver's starting
 * deck needs from 1024 wide up, so both decks take the same height for any
 * pair: a four-card deck beside a six-card one would otherwise put one
 * panel's portrait and name a row higher than the other's. The flavour text
 * can still run a line longer for one driver and move that panel's name;
 * load out (DDB-320) replaces this screen.
 */
const DECK_ROWS = 2;
/** The least the scrolling part shrinks to: a mini card and its ink, so it never closes up. */
const BODY_MIN_HEIGHT = UICard.getDimensions(CardSize.MINI).height + MINI_GRID.margin * 2;
/**
 * The portrait is a placeholder and gives way first, down to a sliver, so
 * the decks' two rows fit at 1280x720 without scrolling.
 */
const PORTRAIT_MIN_HEIGHT = 8;

/**
 * Driver selection panel for the Driver Selection Screen
 * Implements the left/right panel layout from Game Flow Spec 1.2
 *
 * A column: the portrait, the name, vehicle and specialty lines, then a
 * scroll container holding the flavour text and the starting deck, and the
 * driver Select at the bottom. The scroll container hugs its content and the
 * portrait takes what is left, so a tall window grows the portrait and a
 * short one shrinks it first, then the scroll container, which scrolls
 * whatever no longer fits (DDB-31). Built once; a resize only lays it out
 * again.
 */
export class DriverPanel extends Stack {
	private readonly panelSide: DriverPanelSide;
	private readonly idPrefix: string;
	private empty = true;
	private chosenDriver: Driver | null = null;
	private drivers: Driver[] = [];
	private currentDriverIndex = 0;
	private partner: Driver | null = null;

	// UI elements
	private readonly emptyStateText: Text;
	private readonly details: Stack;
	private readonly driverName: Text;
	private readonly vehicleName: Text;
	private readonly specialtyTag: Text;
	private readonly flavorText: Text;
	private readonly deckScroll: ScrollContainer;
	private readonly deckGrid: FlowWrap;
	private readonly driverSelect: Select;
	/** Bumped per preview build, so a build that awaited the card data can tell a newer one started. */
	private deckRequest = 0;

	/** After the selected driver changes, with the new one (R8.25). */
	public onDriverChanged: ((driver: Driver | null) => void) | null = null;

	constructor({ side, ...options }: DriverPanelOptions) {
		super({
			direction: 'vertical',
			padding: 16,
			crossAlign: 'stretch',
			style: {
				backgroundColor: '#3a3a5a',
				borderColor: '#5a5a7a',
				borderWidth: 2,
			},
			...options,
		});

		this.panelSide = side;
		this.idPrefix = `driver_panel_${side}_`;

		this.emptyStateText = new Text({
			text: side === 'left' ? 'Choose Your First Driver' : 'Choose Your Second Driver',
			widthMode: 'fill',
			heightMode: 'fill',
			style: {
				fontSize: 24,
				color: '#888888',
				textAlign: 'center',
			},
			verticalAlign: 'middle',
			wrap: 'word',
		});
		this.addChild(this.emptyStateText);

		this.details = new Stack({
			visible: false,
			direction: 'vertical',
			gap: 6,
			crossAlign: 'stretch',
			widthMode: 'fill',
			heightMode: 'fill',
		});
		this.addChild(this.details);

		// The portrait takes whatever height the rest leaves
		this.details.addChild(new Rectangle({
			widthMode: 'fill',
			heightMode: 'fill',
			minSize: { height: PORTRAIT_MIN_HEIGHT },
			margin: { bottom: 6 },
			style: {
				backgroundColor: '#555577',
				borderColor: '#777799',
				borderWidth: 2,
			},
		}));

		// The name, vehicle and specialty are centred across the panel
		this.driverName = this.addLine(this.details, new Text({
			text: '',
			id: `${this.idPrefix}driver_name`,
			style: {
				fontSize: 20,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
			wrap: 'none',
			textOverflow: 'ellipsis',
		}));
		this.vehicleName = this.addLine(this.details, new Text({
			text: '',
			style: {
				fontSize: 14,
				color: '#cccccc',
				textAlign: 'center',
			},
			wrap: 'none',
			textOverflow: 'ellipsis',
		}));
		this.specialtyTag = this.addLine(this.details, new Text({
			text: '',
			style: {
				fontSize: 16,
				color: '#ffaa00',
				textAlign: 'center',
				fontWeight: 'bold',
			},
			wrap: 'none',
			textOverflow: 'ellipsis',
		}));

		// The flavour text and the starting deck scroll together once the
		// panel is too short for them (DDB-31); the mini cards flow in rows
		// across its width.
		this.deckScroll = new ScrollContainer({
			id: `${this.idPrefix}deck_preview`,
			widthMode: 'fill',
			heightMode: 'hug',
			minSize: { height: BODY_MIN_HEIGHT },
		});
		const body = new Stack({
			direction: 'vertical',
			gap: 6,
			crossAlign: 'stretch',
		});
		this.deckScroll.addChild(body);
		this.details.addChild(this.deckScroll);

		this.flavorText = this.addLine(body, new Text({
			text: '',
			style: {
				fontSize: 12,
				color: '#aaaaaa',
				textAlign: 'center',
			},
			wrap: 'word',
		}));
		this.addLine(body, new Text({
			text: 'Starting Deck:',
			margin: { top: 4 },
			style: {
				fontSize: 16,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
			wrap: 'none',
		}));
		this.deckGrid = new FlowWrap({
			id: `${this.idPrefix}deck_cards`,
			// The cards' hexes and stacks draw past their boxes; the margin keeps
			// that ink inside the scroller's clip
			margin: MINI_GRID.margin,
			gap: MINI_GRID.gap,
			minSize: { height: miniGridHeight(DECK_ROWS) },
			justify: 'center',
			// R9.29: one Tab stop for the whole deck, the arrows walking its cards
			focusGroup: { orientation: 'horizontal' },
		});
		body.addChild(this.deckGrid);
		inspectOnContextMenu(this.deckGrid);

		// The driver choice, at the very bottom as the spec places it
		this.driverSelect = new Select({
			id: `${this.idPrefix}driver_select`,
			widthMode: 'fill',
			margin: { top: 6 },
			placeholder: 'Choose a driver',
			onChange: (archetype) => this.selectDriver(archetype),
		});
		this.details.addChild(this.driverSelect);
	}

	private addLine(column: Stack, text: Text): Text {
		column.addChild(text);
		return text;
	}

	/** The drivers the panel offers. */
	public get availableDrivers(): Driver[] {
		return this.drivers;
	}

	public set availableDrivers(drivers: Driver[]) {
		this.drivers = drivers;
		this.refreshOptions();
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
		this.refreshOptions();
		if (driver && this.chosenDriver && isSameDriver(driver, this.chosenDriver)) {
			this.selectFrom(this.currentDriverIndex + 1);
		}
	}

	/**
	 * Activate this panel for driver selection
	 */
	public activate(): void {
		if (this.drivers.length === 0) return;

		this.empty = false;
		this.emptyStateText.visible = false;
		this.details.visible = true;
		this.selectFrom(this.currentDriverIndex);
	}

	/**
	 * A pick from the Select, by archetype. The partner's driver is offered
	 * disabled, so it never arrives here, but a pick of it would still move
	 * on to the next open driver rather than share one.
	 */
	public selectDriver(archetype: string): void {
		const index = this.drivers.findIndex((driver) => driver.archetype === archetype);
		if (index !== -1) this.selectFrom(index);
	}

	/**
	 * Select the first driver at or after `index` that the partner panel doesn't hold
	 */
	private selectFrom(index: number): void {
		const openIndex = nextOpenDriverIndex({
			drivers: this.drivers,
			fromIndex: index,
			partner: this.partner,
		});
		if (openIndex === -1) {
			this.chosenDriver = null;
		} else {
			this.currentDriverIndex = openIndex;
			this.chosenDriver = this.drivers[openIndex];
		}

		if (!this.empty) {
			this.updateDriverDisplay();
		}

		if (this.onDriverChanged) {
			this.onDriverChanged(this.chosenDriver);
		}
	}

	/** The currently selected driver. */
	public get selectedDriver(): Driver | null {
		return this.chosenDriver;
	}

	/** The driver Select at the panel's foot. */
	public get select(): Select {
		return this.driverSelect;
	}

	/** The scroll container holding the flavour text and the starting deck. */
	public get deckPreview(): ScrollContainer {
		return this.deckScroll;
	}

	/** Whether the panel has not been activated yet. */
	public get isEmpty(): boolean {
		return this.empty;
	}

	/**
	 * Reset panel to initial state
	 */
	public reset(): void {
		this.chosenDriver = null;
		this.currentDriverIndex = 0;
		this.partner = null;
		this.empty = true;
		this.deckRequest += 1;
		this.clearDeck();
		this.deckScroll.scrollToTop();
		this.driverSelect.value = null;
		this.refreshOptions();
		this.details.visible = false;
		this.emptyStateText.visible = true;
	}

	/** Every driver, the partner's offered but disabled. */
	private refreshOptions(): void {
		const partner = this.partner;
		this.driverSelect.options = this.drivers.map((driver) => ({
			label: driver.metadata.name,
			value: driver.archetype,
			enabled: !partner || !isSameDriver(driver, partner),
		}));
	}

	/**
	 * Update the driver display with current selection
	 */
	private updateDriverDisplay(): void {
		const driver = this.chosenDriver;
		if (!driver) return;

		this.driverName.text = driver.metadata.name;
		this.vehicleName.text = `Vehicle: ${driver.metadata.vehicleName}`;
		this.specialtyTag.text = driver.metadata.specialty;
		this.flavorText.text = driver.metadata.flavorText;
		this.driverSelect.value = driver.archetype;

		this.updateStartingDeckDisplay();
	}

	/**
	 * Rebuild the starting deck preview for the selected driver. The card data
	 * may still be loading; a build that awaited it gives way to any build
	 * started since, so two quick selections never leave two decks in the
	 * preview.
	 */
	private async updateStartingDeckDisplay(): Promise<void> {
		const request = ++this.deckRequest;
		const driver = this.chosenDriver;
		if (!driver) return;

		const cardLoader = CardLoader.getInstance();
		if (!cardLoader.isLoaded()) {
			await cardLoader.loadCards();
		}
		if (request !== this.deckRequest) return;

		this.clearDeck();
		this.deckScroll.scrollToTop();

		const availableCards = cardLoader.getAllCardsAsMap();
		for (const cardConfig of driver.startingDeck.cards) {
			const cardData = availableCards.get(cardConfig.type);
			// A card the data lacks, or an entry of none, shows nothing
			if (!cardData || cardConfig.quantity < 1) continue;
			this.deckGrid.addChild(this.createDeckCard(cardData, cardConfig.quantity));
		}
	}

	/** Empties the deck, taking down a preview still open on one of the cards going. */
	private clearDeck(): void {
		const tooltips = this.deckGrid.context?.tooltips;
		if (tooltips?.owner && contains(this.deckGrid, tooltips.owner)) tooltips.hide();
		this.deckGrid.clearChildren();
	}

	/**
	 * A mini card, stacked with its count when the deck holds more than one
	 * copy (Game Flow 7.0). Hovering or focusing it opens the detail view
	 * the hand shows (Game Flow Spec 1.2); it has no click.
	 */
	private createDeckCard(data: GameCard, copies: number): UICard {
		const card = new UICard({ x: 0, y: 0, data, size: CardSize.MINI, copies });
		card.focusable = true;
		makeInspectable(card);
		return card;
	}
}
