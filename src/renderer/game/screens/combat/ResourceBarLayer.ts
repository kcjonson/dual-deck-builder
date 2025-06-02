import { Layer } from '../../../engine/components/Layer';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Button } from '../../../engine/ui/Button';

/**
 * Resource bar layer for the bottom 5% of combat screen
 * Shows adrenaline, draw pile, discard pile, fuel, scrap, and end turn button
 */
export class ResourceBarLayer extends Layer {
	private adrenalineIcons: Rectangle[] = [];
	private adrenalineText: Text | null = null;
	private drawPileIcon: Rectangle | null = null;
	private drawPileText: Text | null = null;
	private discardPileIcon: Rectangle | null = null;
	private discardPileText: Text | null = null;
	private fuelIcon: Rectangle | null = null;
	private fuelText: Text | null = null;
	private scrapIcon: Rectangle | null = null;
	private scrapText: Text | null = null;
	private endTurnButton: Button | null = null;

	// Current resource values
	private currentAdrenaline: number = 0;
	private maxAdrenaline: number = 3;
	private drawPileCount: number = 0;
	private discardPileCount: number = 0;
	private fuelAmount: number = 0;
	private scrapAmount: number = 0;

	// Callbacks
	private onEndTurn: (() => void) | null = null;

	/**
	 * Create resource bar layer
	 */
	constructor(options: any) {
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

		// Adrenaline display
		currentX = this.createAdrenalineDisplay(currentX, iconSize, spacing);
		
		// Draw pile
		currentX = this.createPileDisplay(
			currentX, iconSize, spacing,
			'#4a4a6a', 'DRAW', 
			(icon, text) => {
				this.drawPileIcon = icon;
				this.drawPileText = text;
			}
		);

		// Discard pile
		currentX = this.createPileDisplay(
			currentX, iconSize, spacing,
			'#6a4a4a', 'DISCARD',
			(icon, text) => {
				this.discardPileIcon = icon;
				this.discardPileText = text;
			}
		);

		// Fuel
		currentX = this.createResourceDisplay(
			currentX, iconSize, spacing,
			'#6a6a4a', 'FUEL', '⛽',
			(icon, text) => {
				this.fuelIcon = icon;
				this.fuelText = text;
			}
		);

		// Scrap
		currentX = this.createResourceDisplay(
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
	 * Create adrenaline lightning bolt display
	 */
	private createAdrenalineDisplay(startX: number, iconSize: number, spacing: number): number {
		let currentX = startX;

		// Create lightning bolt icons
		for (let i = 0; i < this.maxAdrenaline; i++) {
			const boltIcon = new Rectangle({
				x: currentX,
				y: Math.floor((this.getHeight() - iconSize) / 2),
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
		this.adrenalineText = new Text('0/3', {
			style: {
				fontSize: 12,
				color: '#ffffff',
				textAlign: 'center',
			},
		});
		this.adrenalineText.setPosition(currentX + 15, Math.floor(this.getHeight() / 2));
		this.addChild(this.adrenalineText);

		return currentX + 50;
	}

	/**
	 * Create pile display (draw/discard)
	 */
	private createPileDisplay(
		startX: number, 
		iconSize: number, 
		spacing: number,
		color: string,
		label: string,
		callback: (icon: Rectangle, text: Text) => void
	): number {
		// Pile icon
		const pileIcon = new Rectangle({
			x: startX,
			y: Math.floor((this.getHeight() - iconSize) / 2),
			width: iconSize,
			height: iconSize,
			style: {
				backgroundColor: color,
				borderColor: '#ffffff',
				borderWidth: 1,
			},
		});
		this.addChild(pileIcon);

		// Pile count text
		const pileText = new Text('0', {
			style: {
				fontSize: 10,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
		});
		pileText.setPosition(startX + iconSize / 2, Math.floor(this.getHeight() / 2));
		this.addChild(pileText);

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

		callback(pileIcon, pileText);
		return startX + iconSize + spacing;
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
	 * Update adrenaline display
	 */
	public setAdrenaline(current: number, max: number = this.maxAdrenaline): void {
		this.currentAdrenaline = current;
		this.maxAdrenaline = max;
		
		// Ensure we have the right number of icons
		if (this.adrenalineIcons.length !== max) {
			// Recreate adrenaline display if max changed
			this.adrenalineIcons.forEach(icon => this.removeChild(icon));
			this.adrenalineIcons = [];
			// Would need to recreate the whole layout - for now just update existing
		}
		
		// Update icon colors based on current adrenaline
		this.adrenalineIcons.forEach((icon, index) => {
			const filled = index < current;
			icon.setFillColor(filled ? '#8a8aff' : '#4a4a6a');
			icon.setBorderColor(filled ? '#aaaaff' : '#6a6a8a');
			icon.setBorderWidth(1);
		});

		// Update text
		if (this.adrenalineText) {
			this.adrenalineText.setText(`${current}/${max}`);
		}
	}

	/**
	 * Update draw pile count
	 */
	public setDrawPileCount(count: number): void {
		this.drawPileCount = count;
		if (this.drawPileText) {
			this.drawPileText.setText(count.toString());
		}
	}

	/**
	 * Update discard pile count
	 */
	public setDiscardPileCount(count: number): void {
		this.discardPileCount = count;
		if (this.discardPileText) {
			this.discardPileText.setText(count.toString());
		}
	}

	/**
	 * Update fuel amount
	 */
	public setFuel(amount: number): void {
		this.fuelAmount = amount;
		if (this.fuelText) {
			this.fuelText.setText(amount.toString());
		}
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
		this.setAdrenaline(this.currentAdrenaline, this.maxAdrenaline);
		this.setDrawPileCount(this.drawPileCount);
		this.setDiscardPileCount(this.discardPileCount);
		this.setFuel(this.fuelAmount);
		this.setScrap(this.scrapAmount);
	}

	/**
	 * Get current resource values
	 */
	public getResources(): {
		adrenaline: number;
		maxAdrenaline: number;
		drawPile: number;
		discardPile: number;
		fuel: number;
		scrap: number;
	} {
		return {
			adrenaline: this.currentAdrenaline,
			maxAdrenaline: this.maxAdrenaline,
			drawPile: this.drawPileCount,
			discardPile: this.discardPileCount,
			fuel: this.fuelAmount,
			scrap: this.scrapAmount,
		};
	}
}