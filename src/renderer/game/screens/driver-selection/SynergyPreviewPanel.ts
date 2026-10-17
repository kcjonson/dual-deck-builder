import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import type { ColorToken } from '../../../engine/theme/tokens';
import { ATLAS } from '../../ui/atlas/atlasStyle';
import { LegendBox, LegendBoxOptions } from '../../ui/atlas/LegendBox';
import { Driver } from '../../mechanics/Driver';
import { DriverSynergy } from '../../mechanics/DriverSynergy';
import { FlowWrap } from '../../ui/FlowWrap';

const TAG_HEIGHT = 20;
/** Horizontal padding inside a tag. */
const TAG_PADDING = 6;
const TAG_SPACING = 5;
/** The widest a tag's label gets before it truncates. */
const MAX_TAG_LABEL_WIDTH = 70;

/** How the pair reads, in the atlas's inks: good news in sage, read-only in river, a warning in stronghold red. */
const SYNERGY_INK: Readonly<Record<string, ColorToken>> = {
	strong: 'status_ok',
	good: 'data',
	warning: 'status_crit',
	neutral: 'text_dim',
};

/**
 * Synergy preview panel for the Driver Selection Screen
 * Implements the center panel from Game Flow Spec 1.2
 * Shows synergy hints between selected drivers
 *
 * A column: the title, the description, the warning when there is one, and
 * the tags flowing in rows under them, all from the width its parent gives
 * it. It hugs its height, so the screen can centre it in the gap. On the
 * atlas it's a legend box headed Team synergy, its tags printed as index
 * labels with an ink rule.
 */
export class SynergyPreviewPanel extends LegendBox {
	private readonly synergyDescription: Text;
	private readonly warningText: Text;
	private readonly tags: FlowWrap;


	constructor(options: LegendBoxOptions) {
		super({
			title: 'Team synergy',
			direction: 'vertical',
			gap: 12,
			crossAlign: 'stretch',
			...options,
		});

		this.synergyDescription = new Text({
			text: '',
			id: 'driver_select_synergy_description',
			style: {
				fontSize: 12,
				textAlign: 'center',
			},
			wrap: 'word',
		});
		this.addChild(this.synergyDescription);

		this.warningText = new Text({
			text: '',
			visible: false,
			style: {
				fontSize: 12,
				color: 'status_crit',
				textAlign: 'center',
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
		this.visible = false;
	}

	/**
	 * Update synergy display for the given driver pair
	 */
	public updateSynergy(driver1: Driver | null, driver2: Driver | null): void {
		if (!driver1 || !driver2) {
			this.tags.clearChildren();
			this.visible = false;
			return;
		}

		const synergy = DriverSynergy.analyzeSynergy(driver1, driver2);

		this.synergyDescription.text = synergy.description;
		this.synergyDescription.color = this.getSynergyColor(synergy.type);
		this.warningText.text = synergy.warning ?? '';
		this.warningText.visible = Boolean(synergy.warning);

		this.tags.clearChildren();
		for (const tag of synergy.tags) this.tags.addChild(this.createTagPill(tag));

		this.visible = true;
	}

	/** A tag hugging its label, the label truncating past the widest a tag gets. */
	private createTagPill(tag: string): Stack {
		const pill = new Stack({
			direction: 'horizontal',
			crossAlign: 'center',
			height: TAG_HEIGHT,
			padding: { left: TAG_PADDING, right: TAG_PADDING },
			style: {
				backgroundColor: 'bg_inset',
				borderColor: 'line_edge',
				borderWidth: 'bw',
				borderRadius: 'radius_ui',
			},
		});
		pill.addChild(new Text({
			text: tag,
			maxSize: { width: MAX_TAG_LABEL_WIDTH },
			style: {
				fontRole: 'mono',
				fontSize: 10,
				color: 'text',
				textTransform: 'uppercase',
				letterSpacing: ATLAS.captionTracking,
			},
			wrap: 'none',
			textOverflow: 'ellipsis',
		}));
		return pill;
	}

	private getSynergyColor(type: string): ColorToken {
		return SYNERGY_INK[type] ?? SYNERGY_INK.neutral;
	}
}
