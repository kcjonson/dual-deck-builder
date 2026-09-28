import { CatalogSection } from './CatalogSection';
import { tokens } from '../../../engine/theme/tokens';
import { Button } from '../../../engine/ui/Button';
import { FocusGroup } from '../../../engine/ui/FocusGroup';
import { ListRow } from '../../../engine/ui/ListRow';

const ROW_HEIGHT = tokens.control.control_h_sm;

/**
 * R12.8's list row inside R12.34's focus group: plain, selected (the wash
 * and the accent bar), dim, indented, disabled, and truncated, with
 * trailing mono text; the list is one Tab stop with arrows between the rows
 * and selects on click. Below it, a horizontal focus group of icon-only
 * ghost buttons: a toolbar with no selection.
 */
export class ListExamplesSection extends CatalogSection {
	constructor(x: number, y: number, width: number) {
		super({ id: 'dev_section_lists', title: 'Lists', x, y, width });

		const list = new FocusGroup({ id: 'dev_list', width: 300, selection: 'single' });
		list.setBackgroundColor([...tokens.color.bg_inset] as [number, number, number, number]);
		const rows = [
			new ListRow({ id: 'dev_list_row_plain', label: 'Scrapyard Hauler', trailing: '12' }),
			new ListRow({ id: 'dev_list_row_selected', label: 'Road Warden', trailing: '8' }),
			new ListRow({ id: 'dev_list_row_dim', label: 'Dust Runner', trailing: '5', dim: true }),
			new ListRow({ id: 'dev_list_row_indent', label: 'Armor plating', trailing: '+2', indent: tokens.space.space_4 }),
			new ListRow({ id: 'dev_list_row_disabled', label: 'Locked blueprint', enabled: false }),
			new ListRow({ id: 'dev_list_row_long', label: 'A salvage manifest far too long for the row it sits in', trailing: '99' }),
		];
		rows.forEach((row) => list.addChild(row));
		list.select([rows[1]]);

		const toolbar = new FocusGroup({ id: 'dev_toolbar', orientation: 'horizontal', gap: tokens.space.space_1 });
		const tools = [['arrow_back', 'Back'], ['build', 'Repair'], ['local_gas_station', 'Refuel'], ['settings', 'Settings']] as const;
		for (const [glyph, label] of tools) {
			toolbar.addChild(new Button(label, { icon: glyph, iconPosition: 'only', ghost: true, width: tokens.control.control_h_md }));
		}

		this.addRow('list: plain, selected, dim, indented, disabled, truncated', list, ROW_HEIGHT * rows.length);
		this.addRow('toolbar: a horizontal focus group of ghost icon buttons', toolbar, tokens.control.control_h_md);
	}
}
