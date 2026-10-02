import { CatalogSection } from './CatalogSection';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { tokens } from '../../../engine/theme/tokens';
import { ContextMenu } from '../../../engine/ui/ContextMenu';
import { DropdownButton } from '../../../engine/ui/DropdownButton';
import { Menu, MenuItem } from '../../../engine/ui/Menu';
import { Select, SelectOption } from '../../../engine/ui/Select';

const { control, space } = tokens;

const VEHICLES: SelectOption[] = [
	{ label: 'Scrap Hauler', value: 'hauler' },
	{ label: 'Rust Runner', value: 'runner' },
	{ label: 'Dust Devil', value: 'devil' },
	{ label: 'Tin Can', value: 'can', enabled: false },
];

const CONVOY: SelectOption[] = Array.from({ length: 20 }, (_, index) => ({ label: `Rig ${index + 1}`, value: `rig_${index + 1}` }));

const ACTIONS: MenuItem[] = [
	{ label: 'Inspect', shortcut: 'I' },
	{ label: 'Repair', shortcut: 'R' },
	{ label: 'Refuel', shortcut: 'F', enabled: false },
	{ separator: true },
	{ label: 'Scrap vehicle', shortcut: 'DEL' },
];

const MENU_WIDTH = 220;

/**
 * R12.11 to R12.14: a menu drawn in place (separators, shortcuts, a disabled
 * item, the second row highlighted as the pointer or keys would leave it);
 * selects with a value, a placeholder, and disabled; dropdown buttons opening
 * down and up; and a pad that opens a context menu on a right-click or a
 * touch hold. Popups open in the `popup` layer on use; the golden holds the
 * closed controls and the in-place menu.
 */
export class MenuExamplesSection extends CatalogSection {
	constructor(x: number, y: number, width: number) {
		super({ id: 'dev_section_menus', title: 'Menus and Selects', x, y, width });

		const menu = new Menu({ id: 'dev_menu_inline', items: ACTIONS, width: MENU_WIDTH });
		menu.hoveredIndex = 1;
		this.addRow('menu: shortcuts, a disabled item, a separator, the second row highlighted', this.line([menu]), menu.height);

		this.addRow('select: twenty options scrolling in 160 px; a value, a placeholder, disabled (their fourth option is disabled)', this.line([
			new Select({ id: 'dev_select_long', options: CONVOY, value: 'rig_9', maxMenuHeight: 160, width: 200 }),
			new Select({ id: 'dev_select_value', options: VEHICLES, value: 'runner', width: 200 }),
			new Select({ id: 'dev_select_empty', options: VEHICLES, placeholder: 'Pick a vehicle', width: 200 }),
			new Select({ id: 'dev_select_disabled', options: VEHICLES, value: 'hauler', disabled: true, width: 200 }),
		]), control.control_h_md);

		this.addRow('dropdown button: opens down, opens up, accent tone, disabled', this.line([
			new DropdownButton('Actions', { id: 'dev_dropdown', items: ACTIONS, width: 140 }),
			new DropdownButton('Upward', { id: 'dev_dropdown_up', items: ACTIONS, openUpward: true, width: 140, menuWidth: MENU_WIDTH }),
			new DropdownButton('Deploy', { id: 'dev_dropdown_accent', items: ACTIONS, tone: 'accent', width: 140, menuWidth: MENU_WIDTH }),
			new DropdownButton('Locked', { items: ACTIONS, disabled: true, width: 140 }),
		]), control.control_h_md);

		this.addRow('context menu: right-click or touch-hold the pad', this.contextPad(), CONTEXT_PAD_HEIGHT);
	}

	private contextPad(): Stack {
		const pad = new Stack({
			id: 'dev_context_pad',
			width: 360,
			height: CONTEXT_PAD_HEIGHT,
			pointerEvents: 'auto',
			padding: space.space_3,
			style: { backgroundColor: 'bg_inset' },
		});
		pad.addChild(new Text('Right-click here', { style: { fontSize: control.control_fs_sm, color: 'text_faint' } }));
		const menu = new ContextMenu({ id: 'dev_context_menu', items: ACTIONS, width: MENU_WIDTH });
		pad.onContextMenu = (event) => menu.openAt(event.screen, { from: pad });
		return pad;
	}
}

const CONTEXT_PAD_HEIGHT = 80;
