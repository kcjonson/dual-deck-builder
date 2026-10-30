import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
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
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_button_variants', title: 'Button Variants', ...options });

		this.addRow('iconPosition: left, right, only (md and sm)', this.line([
			new Button({ label: 'Back', id: 'dev_button_icon_left', icon: 'arrow_back', width: 120 }),
			new Button({ label: 'Settings', id: 'dev_button_icon_right', icon: 'settings', iconPosition: 'right', width: 140 }),
			new Button({ label: 'Settings', id: 'dev_button_icon_only', icon: 'settings', iconPosition: 'only', width: HEIGHT }),
			new Button({ label: 'Repair', id: 'dev_button_icon_only_sm', icon: 'build', iconPosition: 'only', size: 'sm', width: tokens.control.control_h_sm }),
		]));

		this.addRow('ghost: default, accent, data, crit, with an icon, disabled', this.line([
			new Button({ label: 'Cancel', ghost: true, width: 110 }),
			new Button({ label: 'Confirm', ghost: true, tone: 'accent', width: 110 }),
			new Button({ label: 'Inspect', ghost: true, tone: 'data', width: 110 }),
			new Button({ label: 'Discard', ghost: true, tone: 'crit', width: 110 }),
			new Button({ label: 'Refuel', ghost: true, icon: 'local_gas_station', width: 120 }),
			new Button({ label: 'Locked', ghost: true, tone: 'accent', disabled: true, width: 110 }),
		]));

		const column = new Stack({ id: 'dev_button_block_column', width: 360, gap: tokens.space.space_2 });
		column.addChild(new Button({ label: 'Start Run', id: 'dev_button_block', tone: 'accent', block: true }));
		column.addChild(new Button({ label: 'Unavailable', id: 'dev_button_disabled', block: true, disabled: true }));
		this.addRow('block: fills a 360 px column; disabled at construction', column);
	}
}
