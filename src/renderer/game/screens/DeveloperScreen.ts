import { Screen } from '../core/Screen';
import { Renderer } from '../../engine/rendering/Renderer';
import { Button } from '../../engine/ui/Button';
import { Text } from '../../engine/components/Text';
import { Rectangle } from '../../engine/components/Rectangle';
import { Panel } from '../../engine/ui/Panel';
import { Input } from '../../engine/ui/Input';
import { Layer } from '../../engine/components/Layer';

/**
 * Developer screen for testing UI components and rendering
 */
export class DeveloperScreen extends Screen {
	private title: Text;
	private backButton: Button;
	private onBack: (() => void) | null = null;
	
	// Performance monitoring
	// private fpsCounter: Text;
	// private lastFrameTime = 0;
	// private frameCount = 0;
	// private fps = 0;
	
	// Interactive controls
	// private controlsPanel: Panel;
	// private colorSliders: { r: Input; g: Input; b: Input; a: Input };
	// private sizeControls: { width: Input; height: Input };
	// private demoRectangle: Rectangle;
	// private demoText: Text;
	
	// Style guide elements
	// private styleGuidePanel: Panel;

	/**
	 * Create a new developer screen
	 * @param renderer WebGL renderer
	 */
	constructor(renderer: Renderer) {
		super('developerScreen', renderer);

		// Create background
		const background = new Rectangle({
			style: {
				left: 0,
				top: 0,
				width: window.innerWidth,
				height: window.innerHeight,
				backgroundColor: '#262626'
			}
		});
		this.rootLayer.addChild(background);

		// Create title text
		this.title = new Text('Developer Tools', {
			style: {
				fontSize: 48,
				color: '#ffffff'
			}
		});
		this.rootLayer.addChild(this.title);

		// Create back button
		this.backButton = new Button('Back to Menu', {
			style: {
				width: 200,
				height: 50,
				fontSize: 20
			}
		});
		this.backButton.onClick(() => {
			if (this.onBack) this.onBack();
		});
		this.rootLayer.addChild(this.backButton);

		// Create FPS counter
		// this.createFpsCounter();
		
		// Create interactive controls
		// this.createInteractiveControls();
		
		// Create style guide
		// this.createStyleGuide();

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
		const rectanglesPanel = new Panel({
			style: {
				width: 400,
				height: 300,
				backgroundColor: '#333333e6'  // e6 = 90% alpha
			}
		});

		const rectanglesTitle = new Text('Rectangles', {
			style: {
				fontSize: 24,
				color: '#ffffff'
			}
		});
		rectanglesPanel.addChild(rectanglesTitle);

		// Add example rectangles
		const rect1 = new Rectangle({
			style: {
				width: 80,
				height: 80,
				backgroundColor: '#ff0000'
			}
		});
		rectanglesPanel.addChild(rect1);

		const rect2 = new Rectangle({
			style: {
				width: 80,
				height: 80,
				backgroundColor: '#00ff00',
				borderRadius: 20
			}
		});
		rectanglesPanel.addChild(rect2);

		const rect3 = new Rectangle({
			style: {
				width: 80,
				height: 80,
				backgroundColor: '#0000ff',
				border: '4px solid #ffffff'
			}
		});
		rectanglesPanel.addChild(rect3);

		this.rootLayer.addChild(rectanglesPanel);

		// Create a panel for buttons
		const buttonsPanel = new Panel({
			style: {
				width: 400,
				height: 300,
				backgroundColor: '#333333e6'  // e6 = 90% alpha
			}
		});

		const buttonsTitle = new Text('Buttons', {
			style: {
				fontSize: 24,
				color: '#ffffff'
			}
		});
		buttonsPanel.addChild(buttonsTitle);

		// Add example buttons
		const button1 = new Button('Standard Button', {
			style: {
				width: 200,
				height: 50
			}
		});
		buttonsPanel.addChild(button1);

		const button2 = new Button('Custom Style', {
			style: {
				width: 200,
				height: 50
			}
		});
		button2.setFillColor('#cc3333');
		button2.setTextColor('#ffffff');
		buttonsPanel.addChild(button2);

		const button3 = new Button('Disabled', {
			style: {
				width: 200,
				height: 50
			}
		});
		button3.setEnabled(false);
		buttonsPanel.addChild(button3);

		this.rootLayer.addChild(buttonsPanel);

		// Create a panel for text examples
		const textPanel = new Panel({
			style: {
				width: 400,
				height: 300,
				backgroundColor: '#333333e6'  // e6 = 90% alpha
			}
		});

		const textTitle = new Text('Text', {
			style: {
				fontSize: 24,
				color: '#ffffff'
			}
		});
		textPanel.addChild(textTitle);

		// Add example texts
		const text1 = new Text('Standard Text', {
			style: {
				fontSize: 20,
				color: '#ffffff'
			}
		});
		textPanel.addChild(text1);

		const text2 = new Text('Colored Text', {
			style: {
				fontSize: 20,
				color: '#ff8000'
			}
		});
		textPanel.addChild(text2);

		const text3 = new Text('Large Text', {
			style: {
				fontSize: 32,
				color: '#80ccff'
			}
		});
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
		const panels = this.rootLayer.getChildren().filter((child) => child.getComponentType() === 'Panel');

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
