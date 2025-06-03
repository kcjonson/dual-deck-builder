import { Panel } from '../../../engine/ui/Panel';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';

/**
 * Rectangle examples section for the developer screen
 * Demonstrates various rectangle styling options
 */
export class RectangleExamplesSection extends Panel {
	constructor(x: number, y: number, width: number) {
		super({
			width,
			height: 150, // Will be calculated based on content
			style: {
				backgroundColor: 'transparent',
			},
		});

		this.setPosition(x, y);
		this.initializeContent();
	}

	private initializeContent(): void {
		const sectionTitle = new Text('Rectangle Examples', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		sectionTitle.setPosition(0, 0);
		this.addChild(sectionTitle);

		const currentY = 50;

		// Rectangle showcase
		const rectY = currentY;
		const rectSpacing = 90;
		let rectX = 20;

		// Basic rectangle
		const basicRect = new Rectangle({
			width: 80,
			height: 80,
			style: {
				backgroundColor: '#3366ff',
			},
		});
		basicRect.setPosition(rectX, rectY);
		this.addChild(basicRect);
		rectX += rectSpacing;

		// Rounded rectangle
		const roundedRect = new Rectangle({
			width: 80,
			height: 80,
			style: {
				backgroundColor: '#ff6600',
				borderRadius: 15,
			},
		});
		roundedRect.setPosition(rectX, rectY);
		this.addChild(roundedRect);
		rectX += rectSpacing;

		// Bordered rectangle
		const borderedRect = new Rectangle({
			width: 80,
			height: 80,
			style: {
				backgroundColor: '#00cc66',
				border: '4px solid #ffffff',
				borderRadius: 8,
			},
		});
		borderedRect.setPosition(rectX, rectY);
		this.addChild(borderedRect);
		rectX += rectSpacing;

		// Semi-transparent
		const transparentRect = new Rectangle({
			width: 80,
			height: 80,
			style: {
				backgroundColor: '#ff333380',
				borderRadius: 20,
				border: '2px solid #ff3333',
			},
		});
		transparentRect.setPosition(rectX, rectY);
		this.addChild(transparentRect);
		rectX += rectSpacing;

		// Circle (using borderRadius)
		const circleRect = new Rectangle({
			width: 80,
			height: 80,
			style: {
				backgroundColor: '#33ccff',
				borderRadius: 40,
				border: '3px solid #0099ff',
			},
		});
		circleRect.setPosition(rectX, rectY);
		this.addChild(circleRect);

		// Update our height based on content
		this.setSize(this.width, rectY + 100);
	}

	/**
	 * Get the height of this section
	 */
	public getHeight(): number {
		return this.height;
	}
}