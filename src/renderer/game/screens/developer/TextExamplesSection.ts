import { Panel } from '../../../engine/ui/Panel';
import { Text } from '../../../engine/components/Text';

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
		currentY += 40;

		// Text wrapping examples
		const wrapLabel = new Text('Text Wrapping:', {
			style: {
				fontSize: 16,
				color: '#888888',
			},
		});
		wrapLabel.setPosition(20, currentY);
		this.addChild(wrapLabel);
		currentY += 25;

		// Normal wrapping
		const normalWrapText = new Text('This is a long text that should wrap automatically when it exceeds the specified width. It demonstrates the normal text wrapping behavior.', {
			x: 20,
			y: currentY,
			width: 300,
			height: 80,
			style: {
				fontSize: 14,
				color: '#ffffff',
				lineHeight: 1.4,
				whiteSpace: 'normal',
			},
		});
		this.addChild(normalWrapText);

		// No wrap
		const noWrapText = new Text('This text should not wrap even if it is very long and exceeds the container width because whiteSpace is set to nowrap.', {
			x: 340,
			y: currentY,
			width: 300,
			height: 80,
			style: {
				fontSize: 14,
				color: '#ffcc00',
				whiteSpace: 'nowrap',
				textOverflow: 'ellipsis',
			},
		});
		this.addChild(noWrapText);
		currentY += 100;

		// Overflow ellipsis example
		const ellipsisText = new Text('This is a demonstration of text overflow with ellipsis. When the text is too long to fit in the specified height, it will be truncated with ellipsis (...) to indicate there is more content.', {
			x: 20,
			y: currentY,
			width: 250,
			height: 40,
			style: {
				fontSize: 14,
				color: '#00cc66',
				lineHeight: 1.2,
				textOverflow: 'ellipsis',
			},
		});
		this.addChild(ellipsisText);

		// Different line heights
		const lineHeightDemo1 = new Text('Line height 1.0: This text has tight line spacing which makes it more compact but potentially harder to read.', {
			x: 300,
			y: currentY,
			width: 200,
			height: 60,
			style: {
				fontSize: 12,
				color: '#ff6600',
				lineHeight: 1.0,
			},
		});
		this.addChild(lineHeightDemo1);

		const lineHeightDemo2 = new Text('Line height 1.8: This text has generous line spacing which makes it easier to read but takes more space.', {
			x: 520,
			y: currentY,
			width: 200,
			height: 80,
			style: {
				fontSize: 12,
				color: '#0088ff',
				lineHeight: 1.8,
			},
		});
		this.addChild(lineHeightDemo2);
		currentY += 100;

		// Update our height based on content
		this.setSize(this.width, currentY + 20);
	}

	/**
	 * Get the height of this section
	 */
	public getHeight(): number {
		return this.height;
	}
}