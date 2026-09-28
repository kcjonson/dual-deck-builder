import { Icon } from '../../../engine/components/Icon';
import { Layer, LayerOptions } from '../../../engine/components/Layer';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { tokens } from '../../../engine/theme/tokens';
import { Button } from '../../../engine/ui/Button';
import { DriverStatsDisplay, DriverResourceData } from './DriverStatsDisplay';

/**
 * The shared scrap readout: icon, symbol, amount, and label
 */
interface ScrapDisplay {
	icon: Rectangle;
	symbol: Icon;
	amount: Text;
	label: Text;
}

const END_TURN_WIDTH = 120;
const END_TURN_MARGIN = 10;
/** The scrap amount's box, centred 15 px past the icon. */
const SCRAP_AMOUNT_WIDTH = 30;

/**
 * Resource bar strip at the top of the combat screen
 * Shows both drivers' stats, shared scrap, and end turn button
 */
export class ResourceBarLayer extends Layer {
	private background: Rectangle;
	private driver1Display: DriverStatsDisplay;
	private driver2Display: DriverStatsDisplay;
	private scrap: ScrapDisplay;
	private endTurnButton: Button;

	// Callbacks
	private onEndTurn: (() => void) | null = null;

	/**
	 * Create resource bar layer
	 */
	constructor(options: LayerOptions & { x: number; y: number; width: number; height: number }) {
		super(options);

		this.background = new Rectangle({
			style: {
				backgroundColor: '#1a1a2a',
				borderColor: '#3a3a4a',
				borderWidth: 1,
			},
		});
		this.addChild(this.background);

		this.driver1Display = new DriverStatsDisplay({
			id: 'resource_driver1',
			height: this.getHeight(),
			driverNumber: 1
		});
		this.addChild(this.driver1Display);

		this.driver2Display = new DriverStatsDisplay({
			id: 'resource_driver2',
			height: this.getHeight(),
			driverNumber: 2
		});
		this.addChild(this.driver2Display);

		this.scrap = this.createScrapDisplay();
		this.endTurnButton = this.createEndTurnButton();

		this.layoutElements();
	}

	/**
	 * Create the scrap readout; layoutElements places it
	 */
	private createScrapDisplay(): ScrapDisplay {
		const icon = new Rectangle({
			style: {
				backgroundColor: '#8a6a4a',
				borderColor: '#ffffff',
				borderWidth: 1,
			},
		});
		this.addChild(icon);

		const symbol = new Icon({ glyph: 'settings', size: 0, tint: tokens.color.text_bright });
		this.addChild(symbol);

		const amount = new Text('0', {
			style: {
				fontSize: 10,
				color: '#ffffff',
				textAlign: 'center',
				whiteSpace: 'nowrap',
				fontWeight: 'bold',
			},
		});
		this.addChild(amount);

		const label = new Text('SCRAP', {
			style: {
				fontSize: 8,
				color: '#cccccc',
				textAlign: 'center',
				whiteSpace: 'nowrap',
			},
		});
		this.addChild(label);

		return { icon, symbol, amount, label };
	}

	/**
	 * Create the end turn button; layoutElements places it
	 */
	private createEndTurnButton(): Button {
		const button = new Button('END TURN', {
			id: 'end_turn_button',
			style: {
				fontSize: 12,
				fontWeight: 'bold',
			},
		});
		button.onClick(() => {
			if (this.onEndTurn) {
				this.onEndTurn();
			}
		});
		this.addChild(button);
		return button;
	}

	/**
	 * Place every element for the bar's current size. Construction and every
	 * resize go through here, so a resized bar matches one built at that size.
	 */
	private layoutElements(): void {
		const layerWidth = this.getWidth();
		const layerHeight = this.getHeight();
		const iconSize = Math.floor(layerHeight * 0.6);
		const spacing = Math.floor(layerWidth * 0.02);

		// A layer can only clip once it has a size
		if (layerWidth > 0 && layerHeight > 0) {
			this.setOverflow('hidden');
		}

		this.background.setSize(layerWidth, layerHeight);

		let currentX = spacing;
		for (const display of [this.driver1Display, this.driver2Display]) {
			// A display hugs its content, measured at this height
			display.setPosition(currentX, 0);
			display.setSize(display.getWidth(), layerHeight);
			currentX += display.getWidth() + spacing * 2;
		}

		const { icon, symbol, amount, label } = this.scrap;
		icon.setPosition(currentX, Math.floor((layerHeight - iconSize) / 2));
		icon.setSize(iconSize, iconSize);
		icon.setCornerRadius(Math.floor(iconSize / 4));
		const symbolSize = Math.floor(iconSize * 0.75);
		symbol.size = symbolSize;
		symbol.setPosition(currentX + (iconSize - symbolSize) / 2, Math.floor((layerHeight - symbolSize) / 2));
		// Centred 15 px past the icon, and under it
		amount.setPosition(currentX + iconSize, Math.floor(layerHeight / 2));
		amount.setWidth(SCRAP_AMOUNT_WIDTH);
		label.setPosition(currentX, Math.floor(layerHeight * 0.8));
		label.setWidth(iconSize);

		const buttonHeight = Math.floor(layerHeight * 0.8);
		this.endTurnButton.setSize(END_TURN_WIDTH, buttonHeight);
		this.endTurnButton.setPosition(
			layerWidth - END_TURN_WIDTH - END_TURN_MARGIN,
			Math.floor((layerHeight - buttonHeight) / 2)
		);
	}

	/**
	 * Set driver data
	 */
	public setDriverData(driverNumber: 1 | 2, data: Partial<DriverResourceData>): void {
		const display = driverNumber === 1 ? this.driver1Display : this.driver2Display;
		display.setData(data);
	}

	/**
	 * Update scrap amount
	 */
	public setScrap(amount: number): void {
		this.scrap.amount.setText(amount.toString());
	}

	/**
	 * Set end turn callback
	 */
	public setOnEndTurn(callback: () => void): void {
		this.onEndTurn = callback;
	}

	/**
	 * Handle layer resize
	 */
	protected onResized(): void {
		this.layoutElements();
	}
}
