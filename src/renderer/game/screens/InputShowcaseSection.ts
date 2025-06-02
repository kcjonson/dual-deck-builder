import { Panel } from '../../engine/ui/Panel';
import { Text } from '../../engine/components/Text';
import { Input } from '../../engine/ui/Input';

/**
 * Input showcase section for the developer screen
 * Demonstrates various input field configurations
 */
export class InputShowcaseSection extends Panel {
	constructor(x: number, y: number, width: number) {
		super({
			width,
			height: 300, // Will be calculated based on content
			style: {
				backgroundColor: 'transparent',
			},
		});

		this.setPosition(x, y);
		this.initializeContent();
	}

	private initializeContent(): void {
		const sectionTitle = new Text('Input Fields', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		sectionTitle.setPosition(0, 0);
		this.addChild(sectionTitle);

		let currentY = 50;

		// Basic input
		const basicLabel = new Text('Basic Input:', {
			style: {
				fontSize: 16,
				color: '#ffffff',
			},
		});
		basicLabel.setPosition(20, currentY);
		this.addChild(basicLabel);
		currentY += 25;

		const basicInput = new Input('Type something...', {
			width: 300,
			height: 35,
		});
		basicInput.setPosition(20, currentY);
		this.addChild(basicInput);
		currentY += 50;

		// Styled input
		const styledLabel = new Text('Styled Input:', {
			style: {
				fontSize: 16,
				color: '#ffffff',
			},
		});
		styledLabel.setPosition(20, currentY);
		this.addChild(styledLabel);
		currentY += 25;

		const styledInput = new Input('Custom styled input', {
			width: 300,
			height: 40,
			style: {
				fontSize: 16,
				backgroundColor: '#1a1a1a',
				color: '#00ff00',
				borderRadius: 20,
				border: '2px solid #00ff00',
			},
		});
		styledInput.setPosition(20, currentY);
		this.addChild(styledInput);
		currentY += 55;

		// Pre-filled input
		const prefilledLabel = new Text('Pre-filled Input:', {
			style: {
				fontSize: 16,
				color: '#ffffff',
			},
		});
		prefilledLabel.setPosition(20, currentY);
		this.addChild(prefilledLabel);
		currentY += 25;

		const prefilledInput = new Input('This should not show', {
			width: 300,
			height: 35,
		});
		prefilledInput.setPosition(20, currentY);
		prefilledInput.setValue('This input has initial text');
		this.addChild(prefilledInput);
		currentY += 50;

		// Reactive display
		const reactiveLabel = new Text('Reactive Display:', {
			style: {
				fontSize: 16,
				color: '#ffffff',
			},
		});
		reactiveLabel.setPosition(20, currentY);
		this.addChild(reactiveLabel);

		const displayText = new Text('Type in any input above', {
			style: {
				fontSize: 14,
				color: '#ffcc00',
			},
		});
		displayText.setPosition(200, currentY);
		this.addChild(displayText);

		// Set up reactive behavior
		const updateDisplay = (source: string, value: string) => {
			displayText.setText(`${source}: ${value}`);
		};

		basicInput.onChange((value: string) => updateDisplay('Basic', value));
		styledInput.onChange((value: string) => updateDisplay('Styled', value));
		prefilledInput.onChange((value: string) => updateDisplay('Pre-filled', value));

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