import { Layer, LayerOptions } from '../../../engine/components/Layer';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Driver } from '../../mechanics/Driver';
import { DriverSynergy, SynergyAnalysis } from '../../mechanics/DriverSynergy';

/** Horizontal padding inside a tag pill. */
const TAG_PADDING = 5;

/**
 * Synergy preview panel for the Driver Selection Screen
 * Implements the center panel from Game Flow Spec 1.2
 * Shows synergy hints between selected drivers
 */
export class SynergyPreviewPanel extends Layer {
	private background: Rectangle;
	private titleText: Text;
	private synergyDescription: Text | null = null;
	private warningText: Text | null = null;
	private tagsContainer: Layer | null = null;
	
	private currentSynergy: SynergyAnalysis | null = null;

	/**
	 * Create a new synergy preview panel
	 */
	constructor(options: LayerOptions & { x: number; y: number; width: number; height: number }) {
		super(options);
		
		// Create background
		this.background = new Rectangle({
			x: 0,
			y: 0,
			width: this.getWidth(),
			height: this.getHeight(),
			style: {
				backgroundColor: '#4a4a6a',
				borderColor: '#6a6a8a',
				borderWidth: 2,
			},
		});
		this.addChild(this.background);
		
		// Create title
		// Centred across the panel
		this.titleText = new Text('Team Synergy', {
			x: 0,
			y: 25,
			width: this.getWidth(),
			style: {
				fontSize: 20,
				color: '#ffffff',
				textAlign: 'center',
				whiteSpace: 'nowrap',
				fontWeight: 'bold',
			},
		});
		this.addChild(this.titleText);
		
		// Initially hidden
		this.setVisible(false);
	}

	/**
	 * Update synergy display for the given driver pair
	 */
	public updateSynergy(driver1: Driver | null, driver2: Driver | null): void {
		// Clear existing synergy content
		this.clearSynergyContent();
		
		if (!driver1 || !driver2) {
			this.setVisible(false);
			return;
		}
		
		// Analyze synergy
		this.currentSynergy = DriverSynergy.analyzeSynergy(driver1, driver2);
		
		// Show the panel
		this.setVisible(true);
		
		// Create synergy display
		this.createSynergyDisplay();
	}

	/**
	 * Clear existing synergy content
	 */
	private clearSynergyContent(): void {
		const children = [...this.getChildren()];
		children.forEach(child => {
			if (child !== this.background && child !== this.titleText) {
				this.removeChild(child);
			}
		});
		
		this.synergyDescription = null;
		this.warningText = null;
		this.tagsContainer = null;
	}

	/**
	 * Create the synergy display content
	 */
	private createSynergyDisplay(): void {
		if (!this.currentSynergy) return;
		
		const panelWidth = this.getWidth();
		let currentY = 60; // Start below title
		
		// Synergy description
		this.synergyDescription = new Text(this.currentSynergy.description, {
			width: Math.floor(panelWidth * 0.9),
			style: {
				fontSize: 12,
				color: this.getSynergyColor(this.currentSynergy.type),
				textAlign: 'center',
				whiteSpace: 'normal',
			},
		});
		this.synergyDescription.setPosition(Math.floor(panelWidth * 0.05), currentY);
		this.addChild(this.synergyDescription);
		currentY += this.synergyDescription.getHeight() + 20;
		
		// Warning text if present
		if (this.currentSynergy.warning) {
			this.warningText = new Text(this.currentSynergy.warning, {
				width: Math.floor(panelWidth * 0.9),
				style: {
					fontSize: 11,
					color: '#ff6666',
					textAlign: 'center',
					whiteSpace: 'normal',
					fontWeight: 'bold',
				},
			});
			this.warningText.setPosition(Math.floor(panelWidth * 0.05), currentY);
			this.addChild(this.warningText);
			currentY += this.warningText.getHeight() + 15;
		}
		
		// Synergy tags
		if (this.currentSynergy.tags.length > 0) {
			this.createSynergyTags(currentY);
		}
	}

	/**
	 * Create synergy tags display
	 */
	private createSynergyTags(startY: number): void {
		if (!this.currentSynergy) return;
		
		this.tagsContainer = new Layer({
			x: 0,
			y: startY,
			width: this.getWidth(),
			height: this.getHeight() - startY,
		});
		this.addChild(this.tagsContainer);
		
		const panelWidth = this.getWidth();
		const tagHeight = 20;
		const tagSpacing = 5;
		const maxTagWidth = 80;
		
		// Calculate layout for tags
		let currentX = 10;
		let currentRow = 0;
		
		for (const tag of this.currentSynergy.tags) {
			// Measured at its hug width, then boxed in a pill that fits it, or
			// truncated to the widest pill
			const tagText = new Text(tag, {
				style: {
					fontSize: 10,
					color: '#ffffff',
					textAlign: 'center',
					verticalAlign: 'middle',
					whiteSpace: 'nowrap',
					textOverflow: 'ellipsis',
					fontWeight: 'bold',
				},
			});
			const tagBackground = new Rectangle({
				style: {
					backgroundColor: this.getTagColor(tag),
					borderRadius: 10,
				},
			});
			// Added before they are placed: the panel is mounted, so the label
			// measures through the mount context as it is added (R1.6), and the
			// pill is sized from that.
			this.tagsContainer.addChild(tagBackground);
			this.tagsContainer.addChild(tagText);
			const tagWidth = Math.ceil(Math.min(maxTagWidth, tagText.getWidth() + TAG_PADDING * 2));

			// Check if tag fits on current row
			if (currentX + tagWidth > panelWidth - 10) {
				currentX = 10;
				currentRow++;
			}
			const tagY = currentRow * (tagHeight + tagSpacing);

			tagBackground.setPosition(currentX, tagY);
			tagBackground.setSize(tagWidth, tagHeight);

			// Centred in the pill, inside its padding
			tagText.setPosition(currentX + TAG_PADDING, tagY);
			tagText.setSize(tagWidth - TAG_PADDING * 2, tagHeight);

			currentX += tagWidth + tagSpacing;
		}
	}

	/**
	 * Get color for synergy type
	 */
	private getSynergyColor(type: string): string {
		switch (type) {
			case 'strong':
				return '#66ff66';
			case 'good':
				return '#66ccff';
			case 'warning':
				return '#ffaa66';
			case 'neutral':
			default:
				return '#cccccc';
		}
	}

	/**
	 * Get color for synergy tag
	 */
	private getTagColor(tag: string): string {
		const tagColors: Record<string, string> = {
			'high-damage': '#ff6666',
			'tank': '#6666ff',
			'mobile': '#66ff66',
			'support': '#ffff66',
			'glass-cannon': '#ff9966',
			'defensive': '#9966ff',
			'utility': '#66ffff',
			'berserker': '#ff3333',
			'fortress': '#3366ff',
			'precision': '#33ff33',
		};
		
		return tagColors[tag] || '#888888';
	}

	/**
	 * Get current synergy analysis
	 */
	public getCurrentSynergy(): SynergyAnalysis | null {
		return this.currentSynergy;
	}
}