import { Layer, LayerOptions } from '../../../engine/components/Layer';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';

/**
 * Driver resource data
 */
export interface DriverResourceData {
	name: string;
	adrenaline: number;
	maxAdrenaline: number;
	drawPileCount: number;
	discardPileCount: number;
	fuel: number;
}

/**
 * Stat display references
 */
interface StatDisplay {
	icon: Rectangle;
	text: Text;
	symbol?: Text;
}

/**
 * Compact display for a single driver's resources
 */
export class DriverStatsDisplay extends Layer {
	private driverNumber: 1 | 2;
	private nameLabel: Text | null = null;
	private adrenalineIcons: Rectangle[] = [];
	private adrenalineText: Text | null = null;
	
	// Stat displays
	private drawPile: StatDisplay | null = null;
	private discardPile: StatDisplay | null = null;
	private fuel: StatDisplay | null = null;
	
	// Current data
	private data: DriverResourceData = {
		name: 'Driver',
		adrenaline: 0,
		maxAdrenaline: 3,
		drawPileCount: 0,
		discardPileCount: 0,
		fuel: 0
	};
	
	constructor(options: LayerOptions & { x: number; y: number; width: number; height: number; driverNumber: 1 | 2 }) {
		super(options);

		this.driverNumber = options.driverNumber;
		this.createElements();
		this.layoutElements();
	}

	/**
	 * Helper function to create a stat display (icon + text); layoutElements
	 * places it
	 */
	private createStatDisplay(backgroundColor: string, value: string, symbol?: string): StatDisplay {
		const icon = new Rectangle({
			style: {
				backgroundColor,
				borderColor: '#ffffff',
				borderWidth: 1,
			},
		});
		this.addChild(icon);

		let symbolText: Text | undefined;
		if (symbol) {
			// The symbol sits in the icon and the value next to it
			symbolText = new Text(symbol, {
				style: {
					color: '#ffffff',
					textAlign: 'center',
				},
			});
			this.addChild(symbolText);
		}

		const text = new Text(value, {
			style: {
				fontSize: 8,
				color: '#ffffff',
				textAlign: 'center',
			},
		});
		this.addChild(text);

		return { icon, text, symbol: symbolText };
	}

	/**
	 * Place a stat display with its icon's left edge at x
	 */
	private layoutStatDisplay({ icon, text, symbol }: StatDisplay, x: number, iconSize: number): void {
		const height = this.getHeight();
		icon.setPosition(x, Math.floor((height - iconSize) / 2));
		icon.setSize(iconSize, iconSize);
		if (symbol) {
			icon.setCornerRadius(Math.floor(iconSize / 4));
			symbol.setFontSize(Math.floor(iconSize * 0.6));
			symbol.setPosition(x + iconSize / 2, Math.floor(height / 2));
			text.setPosition(x + iconSize + 10, Math.floor(height / 2));
		} else {
			text.setPosition(x + iconSize / 2, Math.floor(height / 2));
		}
	}

	/**
	 * Create all display elements; layoutElements places them
	 */
	private createElements(): void {
		this.nameLabel = new Text(this.data.name, {
			style: {
				fontSize: 10,
				color: '#cccccc',
				textAlign: 'left',
			},
		});
		this.addChild(this.nameLabel);

		for (let i = 0; i < this.data.maxAdrenaline; i++) {
			const boltIcon = new Rectangle({
				style: {
					backgroundColor: '#6a6aaa',
					borderColor: '#8a8acc',
					borderWidth: 1,
				},
			});
			this.addChild(boltIcon);
			this.adrenalineIcons.push(boltIcon);
		}

		this.adrenalineText = new Text(`${this.data.adrenaline}/${this.data.maxAdrenaline}`, {
			id: `driver${this.driverNumber}_adrenaline_value`,
			style: {
				fontSize: 10,
				color: '#ffffff',
				textAlign: 'center',
			},
		});
		this.addChild(this.adrenalineText);

		this.drawPile = this.createStatDisplay('#4a4a6a', this.data.drawPileCount.toString());
		this.discardPile = this.createStatDisplay('#6a4a4a', this.data.discardPileCount.toString());
		this.fuel = this.createStatDisplay('#6a6a4a', this.data.fuel.toString(), '⛽');
	}

	/**
	 * Place every element for the display's current height, on construction
	 * and on every resize
	 */
	private layoutElements(): void {
		const height = this.getHeight();
		const iconSize = Math.floor(height * 0.6);
		const smallIconSize = Math.floor(iconSize * 0.7);
		const padding = 5;
		let currentX = 0;

		this.nameLabel?.setPosition(currentX, Math.floor(height * 0.2));

		for (const boltIcon of this.adrenalineIcons) {
			boltIcon.setPosition(currentX, Math.floor((height - iconSize) / 2));
			boltIcon.setSize(iconSize, iconSize);
			currentX += iconSize + 2;
		}

		this.adrenalineText?.setPosition(currentX + 10, Math.floor(height / 2));
		currentX += 40;

		for (const stat of [this.drawPile, this.discardPile, this.fuel]) {
			if (stat) {
				this.layoutStatDisplay(stat, currentX, smallIconSize);
			}
			currentX += smallIconSize + padding;
		}
	}

	/**
	 * Handle resize
	 */
	protected onResized(): void {
		this.layoutElements();
	}
	
	/**
	 * Update display with new data
	 */
	public setData(data: Partial<DriverResourceData>): void {
		// Update internal data
		Object.assign(this.data, data);
		
		// Update name
		if (data.name && this.nameLabel) {
			this.nameLabel.setText(data.name);
		}
		
		// Update adrenaline
		if (data.adrenaline !== undefined || data.maxAdrenaline !== undefined) {
			// Update icon colors based on current adrenaline
			const isDriver2 = this.driverNumber === 2;
			this.adrenalineIcons.forEach((icon, index) => {
				const filled = index < this.data.adrenaline;
				if (isDriver2) {
					// Green for driver 2
					icon.setFillColor(filled ? '#88ff88' : '#4a6a4a');
					icon.setBorderColor(filled ? '#aaffaa' : '#6a8a6a');
				} else {
					// Blue for driver 1
					icon.setFillColor(filled ? '#8a8aff' : '#4a4a6a');
					icon.setBorderColor(filled ? '#aaaaff' : '#6a6a8a');
				}
			});
			
			// Update text
			if (this.adrenalineText) {
				this.adrenalineText.setText(`${this.data.adrenaline}/${this.data.maxAdrenaline}`);
			}
		}
		
		// Update stat displays
		if (this.drawPile && data.drawPileCount !== undefined) {
			this.drawPile.text.setText(data.drawPileCount.toString());
		}
		if (this.discardPile && data.discardPileCount !== undefined) {
			this.discardPile.text.setText(data.discardPileCount.toString());
		}
		if (this.fuel && data.fuel !== undefined) {
			this.fuel.text.setText(data.fuel.toString());
		}
	}
	
	/**
	 * Get current data
	 */
	public getData(): DriverResourceData {
		return { ...this.data };
	}
	
	/**
	 * Get the width needed for this display
	 */
	public static getRequiredWidth(maxAdrenaline = 3): number {
		// Rough calculation: name + adrenaline icons + text + 3 stats
		const iconSize = 30;
		const smallIconSize = 21;
		return (iconSize + 2) * maxAdrenaline + 40 + (smallIconSize + 5) * 2 + (smallIconSize + 20);
	}
}