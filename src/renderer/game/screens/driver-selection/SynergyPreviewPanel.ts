import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Driver } from '../../mechanics/Driver';
import { DriverSynergy, SynergyAnalysis } from '../../mechanics/DriverSynergy';
import { FlowWrap } from '../../ui/FlowWrap';

const TAG_HEIGHT = 20;
/** Horizontal padding inside a tag pill. */
const TAG_PADDING = 6;
const TAG_SPACING = 5;
/** The widest a tag's label gets before it truncates. */
const MAX_TAG_LABEL_WIDTH = 70;

/**
 * Dark text on a light pill and white on a dark one: the yellow, green and
 * cyan tags were unreadable under white. Rec. 709 luma of a `#rrggbb` fill.
 */
function tagLabelColor(fill: string): string {
	const channel = (offset: number): number => parseInt(fill.slice(offset, offset + 2), 16) / 255;
	const luma = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
	return luma > 0.6 ? '#1a1a2a' : '#ffffff';
}

/**
 * Synergy preview panel for the Driver Selection Screen
 * Implements the center panel from Game Flow Spec 1.2
 * Shows synergy hints between selected drivers
 *
 * A column: the title, the description, the warning when there is one, and
 * the tags flowing in rows under them, all from the width its parent gives
 * it. It hugs its height, so the screen can centre it in the gap.
 */
export class SynergyPreviewPanel extends Stack {
	private readonly synergyDescription: Text;
	private readonly warningText: Text;
	private readonly tags: FlowWrap;

	private currentSynergy: SynergyAnalysis | null = null;

	constructor(options: StackOptions) {
		super({
			direction: 'vertical',
			padding: 16,
			gap: 12,
			crossAlign: 'stretch',
			style: {
				backgroundColor: '#4a4a6a',
				borderColor: '#6a6a8a',
				borderWidth: 2,
			},
			...options,
		});

		this.addChild(new Text('Team Synergy', {
			style: {
				fontSize: 20,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
			wrap: 'none',
			textOverflow: 'ellipsis',
		}));

		this.synergyDescription = new Text('', {
			id: 'driver_select_synergy_description',
			style: {
				fontSize: 12,
				textAlign: 'center',
			},
			wrap: 'word',
		});
		this.addChild(this.synergyDescription);

		this.warningText = new Text('', {
			visible: false,
			style: {
				fontSize: 11,
				color: '#ff6666',
				textAlign: 'center',
				fontWeight: 'bold',
			},
			wrap: 'word',
		});
		this.addChild(this.warningText);

		this.tags = new FlowWrap({
			id: 'driver_select_synergy_tags',
			gap: TAG_SPACING,
			justify: 'center',
		});
		this.addChild(this.tags);

		// Initially hidden
		this.setVisible(false);
	}

	/**
	 * Update synergy display for the given driver pair
	 */
	public updateSynergy(driver1: Driver | null, driver2: Driver | null): void {
		if (!driver1 || !driver2) {
			this.currentSynergy = null;
			this.tags.clearChildren();
			this.setVisible(false);
			return;
		}

		const synergy = DriverSynergy.analyzeSynergy(driver1, driver2);
		this.currentSynergy = synergy;

		this.synergyDescription.setText(synergy.description);
		this.synergyDescription.setColor(this.getSynergyColor(synergy.type));
		this.warningText.setText(synergy.warning ?? '');
		this.warningText.setVisible(Boolean(synergy.warning));

		this.tags.clearChildren();
		for (const tag of synergy.tags) this.tags.addChild(this.createTagPill(tag));

		this.setVisible(true);
	}

	/** A pill hugging its label, the label truncating past the widest a tag gets. */
	private createTagPill(tag: string): Stack {
		const fill = this.getTagColor(tag);
		const pill = new Stack({
			direction: 'horizontal',
			crossAlign: 'center',
			height: TAG_HEIGHT,
			padding: { left: TAG_PADDING, right: TAG_PADDING },
			style: {
				backgroundColor: fill,
				borderRadius: TAG_HEIGHT / 2,
			},
		});
		pill.addChild(new Text(tag, {
			maxSize: { width: MAX_TAG_LABEL_WIDTH },
			style: {
				fontSize: 10,
				color: tagLabelColor(fill),
				fontWeight: 'bold',
			},
			wrap: 'none',
			textOverflow: 'ellipsis',
		}));
		return pill;
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
