import { DeveloperSectionPanel } from './DeveloperSectionPanel';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { TextInput } from '../../../engine/ui/TextInput';
import { Button } from '../../../engine/ui/Button';

/**
 * Interactive controls section for the developer screen
 * Demonstrates dynamic property changes through input controls
 */
export class InteractiveControlsSection extends DeveloperSectionPanel {
	private demoRectangle!: Rectangle;

	constructor(x: number, y: number, width: number) {
		super({ id: 'dev_section_interactive_controls', x, y, width });

		this.initializeContent();
	}

	private initializeContent(): void {
		const sectionTitle = new Text('Interactive Controls', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		sectionTitle.setPosition(0, 0);
		this.addChild(sectionTitle);

		let currentY = 50;

		// Create demo rectangle to control
		this.demoRectangle = new Rectangle({
			width: 100,
			height: 100,
			style: {
				backgroundColor: '#ff6600',
				borderRadius: 10,
			},
		});
		this.demoRectangle.setPosition(20, currentY);
		this.addChild(this.demoRectangle);
		currentY += 120;

		// Color controls
		const colorLabel = new Text('Color (R,G,B,A):', {
			style: {
				fontSize: 16,
				color: '#ffffff',
			},
		});
		colorLabel.setPosition(20, currentY);
		this.addChild(colorLabel);
		currentY += 25;

		const colorInput = new TextInput({
			placeholder: 'e.g., 255,102,0,1',
			value: '255,102,0,1',
			x: 20,
			y: currentY,
			width: 200,
			height: 30,
			style: {
				fontSize: 14,
			},
			onChange: (value) => {
				const parts = value.split(',').map((v) => parseFloat(v.trim()));
				if (parts.length === 4 && parts.every((v) => !isNaN(v))) {
					const [r, g, b, a] = parts;
					this.demoRectangle.setFillColor([r / 255, g / 255, b / 255, a]);
				}
			},
		});
		this.addChild(colorInput);
		currentY += 40;

		// Position controls
		const positionLabel = new Text('Position (X,Y):', {
			style: {
				fontSize: 16,
				color: '#ffffff',
			},
		});
		positionLabel.setPosition(20, currentY);
		this.addChild(positionLabel);
		currentY += 25;

		const positionInput = new TextInput({
			placeholder: 'e.g., 20,50',
			value: '20,50',
			x: 20,
			y: currentY,
			width: 150,
			height: 30,
			style: {
				fontSize: 14,
			},
			onChange: (value) => {
				const parts = value.split(',').map((v) => parseInt(v.trim()));
				if (parts.length === 2 && parts.every((v) => !isNaN(v))) {
					const [x, y] = parts;
					this.demoRectangle.setPosition(x, y);
				}
			},
		});
		this.addChild(positionInput);

		// Update button
		const updateButton = new Button('Apply All', {
			width: 100,
			height: 30,
		});
		updateButton.setPosition(180, currentY);
		updateButton.onClick = () => {
			// Force update all inputs
			const colorValue = colorInput.value;
			const posValue = positionInput.value;
			
			// Re-apply the values
			const colorParts = colorValue.split(',').map((v) => parseFloat(v.trim()));
			if (colorParts.length === 4 && colorParts.every((v) => !isNaN(v))) {
				const [r, g, b, a] = colorParts;
				this.demoRectangle.setFillColor([r / 255, g / 255, b / 255, a]);
			}
			
			const posParts = posValue.split(',').map((v) => parseInt(v.trim()));
			if (posParts.length === 2 && posParts.every((v) => !isNaN(v))) {
				const [x, y] = posParts;
				this.demoRectangle.setPosition(x, y);
			}
		};
		this.addChild(updateButton);

		// Update our height based on content
		this.fitContentHeight(currentY + 40);
	}

	/**
	 * Get the height of this section
	 */
	public getHeight(): number {
		return this.height;
	}
}