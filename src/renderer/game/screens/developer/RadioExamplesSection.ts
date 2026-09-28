import { CatalogSection } from './CatalogSection';
import { tokens } from '../../../engine/theme/tokens';
import { RadioGroup } from '../../../engine/ui/RadioGroup';

/**
 * R12.35: a vertical radio group with a selection and a disabled option,
 * and a horizontal one with nothing selected. Each is one Tab stop; the
 * arrows move the selection.
 */
export class RadioExamplesSection extends CatalogSection {
	constructor(x: number, y: number, width: number) {
		super({ id: 'dev_section_radio_group', title: 'Radio Groups', x, y, width });
		const md = tokens.control.control_h_md;

		const difficulty = new RadioGroup({
			id: 'dev_radio_difficulty',
			value: 'normal',
			options: [
				{ label: 'Easy', value: 'easy' },
				{ label: 'Normal', value: 'normal' },
				{ label: 'Hard (locked)', value: 'hard', disabled: true },
				{ label: 'Brutal', value: 'brutal' },
			],
		});
		this.addRow('vertical, with a selection and a disabled option', difficulty, md * 4 + tokens.space.space_1 * 3);

		const quality = new RadioGroup({
			id: 'dev_radio_quality',
			direction: 'horizontal',
			gap: tokens.space.space_6,
			options: [
				{ label: 'Low', value: 'low' },
				{ label: 'Medium', value: 'medium' },
				{ label: 'High', value: 'high' },
			],
		});
		this.addRow('horizontal, nothing selected', quality, md);
	}
}
