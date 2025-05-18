import { Screen } from '../core/Screen';
import { Renderer } from '../../engine/rendering/Renderer';
import { Button } from '../../engine/ui/Button';
import { Text } from '../../engine/components/Text';
import { Rectangle } from '../../engine/components/Rectangle';
import { Panel } from '../../engine/ui/Panel';

/**
 * Developer screen for testing UI components and rendering
 */
export class DeveloperScreen extends Screen {
	private title: Text;
	private backButton: Button;
	private onBack: (() => void) | null = null;

	/**
	 * Create a new developer screen
	 * @param renderer WebGL renderer
	 */
	constructor(renderer: Renderer) {
		super('developerScreen', renderer);

		// Create background
		const background = new Rectangle('devBackground');
		background.setPosition(0, 0);
		background.setSize(window.innerWidth, window.innerHeight);
		background.setFillColor([0.15, 0.15, 0.15, 1]);
		this.rootLayer.addChild(background);

		// Create title text
		this.title = new Text('devTitle', 'Developer Tools');
		this.title.setFontSize(48);
		this.title.setColor([1, 1, 1, 1]);
		this.rootLayer.addChild(this.title);

		// Create back button
		this.backButton = new Button('backButton', 'Back to Menu');
		this.backButton.setSize(200, 50);
		this.backButton.setFontSize(20);
		this.backButton.onClick(() => {
			if (this.onBack) this.onBack();
		});
		this.rootLayer.addChild(this.backButton);

		// Create UI component examples
		this.createExamples();

		// Position elements
		this.positionElements();
	}

	/**
	 * Create example UI components
	 */
	private createExamples(): void {
		// Create a panel for rectangles
		const rectanglesPanel = new Panel('rectanglesPanel');
		rectanglesPanel.setSize(400, 300);
		rectanglesPanel.setFillColor([0.2, 0.2, 0.2, 0.9]);

		const rectanglesTitle = new Text('rectanglesTitle', 'Rectangles');
		rectanglesTitle.setFontSize(24);
		rectanglesTitle.setColor([1, 1, 1, 1]);
		rectanglesPanel.addChild(rectanglesTitle);

		// Add example rectangles
		const rect1 = new Rectangle('rect1');
		rect1.setSize(80, 80);
		rect1.setFillColor([1, 0, 0, 1]);
		rectanglesPanel.addChild(rect1);

		const rect2 = new Rectangle('rect2');
		rect2.setSize(80, 80);
		rect2.setFillColor([0, 1, 0, 1]);
		rect2.setCornerRadius(20);
		rectanglesPanel.addChild(rect2);

		const rect3 = new Rectangle('rect3');
		rect3.setSize(80, 80);
		rect3.setFillColor([0, 0, 1, 1]);
		rect3.setBorderColor([1, 1, 1, 1]);
		rect3.setBorderWidth(4);
		rectanglesPanel.addChild(rect3);

		this.rootLayer.addChild(rectanglesPanel);

		// Create a panel for buttons
		const buttonsPanel = new Panel('buttonsPanel');
		buttonsPanel.setSize(400, 300);
		buttonsPanel.setFillColor([0.2, 0.2, 0.2, 0.9]);

		const buttonsTitle = new Text('buttonsTitle', 'Buttons');
		buttonsTitle.setFontSize(24);
		buttonsTitle.setColor([1, 1, 1, 1]);
		buttonsPanel.addChild(buttonsTitle);

		// Add example buttons
		const button1 = new Button('exampleButton1', 'Standard Button');
		button1.setSize(200, 50);
		button1.onClick(() => console.log('Standard button clicked'));
		buttonsPanel.addChild(button1);

		const button2 = new Button('exampleButton2', 'Custom Style');
		button2.setSize(200, 50);
		button2.setFillColor([0.8, 0.2, 0.2, 1]);
		button2.setTextColor([1, 1, 1, 1]);
		button2.onClick(() => console.log('Custom button clicked'));
		buttonsPanel.addChild(button2);

		const button3 = new Button('exampleButton3', 'Disabled');
		button3.setSize(200, 50);
		button3.setEnabled(false);
		buttonsPanel.addChild(button3);

		this.rootLayer.addChild(buttonsPanel);

		// Create a panel for text examples
		const textPanel = new Panel('textPanel');
		textPanel.setSize(400, 300);
		textPanel.setFillColor([0.2, 0.2, 0.2, 0.9]);

		const textTitle = new Text('textTitle', 'Text');
		textTitle.setFontSize(24);
		textTitle.setColor([1, 1, 1, 1]);
		textPanel.addChild(textTitle);

		// Add example texts
		const text1 = new Text('exampleText1', 'Standard Text');
		text1.setFontSize(20);
		text1.setColor([1, 1, 1, 1]);
		textPanel.addChild(text1);

		const text2 = new Text('exampleText2', 'Colored Text');
		text2.setFontSize(20);
		text2.setColor([1, 0.5, 0, 1]);
		textPanel.addChild(text2);

		const text3 = new Text('exampleText3', 'Large Text');
		text3.setFontSize(32);
		text3.setColor([0.5, 0.8, 1, 1]);
		textPanel.addChild(text3);

		this.rootLayer.addChild(textPanel);
	}

	/**
	 * Position the screen elements
	 */
	private positionElements(): void {
		const centerX = window.innerWidth / 2;
		const titleY = 60;

		// Position title
		this.title.setPosition(centerX, titleY);

		// Position back button (bottom center)
		this.backButton.setPosition(centerX - this.backButton.getWidth() / 2, window.innerHeight - 70);

		// Position the example panels
		const panels = this.rootLayer.getChildren().filter((child) => child.getId().includes('Panel'));

		const panelWidth = 400;
		const panelSpacing = 50;
		const totalWidth = panels.length * panelWidth + (panels.length - 1) * panelSpacing;
		const startX = (window.innerWidth - totalWidth) / 2;
		const panelY = 150;

		// Position each panel
		panels.forEach((panel, index) => {
			panel.setPosition(startX + index * (panelWidth + panelSpacing), panelY);

			// Position elements inside the panel
			// Title at top center
			const title = panel.getChildren()[0]; // First child is the title
			title.setPosition(panelWidth / 2, 30);

			// Position other elements in the panel
			const elements = panel.getChildren().slice(1);
			const elementSpacing = 70;
			const elementStartY = 80;

			elements.forEach((element, elementIndex) => {
				const x = panelWidth / 2 - element.getWidth() / 2;
				const y = elementStartY + elementIndex * elementSpacing;
				element.setPosition(x, y);
			});
		});
	}

	/**
	 * Set callback for when Back button is clicked
	 */
	public setOnBack(callback: () => void): void {
		this.onBack = callback;
	}

	/**
	 * Handle window resize
	 */
	protected onResized(): void {
		this.positionElements();
	}
}
