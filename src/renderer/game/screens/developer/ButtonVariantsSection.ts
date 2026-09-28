import { CatalogSection } from './CatalogSection';
import { Stack } from '../../../engine/components/Stack';
import { tokens } from '../../../engine/theme/tokens';
import { Button } from '../../../engine/ui/Button';

const HEIGHT = tokens.control.control_h_md;

/**
 * R12.7's options beyond tone and size (those are the `buttons` scene's):
 * `iconPosition` left, right, and only; the ghost variant in each tone,
 * resting and disabled; `block` filling its column; and `disabled` given at
 * construction.
 */
export class ButtonVariantsSection extends CatalogSection {
	constructor(x: number, y: number, width: number) {
		super({ id: 'dev_section_button_variants', title: 'Button Variants', x, y, width });

		this.addRow('iconPosition: left, right, only (md and sm)', this.line([
			new Button('Back', { id: 'dev_button_icon_left', icon: 'arrow_back', width: 120 }),
			new Button('Settings', { id: 'dev_button_icon_right', icon: 'settings', iconPosition: 'right', width: 140 }),
			new Button('Settings', { id: 'dev_button_icon_only', icon: 'settings', iconPosition: 'only', width: HEIGHT }),
			new Button('Repair', { id: 'dev_button_icon_only_sm', icon: 'build', iconPosition: 'only', size: 'sm', width: tokens.control.control_h_sm }),
		]), HEIGHT);

		this.addRow('ghost: default, accent, data, crit, with an icon, disabled', this.line([
			new Button('Cancel', { ghost: true, width: 110 }),
			new Button('Confirm', { ghost: true, tone: 'accent', width: 110 }),
			new Button('Inspect', { ghost: true, tone: 'data', width: 110 }),
			new Button('Discard', { ghost: true, tone: 'crit', width: 110 }),
			new Button('Refuel', { ghost: true, icon: 'local_gas_station', width: 120 }),
			new Button('Locked', { ghost: true, tone: 'accent', disabled: true, width: 110 }),
		]), HEIGHT);

		const column = new Stack({ id: 'dev_button_block_column', width: 360, gap: tokens.space.space_2 });
		column.addChild(new Button('Start Run', { id: 'dev_button_block', tone: 'accent', block: true }));
		column.addChild(new Button('Unavailable', { id: 'dev_button_disabled', block: true, disabled: true }));
		this.addRow('block: fills a 360 px column; disabled at construction', column, HEIGHT * 2 + tokens.space.space_2);
	}
}
