import { DeveloperSectionPanel, DeveloperSectionPanelOptions } from './DeveloperSectionPanel';
import type { Component } from '../../../engine/components/Component';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { tokens } from '../../../engine/theme/tokens';

const CAPTION_GAP = 6;
const ROW_GAP = 24;

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

	/** A row of controls, centred across. */
	protected line(children: Component[], gap: number = tokens.space.space_6): Stack {
		const line = new Stack({ direction: 'horizontal', gap, crossAlign: 'center' });
		children.forEach((child) => line.addChild(child));
		return line;
	}
}
