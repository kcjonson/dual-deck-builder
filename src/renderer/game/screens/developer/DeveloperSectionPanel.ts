import { Panel } from '../../../engine/ui/Panel';
import { Text } from '../../../engine/components/Text';
import { tokens } from '../../../engine/theme/tokens';

const SECTION_BORDER_WIDTH = tokens.borderWidth.bw;

/**
 * How far a section's content sits inside its frame: the border plus a spacing
 * step, which also clears Panel's default 5 px corner radius. Without it a
 * section's title at (0, 0) drew on the border (DDB-196).
 */
export const SECTION_INSET = SECTION_BORDER_WIDTH + tokens.space.space_3;

/** The title's row: the content below it starts this far down. */
export const SECTION_TITLE_HEIGHT = 50;

/** What a section's builder takes (sections.ts); every field is optional. */
export interface DeveloperSectionOptions {
	x?: number;
	y?: number;
	/**
	 * The section's outer width, border included, as the gallery gives it.
	 * Absent, the section hugs, and the developer screen's column stretches
	 * it to the column's width.
	 */
	width?: number;
}

export interface DeveloperSectionPanelOptions extends DeveloperSectionOptions {
	id: string;
	title: string;
	/**
	 * For the gallery-only scenes that still place their content by hand:
	 * the height of that content. The frame is then fixed at it and nothing
	 * flows. Absent, the content is a column and the frame hugs it.
	 */
	contentHeight?: number;
}

/**
 * The bordered frame every developer section (and so every gallery scene)
 * draws in: the title, then the section's content as a column inside the
 * inset, the frame as tall as the column at whatever width it is given. A
 * section built once reflows when its width changes, with nothing rebuilt.
 */
export class DeveloperSectionPanel extends Panel {
	constructor({ id, title, x = 0, y = 0, width, contentHeight }: DeveloperSectionPanelOptions) {
		super({
			id,
			x,
			y,
			width,
			height: contentHeight !== undefined ? contentHeight + SECTION_INSET * 2 : undefined,
			layout: contentHeight !== undefined ? 'free' : 'stack',
			// The frame the sections have always had, rather than a themed panel.
			style: {
				backgroundColor: 'transparent',
				borderColor: '#4d4d4d',
				borderWidth: SECTION_BORDER_WIDTH,
				borderRadius: 5,
				padding: SECTION_INSET,
			},
		});
		this.addChild(new Text(title, {
			height: SECTION_TITLE_HEIGHT,
			style: { fontSize: tokens.fontSize.fs_2xl, color: 'text_bright', fontWeight: 'bold' },
		}));
	}
}
