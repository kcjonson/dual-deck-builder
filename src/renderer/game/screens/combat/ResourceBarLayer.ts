import { Layer } from '../../../engine/components/Layer';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Button } from '../../../engine/ui/Button';
import { DriverStatsDisplay, DriverResourceData } from './DriverStatsDisplay';

/**
 * Resource bar layer for the bottom 5% of combat screen
 * Shows both drivers' stats, shared scrap, and end turn button
 */
export class ResourceBarLayer extends Layer {
	// Driver displays
	private driver1Display: DriverStatsDisplay | null = null;
	private driver2Display: DriverStatsDisplay | null = null;
	
	// Shared UI elements
	private scrapIcon: Rectangle | null = null;
	private scrapText: Text | null = null;
	private endTurnButton: Button | null = null;

	// Shared resource values
	private scrapAmount = 0;

	// Callbacks
	private onEndTurn: (() => void) | null = null;

	/**
	 * Create resource bar layer
	 */
	constructor(options: { x: number; y: number; width: number; height: number }) {
		super(options);
		
		// Background bar
		const background = new Rectangle({
			x: 0,
			y: 0,
			width: this.getWidth(),
			height: this.getHeight(),
			style: {
				backgroundColor: '#1a1a2a',
				borderColor: '#3a3a4a',
				borderWidth: 1,
			},
		});
		this.addChild(background);

		this.createResourceElements();
	}

	/**
	 * Create all resource display elements
	 */
	private createResourceElements(): void {
		const layerWidth = this.getWidth();
		const layerHeight = this.getHeight();
		const iconSize = Math.floor(layerHeight * 0.6);
		const spacing = Math.floor(layerWidth * 0.02);
		
		let currentX = spacing;

		// Driver 1 display
		const driver1Width = DriverStatsDisplay.getRequiredWidth();
		this.driver1Display = new DriverStatsDisplay({
			x: currentX,
			y: 0,
			width: driver1Width,
			height: layerHeight,
			driverNumber: 1
		});
		this.addChild(this.driver1Display);
		currentX += driver1Width + spacing * 2;
		
		// Driver 2 display
		const driver2Width = DriverStatsDisplay.getRequiredWidth();
		this.driver2Display = new DriverStatsDisplay({
			x: currentX,
			y: 0,
			width: driver2Width,
			height: layerHeight,
			driverNumber: 2
		});
		this.addChild(this.driver2Display);
		currentX += driver2Width + spacing * 2;

		// Scrap (shared resource)
		this.createResourceDisplay(
			currentX, iconSize, spacing,
			'#8a6a4a', 'SCRAP', '⚙',
			(icon, text) => {
				this.scrapIcon = icon;
				this.scrapText = text;
			}
		);

		// End Turn Button (on the right side)
		this.createEndTurnButton(layerWidth, layerHeight);

		// Update displays with initial values
		this.updateAllDisplays();
	}

	/**
	 * Create resource display (fuel/scrap)
	 */
	private createResourceDisplay(
		startX: number,
		iconSize: number,
		spacing: number,
		color: string,
		label: string,
		symbol: string,
		callback: (icon: Rectangle, text: Text) => void
	): number {
		// Resource icon
		const resourceIcon = new Rectangle({
			x: startX,
			y: Math.floor((this.getHeight() - iconSize) / 2),
			width: iconSize,
			height: iconSize,
			style: {
				backgroundColor: color,
				borderColor: '#ffffff',
				borderWidth: 1,
				borderRadius: Math.floor(iconSize / 4),
			},
		});
		this.addChild(resourceIcon);

		// Symbol text on icon
		const symbolText = new Text(symbol, {
			style: {
				fontSize: Math.floor(iconSize * 0.6),
				color: '#ffffff',
				textAlign: 'center',
			},
		});
		symbolText.setPosition(startX + iconSize / 2, Math.floor(this.getHeight() / 2));
		this.addChild(symbolText);

		// Amount text
		const amountText = new Text('0', {
			style: {
				fontSize: 10,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
		});
		amountText.setPosition(startX + iconSize + 15, Math.floor(this.getHeight() / 2));
		this.addChild(amountText);

		// Label
		const labelText = new Text(label, {
			style: {
				fontSize: 8,
				color: '#cccccc',
				textAlign: 'center',
			},
		});
		labelText.setPosition(startX + iconSize / 2, Math.floor(this.getHeight() * 0.8));
		this.addChild(labelText);

		callback(resourceIcon, amountText);
		return startX + iconSize + 35 + spacing;
	}

	/**
	 * Create end turn button
	 */
	private createEndTurnButton(layerWidth: number, layerHeight: number): void {
		const buttonWidth = 120;
		const buttonHeight = Math.floor(layerHeight * 0.8);
		
		this.endTurnButton = new Button('END TURN', {
			width: buttonWidth,
			height: buttonHeight,
			style: {
				fontSize: 14,
				fontWeight: 'bold',
			},
		});
		
		this.endTurnButton.setPosition(
			layerWidth - buttonWidth - 10,
			Math.floor((layerHeight - buttonHeight) / 2)
		);
		
		this.endTurnButton.onClick(() => {
			if (this.onEndTurn) {
				this.onEndTurn();
			}
		});
		
		this.addChild(this.endTurnButton);
	}

	/**
	 * Set driver data
	 */
	public setDriverData(driverNumber: 1 | 2, data: Partial<DriverResourceData>): void {
		const display = driverNumber === 1 ? this.driver1Display : this.driver2Display;
		if (display) {
			display.setData(data);
		}
	}
	
	/**
	 * Get driver data
	 */
	public getDriverData(driverNumber: 1 | 2): DriverResourceData | null {
		const display = driverNumber === 1 ? this.driver1Display : this.driver2Display;
		return display ? display.getData() : null;
	}

	/**
	 * Update fuel amount (deprecated - use setDriverData)
	 */
	public setFuel(amount: number): void {
		// Legacy method - no longer used
		// Fuel is now tracked per driver
	}

	/**
	 * Update scrap amount
	 */
	public setScrap(amount: number): void {
		this.scrapAmount = amount;
		if (this.scrapText) {
			this.scrapText.setText(amount.toString());
		}
	}

	/**
	 * Set end turn callback
	 */
	public setOnEndTurn(callback: () => void): void {
		this.onEndTurn = callback;
	}

	/**
	 * Enable/disable end turn button
	 */
	public setEndTurnEnabled(enabled: boolean): void {
		if (this.endTurnButton) {
			this.endTurnButton.setEnabled(enabled);
			this.endTurnButton.setFillColor(enabled ? '#4a8a4a' : '#666666');
		}
	}

	/**
	 * Update all displays with current values
	 */
	private updateAllDisplays(): void {
		// Displays will show their default values
		this.setScrap(this.scrapAmount);
	}

	/**
	 * Get all resource values
	 */
	public get resources() {
		return {
			driver1: this.driver1Display ? this.driver1Display.getData() : null,
			driver2: this.driver2Display ? this.driver2Display.getData() : null,
			scrap: this.scrapAmount,
		};
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
		
		// Don't recreate elements here - let the parent screen handle it via updateUIFromBattle
		// to avoid duplicate elements during resize
	}
	
	/**
	 * Clear all elements except background
	 */
	private clearElements(): void {
		// Remove all children except the first (background)
		while (this.children.length > 1) {
			this.removeChild(this.children[1]);
		}
		
		// Clear element references
		this.driver1Display = null;
		this.driver2Display = null;
		this.scrapIcon = null;
		this.scrapText = null;
		this.endTurnButton = null;
	}
}