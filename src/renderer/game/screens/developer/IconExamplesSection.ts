import { DeveloperSectionPanel, DeveloperSectionOptions } from './DeveloperSectionPanel';
import { FlowWrap } from '../../ui/FlowWrap';
import type { Component } from '../../../engine/components/Component';
import { Button } from '../../../engine/ui/Button';
import { Icon } from '../../../engine/components/Icon';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { ICON_CODE_POINTS, IconName } from '../../../engine/text/icons';
import { tokens } from '../../../engine/theme/tokens';
import { StatusChip, StatusChipContent, shieldChipContent, statusChipContent } from '../../ui/StatusChip';
import { EnemyIntent, IntentPill } from '../../ui/IntentPill';

const ICON_SIZES = [12, 16, 24];
const LABEL_WIDTH = 70;
/** Each glyph's cell, so the three sizes line up in columns. */
const ICON_PITCH = 40;
const ROW_HEIGHT = 44;
const ICONS_PER_ROW = 12;
const BLOCK_GAP = 40;
/** A badge's fill around its glyph. */
const BADGE_INSET = 4;

/**
 * Every icon in the atlas (R12.6) at three sizes, bare and on a badge fill,
 * then the game sites that draw them: a button with a leading icon beside one
 * without, the four enemy intents, and a vehicle's status chips. The badged
 * glyphs sit beside the bare ones where the section is wide enough and wrap
 * under them where it is not. An icon added to icons.txt shows up here
 * without touching this file.
 */
export class IconExamplesSection extends DeveloperSectionPanel {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_icons', title: 'Icons', ...options });

		const names = Object.keys(ICON_CODE_POINTS) as IconName[];
		const column = new Stack({ gap: 10, padding: { left: 20 }, widthMode: 'fill' });

		const grids = new FlowWrap({ id: 'dev_icons_grids', widthMode: 'fill', gap: BLOCK_GAP, rowGap: 10 });
		grids.addChild(grid('bare', names, (glyph, size) => new Icon({ glyph, size, tint: tokens.color.text }), 0));
		grids.addChild(grid('on a badge fill', names, badge, BADGE_INSET * 2));
		column.addChild(grids);

		column.addChild(labelledRow('Buttons', [
			new Button({ label: 'Back to Menu', id: 'dev_icons_button_with_icon', icon: 'arrow_back', width: 200, height: 50 }),
			new Button({ label: 'Back to Menu', id: 'dev_icons_button_without_icon', width: 200, height: 50 }),
		], 20));

		const intents: EnemyIntent[] = [
			{ type: 'attack', value: 8, description: 'attack', target: 'driver1' },
			{ type: 'defend', value: 6, description: 'defend' },
			{ type: 'repair', value: 4, description: 'repair' },
			{ type: 'debuff', description: 'debuff', target: 'driver2' },
			{ type: 'buff', description: 'buff' },
			{ type: 'special', description: 'special' },
		];
		column.addChild(labelledRow('Intents', intents.map((intent) => {
			const pill = new IntentPill({ id: `dev_icons_intent_${intent.type}` });
			pill.intent = intent;
			return pill;
		}), 8));

		const statuses: StatusChipContent[] = [
			statusChipContent({ name: 'vulnerable', duration: 2 }),
			statusChipContent({ name: 'speed_boost', duration: 3 }),
			statusChipContent({ name: 'burn', duration: -1 }),
			shieldChipContent(12),
			{ kind: 'label', text: 'SPENT', title: 'Spent' },
			{ kind: 'more', count: 3, detail: 'three more' },
		];
		column.addChild(labelledRow('Statuses', statuses.map((content, index) => {
			const chip = new StatusChip({ id: `dev_icons_status_${index}` });
			chip.chip = content;
			return chip;
		}), 8));

		this.addChild(column);
	}
}

/**
 * A captioned block of every glyph at each size, each glyph `extra` wider
 * than its size and pitched `ICON_PITCH` apart, a size's glyphs in rows of
 * `ICONS_PER_ROW` so the block fits the developer screen at 1024 wide.
 */
function grid(caption: string, names: readonly IconName[], make: (glyph: IconName, size: number) => Component, extra: number): Stack {
	const block = new Stack({ gap: 4 });
	block.addChild(new Text({ text: caption, style: { fontSize: tokens.fontSize.fs_base, color: 'text_dim' } }));
	for (const size of ICON_SIZES) {
		for (let start = 0; start < names.length; start += ICONS_PER_ROW) {
			const glyphs = new Stack({ direction: 'horizontal', gap: ICON_PITCH - size - extra, crossAlign: 'center', height: ROW_HEIGHT });
			for (const glyph of names.slice(start, start + ICONS_PER_ROW)) glyphs.addChild(make(glyph, size));
			block.addChild(labelledRow(start === 0 ? `${size} px` : '', [glyphs], 0));
		}
	}
	return block;
}

/** A glyph on a badge fill, as the HUD draws it. */
function badge(glyph: IconName, size: number): Rectangle {
	const badgeSize = size + BADGE_INSET * 2;
	const fill = new Rectangle({
		width: badgeSize,
		height: badgeSize,
		style: {
			backgroundColor: '#8a6a4a',
			borderColor: '#ffffff',
			borderWidth: 1,
			borderRadius: Math.floor(badgeSize / 4),
		},
	});
	fill.addChild(new Icon({ glyph, size, tint: tokens.color.text_bright, x: BADGE_INSET, y: BADGE_INSET }));
	return fill;
}

/** A label in the left column, then `items` in a row, centred across. */
function labelledRow(label: string, items: Component[], gap: number): Stack {
	const row = new Stack({ direction: 'horizontal', crossAlign: 'center' });
	row.addChild(new Text({ text: label, width: LABEL_WIDTH, style: { fontSize: 14, color: '#cccccc' } }));
	const content = new Stack({ direction: 'horizontal', gap, crossAlign: 'center' });
	for (const item of items) content.addChild(item);
	row.addChild(content);
	return row;
}
