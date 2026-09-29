import { DeveloperSectionPanel } from './DeveloperSectionPanel';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';

/**
 * Style guide section for the developer screen
 * Displays color palettes and theme examples
 */
export class StyleGuideSection extends DeveloperSectionPanel {
	constructor(x: number, y: number, width: number) {
		super({ id: 'dev_section_style_guide', x, y, width });

		this.initializeContent();
	}

	private initializeContent(): void {
		const sectionTitle = new Text('Style Guide', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		sectionTitle.setPosition(0, 0);
		this.addChild(sectionTitle);

		let currentY = 50;

		// Color Palette
		const paletteLabel = new Text('Color Palette:', {
			style: {
				fontSize: 20,
				color: '#ffffff',
			},
		});
		paletteLabel.setPosition(20, currentY);
		this.addChild(paletteLabel);
		currentY += 30;

		const colors = [
			{ name: 'Primary', value: '#3366ff' },
			{ name: 'Secondary', value: '#ff6600' },
			{ name: 'Success', value: '#00cc66' },
			{ name: 'Warning', value: '#ffcc00' },
			{ name: 'Danger', value: '#ff3333' },
			{ name: 'Info', value: '#33ccff' },
			{ name: 'Dark', value: '#333333' },
			{ name: 'Light', value: '#f0f0f0' },
		];

		let colorX = 20;
		let colorY = currentY;
		const colorBoxSize = 60;
		const colorSpacing = 70;

		colors.forEach((color, index) => {
			if (index > 0 && index % 4 === 0) {
				colorX = 20;
				colorY += colorBoxSize + 30;
			}

			const colorBox = new Rectangle({
				width: colorBoxSize,
				height: colorBoxSize,
				style: {
					backgroundColor: color.value,
					borderRadius: 8,
					borderWidth: 2,
					borderColor: '#ffffff',
				},
			});
			colorBox.setPosition(colorX, colorY);
			this.addChild(colorBox);

			// Centred under its swatch
			const colorLabel = new Text(color.name, {
				x: colorX,
				y: colorY + colorBoxSize + 5,
				width: colorBoxSize,
				style: {
					fontSize: 12,
					color: '#ffffff',
					textAlign: 'center',
				},
				wrap: 'none',
			});
			this.addChild(colorLabel);

			colorX += colorSpacing;
		});

		// Update our height based on content
		this.fitContentHeight(colorY + colorBoxSize + 40);
	}

	/**
	 * Get the height of this section
	 */
	public getHeight(): number {
		return this.height;
	}
}