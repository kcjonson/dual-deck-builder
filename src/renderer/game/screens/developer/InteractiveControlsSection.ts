import { DeveloperSectionPanel, DeveloperSectionOptions } from './DeveloperSectionPanel';
import type { Component } from '../../../engine/components/Component';
import { Container } from '../../../engine/components/Container';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { TextInput } from '../../../engine/ui/TextInput';
import { Button } from '../../../engine/ui/Button';

const DEMO_SIZE = 100;
/** Room for the rectangle to move down as well as across. */
const STAGE_HEIGHT = 160;

/**
 * Property changes driven by text fields: a rectangle's colour as R,G,B,A and
 * its position inside its stage as X,Y, held inside the stage so it never
 * covers the fields below, applied as the fields change or all
 * at once with the button.
 */
export class InteractiveControlsSection extends DeveloperSectionPanel {
	private readonly stage: Container;
	private readonly demoRectangle: Rectangle;
	private readonly colorInput: TextInput;
	private readonly positionInput: TextInput;

	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_interactive_controls', title: 'Interactive Controls', ...options });

		// The rectangle moves by hand inside a stage of its own, out of the flow.
		this.stage = new Container({
			id: 'dev_controls_stage',
			widthMode: 'fill',
			height: STAGE_HEIGHT,
			// A resize that narrows the section pulls the rectangle back inside
			onLayout: () => this.placeDemo(this.demoRectangle.x, this.demoRectangle.y),
		});
		this.demoRectangle = new Rectangle({
			width: DEMO_SIZE,
			height: DEMO_SIZE,
			style: { backgroundColor: '#ff6600', borderRadius: 10 },
		});
		this.stage.addChild(this.demoRectangle);

		this.colorInput = new TextInput({
			placeholder: 'e.g., 255,102,0,1',
			value: '255,102,0,1',
			width: 200,
			height: 30,
			style: { fontSize: 14 },
			onChange: (value) => this.applyColor(value),
		});
		this.positionInput = new TextInput({
			placeholder: 'e.g., 120,40',
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
		column.addChild(this.stage);
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
		this.placeDemo(x, y);
	}

	/** Inside the stage, so it never covers the fields below or runs past a narrower section. */
	private placeDemo(x: number, y: number): void {
		const clamp = (value: number, room: number): number => Math.min(Math.max(value, 0), Math.max(room - DEMO_SIZE, 0));
		const clampedX = clamp(x, this.stage.width);
		const clampedY = clamp(y, this.stage.height);
		if (clampedX !== this.demoRectangle.x || clampedY !== this.demoRectangle.y) this.demoRectangle.setPosition(clampedX, clampedY);
	}
}

/** A label over its control. */
function field(label: string, control: Component): Stack {
	const group = new Stack({ gap: 5 });
	group.addChild(new Text(label, { style: { fontSize: 16, color: 'text_bright' } }));
	group.addChild(control);
	return group;
}
