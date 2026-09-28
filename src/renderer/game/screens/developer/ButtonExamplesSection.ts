import { DeveloperSectionPanel } from './DeveloperSectionPanel';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';

/**
 * Button examples section for the developer screen
 * Demonstrates various button styles and states
 */
export class ButtonExamplesSection extends DeveloperSectionPanel {
	private clickCounter = 0;
	private clickCountText!: Text;

	constructor(x: number, y: number, width: number) {
		super({ id: 'dev_section_buttons', x, y, width });

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

		// Primary: the accent tone (R11.10)
		const primaryButton = new Button('Primary', {
			tone: 'accent',
			width: 120,
			height: 40,
		});
		primaryButton.setPosition(buttonX, buttonY1);
		primaryButton.onClick(() => this.incrementCounter());
		this.addChild(primaryButton);
		buttonX += buttonSpacing;

		// Secondary: the default, neutral tone
		const secondaryButton = new Button('Secondary', {
			width: 120,
			height: 40,
		});
		secondaryButton.setPosition(buttonX, buttonY1);
		secondaryButton.onClick(() => this.incrementCounter());
		this.addChild(secondaryButton);
		buttonX += buttonSpacing;

		const successButton = new Button('Success', {
			tone: 'ok',
			width: 120,
			height: 40,
		});
		successButton.setPosition(buttonX, buttonY1);
		successButton.onClick(() => this.incrementCounter());
		this.addChild(successButton);
		buttonX += buttonSpacing;

		const dangerButton = new Button('Danger', {
			tone: 'crit',
			width: 120,
			height: 40,
		});
		dangerButton.setPosition(buttonX, buttonY1);
		dangerButton.onClick(() => this.incrementCounter());
		this.addChild(dangerButton);

		// Second row of buttons
		currentY += 60;
		const buttonY2 = currentY;
		buttonX = 20;

		// Style overrides on top of a tone (R11.15): the radius from a token
		const roundedButton = new Button('Rounded', {
			tone: 'data',
			width: 120,
			height: 40,
			style: {
				borderRadius: 'r_pill',
			},
		});
		roundedButton.setPosition(buttonX, buttonY2);
		roundedButton.onClick(() => this.incrementCounter());
		this.addChild(roundedButton);
		buttonX += buttonSpacing;

		// A transparent fill still takes the hover wash and pressed nudge
		const outlinedButton = new Button('Outlined', {
			width: 120,
			height: 40,
			style: {
				backgroundColor: 'transparent',
				borderColor: 'data',
				color: 'data',
			},
		});
		outlinedButton.setPosition(buttonX, buttonY2);
		outlinedButton.onClick(() => this.incrementCounter());
		this.addChild(outlinedButton);
		buttonX += buttonSpacing;

		// Sizes set height, label, and icon together (R11.10)
		const smallButton = new Button('Small', {
			size: 'sm',
			width: 80,
		});
		smallButton.setPosition(buttonX, buttonY2 + 7);
		smallButton.onClick(() => this.incrementCounter());
		this.addChild(smallButton);
		buttonX += 90;

		const largeButton = new Button('Large Button', {
			tone: 'accent',
			size: 'lg',
			width: 150,
		});
		largeButton.setPosition(buttonX, buttonY2 - 3);
		largeButton.onClick(() => this.incrementCounter());
		this.addChild(largeButton);

		// Third row: R11.11 flags held on, so the gallery shows the state layers
		currentY += 60;
		const buttonY3 = currentY;
		buttonX = 20;

		const disabledButton = new Button('Disabled', { tone: 'accent', width: 120, height: 40 });
		disabledButton.setEnabled(false);

		const selectedButton = new Button('Selected', { width: 120, height: 40 });
		selectedButton.selected = true;

		const activeButton = new Button('Active', { width: 120, height: 40 });
		activeButton.active = true;

		// Keyboard focus: the ring sits outside the box, independent of the rest
		const focusedButton = new Button('Focus ring', { tone: 'accent', width: 120, height: 40 });
		focusedButton.setFocused(true);
		focusedButton.focusVisible = true;

		for (const button of [disabledButton, selectedButton, activeButton, focusedButton]) {
			button.setPosition(buttonX, buttonY3);
			button.onClick(() => this.incrementCounter());
			this.addChild(button);
			buttonX += buttonSpacing;
		}

		// Update our height based on content
		this.fitContentHeight(buttonY3 + 60);
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