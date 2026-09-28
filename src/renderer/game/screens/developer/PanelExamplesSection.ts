import { DeveloperSectionPanel } from './DeveloperSectionPanel';
import type { Component } from '../../../engine/components/Component';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { tokens } from '../../../engine/theme/tokens';
import { Button } from '../../../engine/ui/Button';
import { Panel, PanelOptions } from '../../../engine/ui/Panel';

type Rgba = [number, number, number, number];

const TITLE_HEIGHT = 50;
const CAPTION_HEIGHT = 20;
const CAPTION_GAP = 6;
const ROW_GAP = 24;
const PANEL_WIDTH = 220;
const PANEL_HEIGHT = 150;

function caption(text: string): Text {
	return new Text(text, { style: { fontSize: 13, color: [...tokens.color.text_dim] as Rgba } });
}

function body(text: string): Text {
	return new Text(text, { style: { fontSize: tokens.fontSize.fs_base, color: [...tokens.color.text] as Rgba } });
}

/**
 * R12.19's panel: the three variants, a header with a kicker, a title, and
 * actions, the compact and flush insets, the corner ticks, and the glow.
 * Every panel's content is its default stack; the text inside is the
 * panel's children, placed by it.
 */
export class PanelExamplesSection extends DeveloperSectionPanel {
	constructor(x: number, y: number, width: number) {
		super({ id: 'dev_section_panels', x, y, width });

		this.addChild(new Text('Panels', { style: { fontSize: 28, color: '#ffffff', fontWeight: 'bold' } }));

		const rows = new Stack({ id: 'dev_panels_rows', y: TITLE_HEIGHT, gap: ROW_GAP });
		rows.addChild(this.row('variants: panel, raised, inset; header with kicker and actions', [
			this.panel('dev_panel_plain', { title: 'Garage' }, 'The panel variant: bg_panel, an edge line.'),
			this.panel('dev_panel_raised', {
				variant: 'raised',
				kicker: 'Driver 1',
				title: 'Road Warrior',
				actions: [new Button('Swap', { size: 'sm', width: 56 })],
			}, 'Raised, with the raised shadow and an action in the header.'),
			this.panel('dev_panel_inset', { variant: 'inset', title: 'Stash' }, 'Inset: a well below the panel surface.'),
		]));
		rows.addChild(this.row('compact, flush, corner ticks, glow', [
			this.panel('dev_panel_compact', { compact: true, title: 'Compact' }, 'A smaller header and inset.'),
			this.panel('dev_panel_flush', { flush: true }, 'Flush: content meets the border.'),
			this.panel('dev_panel_corners', { corners: true, kicker: 'Target', title: 'Rust Buggy' }, 'Bracket ticks in the accent.'),
			this.panel('dev_panel_glow', { corners: true, glow: true, accent: 'data', title: 'Selected' }, 'The data accent, glowing.'),
		]));
		this.addChild(rows);

		const rowHeight = CAPTION_HEIGHT + CAPTION_GAP + PANEL_HEIGHT;
		this.fitContentHeight(TITLE_HEIGHT + rowHeight * 2 + ROW_GAP);
	}

	private row(text: string, panels: Component[]): Stack {
		const row = new Stack({ gap: CAPTION_GAP });
		row.addChild(caption(text));
		const line = new Stack({ direction: 'horizontal', gap: tokens.space.space_6 });
		panels.forEach((panel) => line.addChild(panel));
		row.addChild(line);
		return row;
	}

	private panel(id: string, options: PanelOptions, text: string): Panel {
		const panel = new Panel({ id, width: PANEL_WIDTH, height: PANEL_HEIGHT, gap: tokens.space.space_2, ...options });
		const content = body(text);
		content.widthMode = 'fill';
		panel.addChild(content);
		return panel;
	}
}
