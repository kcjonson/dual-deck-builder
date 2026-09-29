import { DeveloperSectionPanel } from './DeveloperSectionPanel';
import type { Component } from '../../../engine/components/Component';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { tokens } from '../../../engine/theme/tokens';

type Rgba = [number, number, number, number];

const TITLE_HEIGHT = 50;
/** Room for a one-line 13 px caption; captions hug, this is only the section's height budget. */
const CAPTION_HEIGHT = 20;
const CAPTION_GAP = 6;
const ROW_GAP = 24;

/**
 * The frame for the component catalog's gallery scenes (phase 5): a title,
 * then captioned rows laid out by one column stack. Each row states its
 * height, since a section's height has to be known when its constructor
 * returns (sections.ts), and every control in these scenes has a fixed
 * height from its `size` (R11.10).
 */
export abstract class CatalogSection extends DeveloperSectionPanel {
	private readonly rows: Stack;
	private catalogHeight = TITLE_HEIGHT;

	constructor({ id, title, x, y, width }: { id: string; title: string; x: number; y: number; width: number }) {
		super({ id, x, y, width });
		this.addChild(new Text(title, { style: { fontSize: 28, color: '#ffffff', fontWeight: 'bold' } }));
		this.rows = new Stack({ id: `${id}_rows`, y: TITLE_HEIGHT, gap: ROW_GAP });
		this.addChild(this.rows);
	}

	/** A caption over `content`, which is `height` tall. */
	protected addRow(caption: string, content: Component, height: number): void {
		const row = new Stack({ gap: CAPTION_GAP });
		row.addChild(new Text(caption, { style: { fontSize: 13, color: [...tokens.color.text_dim] as Rgba } }));
		row.addChild(content);
		this.rows.addChild(row);
		if (this.rows.getChildren().length > 1) this.catalogHeight += ROW_GAP;
		this.catalogHeight += CAPTION_HEIGHT + CAPTION_GAP + height;
		this.fitContentHeight(this.catalogHeight);
	}

	/** A row of controls, centred across. */
	protected line(children: Component[], gap = tokens.space.space_6): Stack {
		const line = new Stack({ direction: 'horizontal', gap, crossAlign: 'center' });
		children.forEach((child) => line.addChild(child));
		return line;
	}
}
