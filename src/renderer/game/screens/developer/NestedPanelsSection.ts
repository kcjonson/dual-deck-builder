import { Panel } from '../../../engine/ui/Panel';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Button } from '../../../engine/ui/Button';

/**
 * Nested panels section for the developer screen
 * Demonstrates panel composition and nesting
 */
export class NestedPanelsSection extends Panel {
	constructor(x: number, y: number, width: number) {
		super({
			width,
			height: 200, // Will be calculated based on content
			style: {
				backgroundColor: 'transparent',
			},
		});

		this.setPosition(x, y);
		this.initializeContent(width);
	}

	private initializeContent(width: number): void {
		const sectionTitle = new Text('Panel Examples', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		sectionTitle.setPosition(0, 0);
		this.addChild(sectionTitle);

		let currentY = 50;

		// Create a nested panel with some content
		const nestedPanel = new Panel({
			width: Math.min(width - 40, 600),
			height: 150,
			style: {
				backgroundColor: '#333333e6',
				borderRadius: 8,
				border: '2px solid #555555',
			},
		});
		nestedPanel.setPosition(20, currentY);

		const nestedPanelTitle = new Text('Nested Panel Content', {
			style: {
				fontSize: 20,
				color: '#ffffff',
			},
		});
		nestedPanelTitle.setPosition(20, 20);
		nestedPanel.addChild(nestedPanelTitle);

		const nestedRect = new Rectangle({
			width: 60,
			height: 60,
			style: {
				backgroundColor: '#ff4080',
				borderRadius: 30,
			},
		});
		nestedRect.setPosition(20, 60);
		nestedPanel.addChild(nestedRect);

		const nestedButton = new Button('Nested Button', {
			width: 120,
			height: 35,
		});
		nestedButton.setPosition(100, 70);
		nestedPanel.addChild(nestedButton);

		this.addChild(nestedPanel);
		currentY += 170;

		// Update our height based on content
		this.setSize(this.width, currentY);
	}

	/**
	 * Get the height of this section
	 */
	public getHeight(): number {
		return this.height;
	}
}