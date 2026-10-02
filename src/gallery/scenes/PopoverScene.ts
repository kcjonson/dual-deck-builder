import type { Component } from '../../renderer/engine/components/Component';
import { Stack } from '../../renderer/engine/components/Stack';
import { Text } from '../../renderer/engine/components/Text';
import { tokens } from '../../renderer/engine/theme/tokens';
import { Button } from '../../renderer/engine/ui/Button';
import { KeyCap } from '../../renderer/engine/ui/KeyCap';
import { Popover } from '../../renderer/engine/ui/Popover';
import { rgba } from '../../renderer/engine/ui/surfaces';
import { DeveloperSectionPanel } from '../../renderer/game/screens/developer/DeveloperSectionPanel';
import type { SceneFactoryOptions } from '../registry';

const CONTENT_HEIGHT = 380;
const ROW_Y = 96;
const BUTTON_WIDTH = 150;
const BUTTON_GAP = 20;

type Stat = [label: string, value: string];

const BREAKDOWN: readonly Stat[] = [
	['Base damage', '4'],
	['Rammer plating', '+2'],
	['Driver: Rook', '+1'],
	['Target shielded', '-3'],
];

/**
 * R12.33's popover and R12.29's key caps. A stat breakdown is open against
 * its button, placed by the placement service below it; the other buttons
 * open their own, each replacing the last. A row of key caps shows the
 * sizes a hotkey hint comes in.
 *
 * Gallery only: the popover is an overlay root over whatever hosts it.
 */
export class PopoverScene extends DeveloperSectionPanel {
	private popover: Popover | null = null;
	private opened = false;

	constructor({ x, y, width }: SceneFactoryOptions) {
		super({ id: 'gallery_scene_popover', title: 'Popover and key caps', contentHeight: CONTENT_HEIGHT, x, y, width });

		this.addChild(new Text('Anchored and non-modal: a press outside closes it and still reaches what it landed on.', {
			y: 50,
			style: { fontSize: 14, color: rgba(tokens.color.text_dim) },
		}));

		const damage = new Button('Damage', { id: 'popover_damage', x: 0, y: ROW_Y, width: BUTTON_WIDTH });
		const armor = new Button('Armor', { id: 'popover_armor', x: BUTTON_WIDTH + BUTTON_GAP, y: ROW_Y, width: BUTTON_WIDTH });
		damage.onClick = () => this.openBreakdown(damage, BREAKDOWN, 'bottom');
		armor.onClick = () => this.openBreakdown(armor, [['Hull', '6'], ['Shield', '+2']], 'right');
		this.addChild(damage);
		this.addChild(armor);

		const caps = new Stack({ id: 'popover_key_caps', x: 0, y: 320, direction: 'horizontal', gap: tokens.space.space_3, crossAlign: 'center' });
		caps.addChild(new Text('Key caps', { style: { fontSize: 13, color: rgba(tokens.color.text_dim) } }));
		for (const label of ['R', 'Esc', 'Shift', 'Tab']) caps.addChild(new KeyCap({ id: `key_cap_${label.toLowerCase()}`, label }));
		caps.addChild(new KeyCap({ id: 'key_cap_md_space', label: 'Space', size: 'md' }));
		caps.addChild(new KeyCap({ id: 'key_cap_md_enter', label: 'Enter', size: 'md' }));
		this.addChild(caps);

		this.onLayout = () => {
			if (this.opened) return;
			this.opened = true;
			this.openBreakdown(damage, BREAKDOWN, 'bottom');
		};
	}

	protected onUnmount(): void {
		this.popover?.close();
		this.popover = null;
	}

	private openBreakdown(anchor: Button, stats: readonly Stat[], side: 'bottom' | 'right'): void {
		const context = this.context;
		if (!context) return;
		this.popover?.close();
		this.popover = new Popover({ id: `${anchor.id}_popover`, content: breakdown(anchor.label, stats), anchor, preferredSide: side });
		this.popover.show(context);
	}
}

/** Label and value per row, the value right-aligned in a mono column. */
function breakdown(title: string, stats: readonly Stat[]): Component {
	const column = new Stack({ direction: 'vertical', gap: tokens.space.space_1_5 });
	column.addChild(new Text(title, { style: { fontRole: 'display', fontSize: tokens.fontSize.fs_md, color: rgba(tokens.color.text_bright), textTransform: 'uppercase' } }));
	for (const [label, value] of stats) {
		const row = new Stack({ direction: 'horizontal', width: 180, distribution: 'spaceBetween' });
		row.addChild(new Text(label, { style: { fontSize: tokens.fontSize.fs_sm, color: rgba(tokens.color.text_dim) } }));
		row.addChild(new Text(value, { style: { fontRole: 'mono', fontSize: tokens.fontSize.fs_sm, color: rgba(tokens.color.text) } }));
		column.addChild(row);
	}
	return column;
}
