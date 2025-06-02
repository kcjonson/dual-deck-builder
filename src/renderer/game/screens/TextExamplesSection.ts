import { Panel } from '../../engine/ui/Panel';
import { Text } from '../../engine/components/Text';

/**
 * Text examples section for the developer screen
 * Demonstrates various text styling options
 */
export class TextExamplesSection extends Panel {
	constructor(x: number, y: number, width: number) {
		super({
			width,
			height: 200, // Will be calculated based on content
			style: {
				backgroundColor: 'transparent',
			},
		});

		this.setPosition(x, y);
		this.initializeContent();
	}

	private initializeContent(): void {
		const sectionTitle = new Text('Text Examples', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		sectionTitle.setPosition(0, 0);
		this.addChild(sectionTitle);

		let currentY = 50;

		// Different sizes
		const sizes = [12, 16, 20, 24, 32];
		sizes.forEach((size) => {
			const sampleText = new Text(`Size ${size}px: The quick brown fox`, {
				style: {
					fontSize: size,
					color: '#ffffff',
				},
			});
			sampleText.setPosition(20, currentY);
			this.addChild(sampleText);
			currentY += size + 10;
		});

		currentY += 10;

		// Different colors
		const colorText1 = new Text('Colored text examples', {
			style: {
				fontSize: 18,
				color: '#ff6600',
			},
		});
		colorText1.setPosition(20, currentY);
		this.addChild(colorText1);
		currentY += 25;

		const colorText2 = new Text('Success message style', {
			style: {
				fontSize: 18,
				color: '#00cc66',
			},
		});
		colorText2.setPosition(20, currentY);
		this.addChild(colorText2);
		currentY += 25;

		const colorText3 = new Text('Warning message style', {
			style: {
				fontSize: 18,
				color: '#ffcc00',
			},
		});
		colorText3.setPosition(20, currentY);
		this.addChild(colorText3);
		currentY += 25;

		const colorText4 = new Text('Error message style', {
			style: {
				fontSize: 18,
				color: '#ff3333',
			},
		});
		colorText4.setPosition(20, currentY);
		this.addChild(colorText4);
		currentY += 25;

		// Text alignment examples
		const alignLabel = new Text('Text Alignment:', {
			style: {
				fontSize: 16,
				color: '#888888',
			},
		});
		alignLabel.setPosition(20, currentY);
		this.addChild(alignLabel);
		currentY += 25;

		const leftText = new Text('Left aligned (default)', {
			style: {
				fontSize: 16,
				color: '#ffffff',
				textAlign: 'left',
			},
		});
		leftText.setPosition(20, currentY);
		this.addChild(leftText);

		const centerText = new Text('Center aligned', {
			style: {
				fontSize: 16,
				color: '#ffffff',
				textAlign: 'center',
			},
		});
		centerText.setPosition(this.width / 2, currentY);
		this.addChild(centerText);

		const rightText = new Text('Right aligned', {
			style: {
				fontSize: 16,
				color: '#ffffff',
				textAlign: 'right',
			},
		});
		rightText.setPosition(this.width - 20, currentY);
		this.addChild(rightText);

		// Update our height based on content
		this.setSize(this.width, currentY + 40);
	}

	/**
	 * Get the height of this section
	 */
	public getHeight(): number {
		return this.height;
	}
}