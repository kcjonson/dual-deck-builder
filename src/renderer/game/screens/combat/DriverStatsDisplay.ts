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

/** The name's line box (10 px Open Sans, 13.6 px) with a pixel or two either side. */
const NAME_BAND = 16;
const NAME_TOP = 2;
/** Space either side of the adrenaline readout. */
const ADRENALINE_GAP = 6;
/** Space after the value beside a stat's symbol. */
const SYMBOL_VALUE_GAP = 4;

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
	
	constructor(options: LayerOptions & { height: number; driverNumber: 1 | 2 }) {
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

		// Hugs its width, which holds still as the count changes: Open Sans's
		// digits share one advance
		this.adrenalineText = new Text(`${this.data.adrenaline}/${this.data.maxAdrenaline}`, {
			id: `driver${this.driverNumber}_adrenaline_value`,
			style: {
				fontSize: 10,
				color: '#ffffff',
				verticalAlign: 'middle',
				whiteSpace: 'nowrap',
			},
		});
		this.addChild(this.adrenalineText);

		this.drawPile = this.createStatDisplay('#4a4a6a', this.data.drawPileCount.toString());
		this.discardPile = this.createStatDisplay('#6a4a4a', this.data.discardPileCount.toString());
		// The fuel symbol is not text the atlas covers (R6.3); it returns as an icon with DDB-72.
		this.fuel = this.createStatDisplay('#6a6a4a', this.data.fuel.toString());

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
					verticalAlign: 'middle',
					whiteSpace: 'nowrap',
				},
			});
			this.addChild(symbolText);
		}

		const text = new Text(value, {
			style: {
				fontSize: 8,
				color: '#ffffff',
				textAlign: symbol ? 'left' : 'center',
				verticalAlign: 'middle',
				whiteSpace: 'nowrap',
			},
		});
		this.addChild(text);

		return { icon, text, symbol: symbolText };
	}

	/**
	 * Place a stat display with its icon's left edge at x; returns its right
	 * edge. The value is centred in the icon, or beside it when the icon holds
	 * a symbol.
	 */
	private layoutStatDisplay({ icon, text, symbol }: StatDisplay, x: number, iconSize: number): number {
		const iconY = Math.floor(this.iconRowCenter - iconSize / 2);
		icon.setPosition(x, iconY);
		icon.setSize(iconSize, iconSize);
		if (!symbol) {
			text.setPosition(x, iconY);
			text.setSize(iconSize, iconSize);
			return x + iconSize;
		}
		icon.setCornerRadius(Math.floor(iconSize / 4));
		symbol.setFontSize(Math.floor(iconSize * 0.6));
		symbol.setPosition(x, iconY);
		symbol.setSize(iconSize, iconSize);
		const valueX = x + iconSize + SYMBOL_VALUE_GAP;
		text.setPosition(valueX, iconY);
		text.setSize(0, iconSize);
		return valueX + text.getWidth();
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

		currentX += ADRENALINE_GAP;
		this.adrenalineText.setPosition(currentX, Math.floor(centerY - iconSize / 2));
		this.adrenalineText.setSize(0, iconSize);
		currentX += this.adrenalineText.getWidth() + ADRENALINE_GAP;

		const stats = [this.drawPile, this.discardPile, this.fuel];
		stats.forEach((stat, index) => {
			currentX = this.layoutStatDisplay(stat, currentX, smallIconSize);
			if (index < stats.length - 1) currentX += padding;
		});

		// Hugs its content, so the bar lays out from what was measured
		this.width = currentX;
	}

	/**
	 * Handle resize
	 */
	protected onResized(): void {
		this.layoutElements();
	}

	/**
	 * The frame's layout phase: the values measure on mount and on every
	 * change (R1.6, R8.18), and this places the row from what they measured.
	 */
	protected layoutChildren(): void {
		this.layoutElements();
	}

	/** It hugs its content, so a change inside reaches the bar that places it. */
	protected get isRelayoutBoundary(): boolean {
		return false;
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
}
