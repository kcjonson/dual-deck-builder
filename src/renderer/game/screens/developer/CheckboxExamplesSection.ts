import { CatalogSection } from './CatalogSection';
import { tokens } from '../../../engine/theme/tokens';
import { Checkbox } from '../../../engine/ui/Checkbox';
import { Toggle } from '../../../engine/ui/Toggle';

/**
 * R12.9: checkboxes unchecked, checked, indeterminate, and disabled both
 * ways; toggles off, on, and disabled both ways; then the small and large
 * sizes of each (R11.10). Every row is a single hit area, label included.
 */
export class CheckboxExamplesSection extends CatalogSection {
	constructor(x: number, y: number, width: number) {
		super({ id: 'dev_section_checkboxes', title: 'Checkboxes and Toggles', x, y, width });
		const md = tokens.control.control_h_md;

		this.addRow('checkbox: off, on, indeterminate, disabled off, disabled on', this.line([
			new Checkbox({ id: 'dev_check_off', label: 'Damage numbers' }),
			new Checkbox({ id: 'dev_check_on', label: 'Screen shake', checked: true }),
			new Checkbox({ id: 'dev_check_mixed', label: 'All effects', indeterminate: true }),
			new Checkbox({ id: 'dev_check_disabled', label: 'Tutorial', disabled: true }),
			new Checkbox({ id: 'dev_check_disabled_on', label: 'Autosave', checked: true, disabled: true }),
		]), md);

		this.addRow('toggle: off, on, disabled off, disabled on', this.line([
			new Toggle({ id: 'dev_toggle_off', label: 'Music' }),
			new Toggle({ id: 'dev_toggle_on', label: 'Sound', checked: true }),
			new Toggle({ id: 'dev_toggle_disabled', label: 'Voice', disabled: true }),
			new Toggle({ id: 'dev_toggle_disabled_on', label: 'Fullscreen', checked: true, disabled: true }),
		]), md);

		this.addRow('sizes: sm and lg', this.line([
			new Checkbox({ label: 'Small', size: 'sm', checked: true }),
			new Checkbox({ label: 'Large', size: 'lg', checked: true }),
			new Toggle({ label: 'Small', size: 'sm', checked: true }),
			new Toggle({ label: 'Large', size: 'lg' }),
		]), tokens.control.control_h_lg);
	}
}
