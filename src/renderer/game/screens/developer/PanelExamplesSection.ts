import { DeveloperSectionPanel, DeveloperSectionOptions } from './DeveloperSectionPanel';
import { FlowWrap } from '../../ui/FlowWrap';
import type { Component } from '../../../engine/components/Component';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { tokens } from '../../../engine/theme/tokens';
import { Button } from '../../../engine/ui/Button';
import { Panel, PanelOptions } from '../../../engine/ui/Panel';

const CAPTION_GAP = 6;
const ROW_GAP = 24;
const PANEL_WIDTH = 220;
const PANEL_HEIGHT = 150;

function caption(text: string): Text {
	return new Text(text, { style: { fontSize: tokens.fontSize.fs_base, color: 'text_dim' } });
}

function body(text: string): Text {
	return new Text(text, { widthMode: 'fill', style: { fontSize: tokens.fontSize.fs_base, color: 'text' } });
}

/**
 * R12.19's panel: the three variants, a header with a kicker, a title, and
 * actions, the compact and flush insets, the corner ticks, and the glow.
 * Every panel's content is its default stack; the text inside is the
 * panel's children, placed by it.
 */
export class PanelExamplesSection extends DeveloperSectionPanel {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_panels', title: 'Panels', ...options });

		const rows = new Stack({ id: 'dev_panels_rows', gap: ROW_GAP, widthMode: 'fill' });
		rows.addChild(row('variants: panel, raised, inset; header with kicker and actions', [
			panel('dev_panel_plain', { title: 'Garage' }, 'The panel variant: bg_panel, an edge line.'),
			panel('dev_panel_raised', {
				variant: 'raised',
				kicker: 'Driver 1',
				title: 'Road Warrior',
				actions: [new Button('Swap', { size: 'sm', width: 56 })],
			}, 'Raised, with the raised shadow and an action in the header.'),
			panel('dev_panel_inset', { variant: 'inset', title: 'Stash' }, 'Inset: a well below the panel surface.'),
		]));
		rows.addChild(row('compact, flush, corner ticks, glow', [
			panel('dev_panel_compact', { compact: true, title: 'Compact' }, 'A smaller header and inset.'),
			panel('dev_panel_flush', { flush: true }, 'Flush: content meets the border.'),
			panel('dev_panel_corners', { corners: true, kicker: 'Target', title: 'Rust Buggy' }, 'Bracket ticks in the accent.'),
			panel('dev_panel_glow', { corners: true, glow: true, accent: 'data', title: 'Selected' }, 'The data accent, glowing.'),
		]));
		this.addChild(rows);
	}
}

/** A caption over panels that wrap at the section's width. */
function row(text: string, panels: Component[]): Stack {
	const column = new Stack({ gap: CAPTION_GAP, widthMode: 'fill' });
	column.addChild(caption(text));
	const gap = tokens.space.space_6;
	const line = new FlowWrap({ widthMode: 'fill', gap, rowGap: gap });
	panels.forEach((item) => line.addChild(item));
	column.addChild(line);
	return column;
}

function panel(id: string, options: PanelOptions, text: string): Panel {
	const box = new Panel({ id, width: PANEL_WIDTH, height: PANEL_HEIGHT, gap: tokens.space.space_2, ...options });
	box.addChild(body(text));
	return box;
}
