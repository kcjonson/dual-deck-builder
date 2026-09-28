import { Panel } from '../../../engine/ui/Panel';
import { tokens } from '../../../engine/theme/tokens';

const SECTION_BORDER_WIDTH = tokens.borderWidth.bw;

/**
 * How far a section's content sits inside its frame: the border plus a spacing
 * step, which also clears Panel's default 5 px corner radius. Without it a
 * section's title at (0, 0) drew on the border (DDB-196).
 */
export const SECTION_INSET = SECTION_BORDER_WIDTH + tokens.space.space_3;

export interface DeveloperSectionPanelOptions {
	id: string;
	x: number;
	y: number;
	/** The section's outer width, border included. */
	width: number;
}

/**
 * The bordered frame every developer section (and so every gallery scene)
 * draws in. Children are placed against the content box, so a section lays
 * out from (0, 0) inside `innerWidth` and reports its content height through
 * `fitContentHeight`.
 */
export class DeveloperSectionPanel extends Panel {
	constructor({ id, x, y, width }: DeveloperSectionPanelOptions) {
		super({
			id,
			x,
			y,
			width,
			// Replaced by fitContentHeight once the section knows its content.
			height: SECTION_INSET * 2,
			padding: SECTION_INSET,
			style: {
				backgroundColor: 'transparent',
				borderWidth: SECTION_BORDER_WIDTH,
			},
		});
	}

	/** Size the frame to hold `contentHeight` of content plus the inset above and below it. */
	protected fitContentHeight(contentHeight: number): void {
		this.setSize(this.width, contentHeight + this.padding * 2);
	}
}
