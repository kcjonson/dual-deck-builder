import { Panel } from '../../engine/ui/Panel';
import { Text } from '../../engine/components/Text';
import { Button } from '../../engine/ui/Button';

/**
 * Button examples section for the developer screen
 * Demonstrates various button styles and states
 */
export class ButtonExamplesSection extends Panel {
	private clickCounter = 0;
	private clickCountText!: Text;

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
		const sectionTitle = new Text('Button Examples', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		sectionTitle.setPosition(0, 0);
		this.addChild(sectionTitle);

		let currentY = 50;

		// Click counter display
		this.clickCountText = new Text('Button clicks: 0', {
			style: {
				fontSize: 16,
				color: '#ffcc00',
			},
		});
		this.clickCountText.setPosition(20, currentY);
		this.addChild(this.clickCountText);
		currentY += 30;

		// First row of buttons
		const buttonY1 = currentY;
		const buttonSpacing = 130;
		let buttonX = 20;

		// Primary button
		const primaryButton = new Button('Primary', {
			width: 120,
			height: 40,
			style: {
				fontSize: 16,
				backgroundColor: '#3366ff',
				borderRadius: 4,
			},
		});
		primaryButton.setPosition(buttonX, buttonY1);
		primaryButton.onClick(() => this.incrementCounter());
		this.addChild(primaryButton);
		buttonX += buttonSpacing;

		// Secondary button
		const secondaryButton = new Button('Secondary', {
			width: 120,
			height: 40,
			style: {
				fontSize: 16,
				backgroundColor: '#666666',
				borderRadius: 4,
			},
		});
		secondaryButton.setPosition(buttonX, buttonY1);
		secondaryButton.onClick(() => this.incrementCounter());
		this.addChild(secondaryButton);
		buttonX += buttonSpacing;

		// Success button
		const successButton = new Button('Success', {
			width: 120,
			height: 40,
			style: {
				fontSize: 16,
				backgroundColor: '#00cc66',
				borderRadius: 4,
			},
		});
		successButton.setPosition(buttonX, buttonY1);
		successButton.onClick(() => this.incrementCounter());
		this.addChild(successButton);
		buttonX += buttonSpacing;

		// Danger button
		const dangerButton = new Button('Danger', {
			width: 120,
			height: 40,
			style: {
				fontSize: 16,
				backgroundColor: '#ff3333',
				borderRadius: 4,
			},
		});
		dangerButton.setPosition(buttonX, buttonY1);
		dangerButton.onClick(() => this.incrementCounter());
		this.addChild(dangerButton);

		// Second row of buttons
		currentY += 60;
		const buttonY2 = currentY;
		buttonX = 20;

		// Rounded button
		const roundedButton = new Button('Rounded', {
			width: 120,
			height: 40,
			style: {
				fontSize: 16,
				backgroundColor: '#ff6600',
				borderRadius: 20,
			},
		});
		roundedButton.setPosition(buttonX, buttonY2);
		roundedButton.onClick(() => this.incrementCounter());
		this.addChild(roundedButton);
		buttonX += buttonSpacing;

		// Outlined button
		const outlinedButton = new Button('Outlined', {
			width: 120,
			height: 40,
			style: {
				fontSize: 16,
				backgroundColor: '#00000000',
				border: '2px solid #33ccff',
				color: '#33ccff',
				borderRadius: 4,
			},
		});
		outlinedButton.setPosition(buttonX, buttonY2);
		outlinedButton.onClick(() => this.incrementCounter());
		this.addChild(outlinedButton);
		buttonX += buttonSpacing;

		// Small button
		const smallButton = new Button('Small', {
			width: 80,
			height: 30,
			style: {
				fontSize: 14,
				backgroundColor: '#9933ff',
				borderRadius: 3,
			},
		});
		smallButton.setPosition(buttonX, buttonY2 + 5);
		smallButton.onClick(() => this.incrementCounter());
		this.addChild(smallButton);
		buttonX += 90;

		// Large button
		const largeButton = new Button('Large Button', {
			width: 150,
			height: 50,
			style: {
				fontSize: 18,
				backgroundColor: '#ff9900',
				borderRadius: 8,
			},
		});
		largeButton.setPosition(buttonX, buttonY2 - 5);
		largeButton.onClick(() => this.incrementCounter());
		this.addChild(largeButton);

		// Update our height based on content
		this.setSize(this.width, buttonY2 + 60);
	}

	private incrementCounter(): void {
		this.clickCounter++;
		this.clickCountText.setText(`Button clicks: ${this.clickCounter}`);
	}

	/**
	 * Get the height of this section
	 */
	public getHeight(): number {
		return this.height;
	}
}