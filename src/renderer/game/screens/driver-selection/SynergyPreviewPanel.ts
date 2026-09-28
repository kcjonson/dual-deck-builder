import { Layer, LayerOptions } from '../../../engine/components/Layer';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Driver } from '../../mechanics/Driver';
import { DriverSynergy, SynergyAnalysis } from '../../mechanics/DriverSynergy';

/** Horizontal padding inside a tag pill. */
const TAG_PADDING = 5;
const TAG_HEIGHT = 20;
const TAG_SPACING = 5;
const MAX_TAG_WIDTH = 80;

/** A synergy tag: its label, the pill sized to it, and the pill's width. */
interface TagPill {
	label: Text;
	pill: Rectangle;
	width: number;
}

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
	private tagPills: TagPill[] = [];
	
	private currentSynergy: SynergyAnalysis | null = null;

	/**
	 * Create a new synergy preview panel. Its contents are placed from its
	 * size in the layout phase, so a resize moves them rather than rebuilding.
	 */
	constructor(options: LayerOptions) {
		super(options);

		this.background = new Rectangle({
			style: {
				backgroundColor: '#4a4a6a',
				borderColor: '#6a6a8a',
				borderWidth: 2,
			},
		});
		this.addChild(this.background);
		
		// Centred across the panel
		this.titleText = new Text('Team Synergy', {
			y: 25,
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
		this.tagPills = [];
	}

	/**
	 * Create the synergy display content; placeContents places it
	 */
	private createSynergyDisplay(): void {
		if (!this.currentSynergy) return;

		this.synergyDescription = new Text(this.currentSynergy.description, {
			style: {
				fontSize: 12,
				color: this.getSynergyColor(this.currentSynergy.type),
				textAlign: 'center',
				whiteSpace: 'normal',
			},
		});
		this.addChild(this.synergyDescription);

		if (this.currentSynergy.warning) {
			this.warningText = new Text(this.currentSynergy.warning, {
				style: {
					fontSize: 11,
					color: '#ff6666',
					textAlign: 'center',
					whiteSpace: 'normal',
					fontWeight: 'bold',
				},
			});
			this.addChild(this.warningText);
		}

		if (this.currentSynergy.tags.length > 0) {
			this.createSynergyTags(this.currentSynergy.tags);
		}
		this.placeContents();
	}

	private createSynergyTags(tags: readonly string[]): void {
		const container = new Layer({});
		this.tagsContainer = container;
		this.addChild(container);

		for (const tag of tags) {
			const label = new Text(tag, {
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
			const pill = new Rectangle({
				style: {
					backgroundColor: this.getTagColor(tag),
					borderRadius: 10,
				},
			});
			// Added before it is measured: the panel is mounted, so the label
			// measures its hug width through the mount context as it is added
			// (R1.6), and the pill fits that or truncates it to the widest pill.
			container.addChild(pill);
			container.addChild(label);
			const width = Math.ceil(Math.min(MAX_TAG_WIDTH, label.getWidth() + TAG_PADDING * 2));
			this.tagPills.push({ label, pill, width });
		}
	}

	/** The frame's layout phase: the panel was sized, or what it holds changed (R8.18). */
	protected layoutChildren(): void {
		this.placeContents();
	}

	/**
	 * The description, the warning under it, and the tags under that, all
	 * from the panel's width; the wrapped texts' heights decide where the
	 * next one starts.
	 */
	private placeContents(): void {
		const panelWidth = this.getWidth();
		const panelHeight = this.getHeight();

		this.background.setSize(panelWidth, panelHeight);
		this.titleText.setWidth(panelWidth);

		let currentY = 60; // Start below title
		if (this.synergyDescription) {
			this.synergyDescription.setWidth(Math.floor(panelWidth * 0.9));
			this.synergyDescription.setPosition(Math.floor(panelWidth * 0.05), currentY);
			currentY += this.synergyDescription.getHeight() + 20;
		}
		if (this.warningText) {
			this.warningText.setWidth(Math.floor(panelWidth * 0.9));
			this.warningText.setPosition(Math.floor(panelWidth * 0.05), currentY);
			currentY += this.warningText.getHeight() + 15;
		}
		if (this.tagsContainer) {
			this.tagsContainer.setPosition(0, currentY);
			this.tagsContainer.setSize(panelWidth, Math.max(0, panelHeight - currentY));
			this.placeTags(panelWidth);
		}
	}

	/** Tags flow in rows across the panel's width. */
	private placeTags(panelWidth: number): void {
		let currentX = 10;
		let currentRow = 0;
		for (const { label, pill, width: tagWidth } of this.tagPills) {
			if (currentX + tagWidth > panelWidth - 10) {
				currentX = 10;
				currentRow++;
			}
			const tagY = currentRow * (TAG_HEIGHT + TAG_SPACING);

			pill.setPosition(currentX, tagY);
			pill.setSize(tagWidth, TAG_HEIGHT);

			// Centred in the pill, inside its padding
			label.setPosition(currentX + TAG_PADDING, tagY);
			label.setSize(tagWidth - TAG_PADDING * 2, TAG_HEIGHT);

			currentX += tagWidth + TAG_SPACING;
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