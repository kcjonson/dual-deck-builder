import { Icon } from '../../../engine/components/Icon';
import { Layer, LayerOptions } from '../../../engine/components/Layer';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import type { IconName } from '../../../engine/text/icons';
import { tokens } from '../../../engine/theme/tokens';

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

/** The name's 12 px line box (10 px at 1.2) with two pixels either side. */
const NAME_BAND = 16;
const NAME_TOP = 2;

/**
 * Stat display references
 */
interface StatDisplay {
	icon: Rectangle;
	text: Text;
	symbol?: Icon;
}

/**
 * Compact display for a single driver's resources
 */
export class DriverStatsDisplay extends Layer {
	private driverNumber: 1 | 2;
	private nameLabel: Text;
	private adrenalineIcons: Rectangle[];
	private adrenalineText: Text;

	// Stat displays
	private drawPile: StatDisplay;
	private discardPile: StatDisplay;
	private fuel: StatDisplay;

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

		// Created here and placed by layoutElements
		this.nameLabel = new Text(this.data.name, {
			style: {
				fontSize: 10,
				color: '#cccccc',
				textAlign: 'left',
			},
		});
		this.addChild(this.nameLabel);

		this.adrenalineIcons = Array.from({ length: this.data.maxAdrenaline }, () => {
			const boltIcon = new Rectangle({
				style: {
					backgroundColor: '#6a6aaa',
					borderColor: '#8a8acc',
					borderWidth: 1,
				},
			});
			this.addChild(boltIcon);
			return boltIcon;
		});

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
		this.fuel = this.createStatDisplay('#6a6a4a', this.data.fuel.toString(), 'local_gas_station');

		this.layoutElements();
	}

	/**
	 * Helper function to create a stat display (icon + text); layoutElements
	 * places it
	 */
	private createStatDisplay(backgroundColor: string, value: string, glyph?: IconName): StatDisplay {
		const icon = new Rectangle({
			style: {
				backgroundColor,
				borderColor: '#ffffff',
				borderWidth: 1,
			},
		});
		this.addChild(icon);

		let symbol: Icon | undefined;
		if (glyph) {
			// The symbol sits in the icon and the value next to it
			symbol = new Icon({ glyph, size: 0, tint: tokens.color.text_bright });
			this.addChild(symbol);
		}

		const text = new Text(value, {
			style: {
				fontSize: 8,
				color: '#ffffff',
				textAlign: 'center',
			},
		});
		this.addChild(text);

		return { icon, text, symbol };
	}

	/**
	 * Place a stat display with its icon's left edge at x
	 */
	private layoutStatDisplay({ icon, text, symbol }: StatDisplay, x: number, iconSize: number): void {
		const centerY = this.iconRowCenter;
		icon.setPosition(x, Math.floor(centerY - iconSize / 2));
		icon.setSize(iconSize, iconSize);
		if (symbol) {
			icon.setCornerRadius(Math.floor(iconSize / 4));
			const symbolSize = Math.floor(iconSize * 0.75);
			symbol.size = symbolSize;
			symbol.setPosition(x + (iconSize - symbolSize) / 2, Math.floor(centerY - iconSize / 2) + (iconSize - symbolSize) / 2);
			text.setPosition(x + iconSize + 10, Math.floor(centerY));
		} else {
			text.setPosition(x + iconSize / 2, Math.floor(centerY));
		}
	}

	/**
	 * The icons are submitted after the name and paint over it (chapter 3), so
	 * the name has a band of its own on top and the icon row is centred in
	 * what is left.
	 */
	private get iconRowCenter(): number {
		const height = this.getHeight();
		return NAME_BAND + (height - NAME_BAND) / 2;
	}

	/**
	 * Place every element for the display's current height, on construction
	 * and on every resize
	 */
	private layoutElements(): void {
		const height = this.getHeight();
		// Below the name's band, less a pixel either side of the row.
		const iconSize = Math.max(0, Math.min(Math.floor(height * 0.6), height - NAME_BAND - 2));
		const smallIconSize = Math.floor(iconSize * 0.7);
		const padding = 5;
		const centerY = this.iconRowCenter;
		let currentX = 0;

		this.nameLabel.setPosition(currentX, NAME_TOP);

		for (const boltIcon of this.adrenalineIcons) {
			boltIcon.setPosition(currentX, Math.floor(centerY - iconSize / 2));
			boltIcon.setSize(iconSize, iconSize);
			currentX += iconSize + 2;
		}

		this.adrenalineText.setPosition(currentX + 10, Math.floor(centerY));
		currentX += 40;

		for (const stat of [this.drawPile, this.discardPile, this.fuel]) {
			this.layoutStatDisplay(stat, currentX, smallIconSize);
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
		if (data.name) {
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
			
			this.adrenalineText.setText(`${this.data.adrenaline}/${this.data.maxAdrenaline}`);
		}

		// Update stat displays
		if (data.drawPileCount !== undefined) {
			this.drawPile.text.setText(data.drawPileCount.toString());
		}
		if (data.discardPileCount !== undefined) {
			this.discardPile.text.setText(data.discardPileCount.toString());
		}
		if (data.fuel !== undefined) {
			this.fuel.text.setText(data.fuel.toString());
		}
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