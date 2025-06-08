import { Layer } from '../../../engine/components/Layer';
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
	
	constructor(options: { 
		x: number; 
		y: number; 
		width: number; 
		height: number;
		driverNumber: 1 | 2;
	}) {
		super({
			x: options.x,
			y: options.y,
			width: options.width,
			height: options.height
		});
		
		this.driverNumber = options.driverNumber;
		this.createElements();
	}
	
	/**
	 * Helper function to create a stat display (icon + text)
	 */
	private createStatDisplay(
		x: number, 
		iconSize: number, 
		backgroundColor: string, 
		value: string,
		symbol?: string,
		borderRadius?: number
	): StatDisplay {
		const height = this.getHeight();
		const fontSize = 9;
		
		// Create icon
		const icon = new Rectangle({
			x: x,
			y: Math.floor((height - iconSize) / 2),
			width: iconSize,
			height: iconSize,
			style: {
				backgroundColor,
				borderColor: '#ffffff',
				borderWidth: 1,
				borderRadius: borderRadius || 0,
			},
		});
		this.addChild(icon);
		
		// Create value text
		const text = new Text(value, {
			style: {
				fontSize,
				color: '#ffffff',
				textAlign: 'center',
			},
		});
		
		let symbolText: Text | undefined;
		
		if (symbol) {
			// If there's a symbol, show it in the icon and value next to it
			symbolText = new Text(symbol, {
				style: {
					fontSize: Math.floor(iconSize * 0.6),
					color: '#ffffff',
					textAlign: 'center',
				},
			});
			symbolText.setPosition(x + iconSize / 2, Math.floor(height / 2));
			this.addChild(symbolText);
			
			// Position value text to the right of icon
			text.setPosition(x + iconSize + 10, Math.floor(height / 2));
		} else {
			// No symbol, show value in the center of icon
			text.setPosition(x + iconSize / 2, Math.floor(height / 2));
		}
		
		this.addChild(text);
		
		return { icon, text, symbol: symbolText };
	}
	
	/**
	 * Create all display elements
	 */
	private createElements(): void {
		const height = this.getHeight();
		const iconSize = Math.floor(height * 0.6);
		const smallIconSize = Math.floor(iconSize * 0.7);
		const padding = 5;
		let currentX = 0;
		
		// Driver name label
		this.nameLabel = new Text(this.data.name, {
			style: {
				fontSize: 10,
				color: '#cccccc',
				textAlign: 'left',
			},
		});
		this.nameLabel.setPosition(currentX, Math.floor(height * 0.2));
		this.addChild(this.nameLabel);
		
		// Adrenaline icons
		for (let i = 0; i < this.data.maxAdrenaline; i++) {
			const boltIcon = new Rectangle({
				x: currentX,
				y: Math.floor((height - iconSize) / 2),
				width: iconSize,
				height: iconSize,
				style: {
					backgroundColor: '#6a6aaa',
					borderColor: '#8a8acc',
					borderWidth: 1,
				},
			});
			this.addChild(boltIcon);
			this.adrenalineIcons.push(boltIcon);
			currentX += iconSize + 2;
		}
		
		// Adrenaline text
		this.adrenalineText = new Text(`${this.data.adrenaline}/${this.data.maxAdrenaline}`, {
			style: {
				fontSize: 12,
				color: '#ffffff',
				textAlign: 'center',
			},
		});
		this.adrenalineText.setPosition(currentX + 10, Math.floor(height / 2));
		this.addChild(this.adrenalineText);
		currentX += 40;
		
		// Draw pile (deck icon with count)
		this.drawPile = this.createStatDisplay(
			currentX,
			smallIconSize,
			'#4a4a6a',
			this.data.drawPileCount.toString()
		);
		currentX += smallIconSize + padding;
		
		// Discard pile
		this.discardPile = this.createStatDisplay(
			currentX,
			smallIconSize,
			'#6a4a4a',
			this.data.discardPileCount.toString()
		);
		currentX += smallIconSize + padding;
		
		// Fuel (with symbol)
		this.fuel = this.createStatDisplay(
			currentX,
			smallIconSize,
			'#6a6a4a',
			this.data.fuel.toString(),
			'⛽',
			Math.floor(smallIconSize / 4)
		);
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
	public static getRequiredWidth(maxAdrenaline: number = 3): number {
		// Rough calculation: name + adrenaline icons + text + 3 stats
		const iconSize = 30;
		const smallIconSize = 21;
		return (iconSize + 2) * maxAdrenaline + 40 + (smallIconSize + 5) * 2 + (smallIconSize + 20);
	}
}