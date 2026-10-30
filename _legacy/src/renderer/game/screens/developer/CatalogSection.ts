import { DeveloperSectionPanel, DeveloperSectionPanelOptions } from './DeveloperSectionPanel';
import type { Component } from '../../../engine/components/Component';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { tokens } from '../../../engine/theme/tokens';
import { MINI_GRID } from '../../ui/Card';

const CAPTION_GAP = 6;
const ROW_GAP = 24;

/** One cell of a captioned row: a card, say, and the words under it. */
export interface CaptionedCell {
	item: Component;
	caption: string;
}

/**
 * The frame for the component catalog's gallery scenes (phase 5): a title,
 * then captioned rows laid out by one column stack, which the frame hugs.
 */
export abstract class CatalogSection extends DeveloperSectionPanel {
	private readonly rows: Stack;

	constructor({ id, ...options }: Omit<DeveloperSectionPanelOptions, 'contentHeight'>) {
		super({ id, ...options });
		this.rows = new Stack({ id: `${id}_rows`, gap: ROW_GAP, widthMode: 'fill' });
		this.addChild(this.rows);
	}

	/** A caption over `content`; a `fill` row stretches `content` to the section's width. */
	protected addRow(caption: string, content: Component, { fill = false }: { fill?: boolean } = {}): void {
		const row = fill ? new Stack({ gap: CAPTION_GAP, widthMode: 'fill', crossAlign: 'stretch' }) : new Stack({ gap: CAPTION_GAP });
		row.addChild(new Text({ text: caption, style: { fontSize: tokens.fontSize.fs_base, color: 'text_dim' } }));
		row.addChild(content);
		this.rows.addChild(row);
	}

	/**
	 * Captioned cells side by side, spaced as a grid of minis is
	 * (`MINI_GRID`), which clears the ink of any card up to `MINI_CARD_INK`.
	 * Each caption sits `ink` and a little more under its item, so it clears
	 * that item's own ink, and wraps inside `captionWidth`. Arrow keys move
	 * along the row.
	 */
	protected captionedRow({ id, cells, ink, captionWidth }: { id: string; cells: readonly CaptionedCell[]; ink: number; captionWidth: number }): Stack {
		const row = new Stack({ id, direction: 'horizontal', gap: MINI_GRID.gap, margin: MINI_GRID.margin, focusGroup: { orientation: 'horizontal' } });
		for (const { item, caption } of cells) {
			const cell = new Stack({ gap: ink + tokens.space.space_2 });
			cell.addChild(item);
			cell.addChild(new Text({
				text: caption,
				width: captionWidth,
				style: { fontSize: tokens.fontSize.fs_sm, color: 'text_dim' },
				wrap: 'word',
			}));
			row.addChild(cell);
		}
		return row;
	}

	/** A row of controls, centred across. */
	protected line(children: Component[], gap: number = tokens.space.space_6): Stack {
		const line = new Stack({ direction: 'horizontal', gap, crossAlign: 'center' });
		children.forEach((child) => line.addChild(child));
		return line;
	}
}
