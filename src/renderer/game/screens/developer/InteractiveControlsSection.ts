import { DeveloperSectionPanel, DeveloperSectionOptions } from './DeveloperSectionPanel';
import type { Component } from '../../../engine/components/Component';
import { Container } from '../../../engine/components/Container';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { TextInput } from '../../../engine/ui/TextInput';
import { Button } from '../../../engine/ui/Button';

const DEMO_SIZE = 100;

/**
 * Property changes driven by text fields: a rectangle's colour as R,G,B,A and
 * its position inside its stage as X,Y, applied as the fields change or all
 * at once with the button.
 */
export class InteractiveControlsSection extends DeveloperSectionPanel {
	private readonly demoRectangle: Rectangle;
	private readonly colorInput: TextInput;
	private readonly positionInput: TextInput;

	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_interactive_controls', title: 'Interactive Controls', ...options });

		// The rectangle moves by hand inside a stage of its own, out of the flow.
		const stage = new Container({ id: 'dev_controls_stage', widthMode: 'fill', height: DEMO_SIZE });
		this.demoRectangle = new Rectangle({
			width: DEMO_SIZE,
			height: DEMO_SIZE,
			style: { backgroundColor: '#ff6600', borderRadius: 10 },
		});
		stage.addChild(this.demoRectangle);

		this.colorInput = new TextInput({
			placeholder: 'e.g., 255,102,0,1',
			value: '255,102,0,1',
			width: 200,
			height: 30,
			style: { fontSize: 14 },
			onChange: (value) => this.applyColor(value),
		});
		this.positionInput = new TextInput({
			placeholder: 'e.g., 0,0',
			value: '0,0',
			width: 150,
			height: 30,
			style: { fontSize: 14 },
			onChange: (value) => this.applyPosition(value),
		});
		const apply = new Button('Apply All', { width: 100, height: 30 });
		apply.onClick = () => {
			this.applyColor(this.colorInput.value);
			this.applyPosition(this.positionInput.value);
		};
		const positionRow = new Stack({ direction: 'horizontal', gap: 10 });
		positionRow.addChild(this.positionInput);
		positionRow.addChild(apply);

		const column = new Stack({ gap: 20, padding: { left: 20 }, widthMode: 'fill' });
		column.addChild(stage);
		column.addChild(field('Color (R,G,B,A):', this.colorInput));
		column.addChild(field('Position (X,Y):', positionRow));
		this.addChild(column);
	}

	private applyColor(value: string): void {
		const parts = value.split(',').map((part) => parseFloat(part.trim()));
		if (parts.length !== 4 || parts.some((part) => isNaN(part))) return;
		const [r, g, b, a] = parts;
		this.demoRectangle.setFillColor([r / 255, g / 255, b / 255, a]);
	}

	private applyPosition(value: string): void {
		const parts = value.split(',').map((part) => parseInt(part.trim(), 10));
		if (parts.length !== 2 || parts.some((part) => isNaN(part))) return;
		const [x, y] = parts;
		this.demoRectangle.setPosition(x, y);
	}
}

/** A label over its control. */
function field(label: string, control: Component): Stack {
	const group = new Stack({ gap: 5 });
	group.addChild(new Text(label, { style: { fontSize: 16, color: 'text_bright' } }));
	group.addChild(control);
	return group;
}
