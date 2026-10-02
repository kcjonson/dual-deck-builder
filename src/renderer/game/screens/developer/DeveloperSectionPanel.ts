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
			// A section is the size it computed, in the developer screen's
			// column as in the gallery: its content is placed by hand, so
			// there is nothing for a parent stack to measure.
			widthMode: 'fixed',
			heightMode: 'fixed',
			// Sections place their content by hand.
			layout: 'free',
			// The frame the sections have always had, rather than a themed panel.
			style: {
				backgroundColor: 'transparent',
				borderColor: '#4d4d4d',
				borderWidth: SECTION_BORDER_WIDTH,
				borderRadius: 5,
				padding: SECTION_INSET,
			},
		});
	}

	/** The width a section lays its content out in: its own, less the inset either side. */
	protected get sectionContentWidth(): number {
		return this.width - SECTION_INSET * 2;
	}

	/** Size the frame to hold `contentHeight` of content plus the inset above and below it. */
	protected fitContentHeight(contentHeight: number): void {
		this.setSize(this.width, contentHeight + SECTION_INSET * 2);
	}
}

/**
 * How many lines a FlowWrap `available` wide breaks items `widths` wide into,
 * breaking as it does: a new line whenever the next item would pass the
 * width, and at least one item a line. A section's height has to be known
 * when its constructor returns (sections.ts), before anything is laid out.
 */
export function wrappedLineCount(widths: readonly number[], available: number, gap: number): number {
	let lines = 0;
	let lineWidth = 0;
	for (const width of widths) {
		if (lines === 0 || lineWidth + gap + width > available) {
			lines += 1;
			lineWidth = width;
		} else {
			lineWidth += gap + width;
		}
	}
	return lines;
}
