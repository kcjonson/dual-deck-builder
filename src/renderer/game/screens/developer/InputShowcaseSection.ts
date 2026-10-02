import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import { NumberInput } from '../../../engine/ui/NumberInput';
import { TextInput } from '../../../engine/ui/TextInput';

/**
 * R12.10 and R12.36: text fields empty with a placeholder, filled, masked,
 * and disabled; a value longer than its field, scrolled to the caret at its
 * end and clipped to the padded box (chapter 4's overflowing-field fixture
 * on the real component); the three sizes; an instance style; then number
 * inputs, integer, stepped by a quarter, pinned at their maximum (the up
 * chevron greyed), and disabled.
 */
export class InputShowcaseSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_input_showcase', title: 'Input Fields', ...options });

		this.addRow('text input: placeholder, value, password, disabled', this.line([
			new TextInput({ id: 'dev_text_empty', placeholder: 'Driver name', width: 200 }),
			new TextInput({ id: 'dev_text_filled', value: 'Rust Runner', width: 200 }),
			new TextInput({ id: 'dev_text_password', value: 'hunter2', password: true, width: 160 }),
			new TextInput({ id: 'dev_text_disabled', value: 'Locked', disabled: true, width: 160 }),
		]));

		this.addRow('overflow: scrolled to the caret at the end, clipped to the padded box', this.line([
			new TextInput({ id: 'dev_text_overflow', value: 'Scrap Hauler, Rust Runner and the Dustbowl Convoy', width: 300 }),
		]));

		this.addRow('sizes: sm, md, lg; instance style', this.line([
			new TextInput({ placeholder: 'Small', size: 'sm', width: 140 }),
			new TextInput({ placeholder: 'Medium', size: 'md', width: 140 }),
			new TextInput({ placeholder: 'Large', size: 'lg', width: 140 }),
			new TextInput({
				id: 'dev_text_styled',
				value: 'Custom style',
				width: 200,
				style: {
					backgroundColor: 'bg_void',
					color: 'status_ok',
					borderColor: 'status_ok',
					borderRadius: 'r_pill',
					padding: { left: 'space_4', right: 'space_4' },
				},
			}),
		]));

		this.addRow('number input: integer, step 0.25, at its max, disabled', this.line([
			new NumberInput({ id: 'dev_number_int', value: 3, min: 0, max: 10, width: 110 }),
			new NumberInput({ id: 'dev_number_step', value: 1.5, min: 0, max: 5, step: 0.25, width: 110 }),
			new NumberInput({ id: 'dev_number_max', value: 10, min: 0, max: 10, width: 110 }),
			new NumberInput({ id: 'dev_number_disabled', value: 7, disabled: true, width: 110 }),
		]));
	}
}
