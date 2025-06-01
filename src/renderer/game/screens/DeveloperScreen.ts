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
	private fpsCounter!: Text;
	private lastFrameTime = 0;
	private frameCount = 0;
	private fps = 0;

	// Interactive controls
	private controlsPanel!: Panel;
	private controlsTitle!: Text;
	private colorLabel!: Text;
	private sizeLabel!: Text;
	private colorInputs!: { r: Input; g: Input; b: Input; a: Input };
	private sizeControls!: { width: Input; height: Input };
	private demoRectangle!: Rectangle;

	// Style guide elements
	private styleGuidePanel!: Panel;
	private styleTitle!: Text;
	private paletteLabel!: Text;
	private typographyLabel!: Text;
	private colorPalette!: Rectangle[];
	private fontExamples!: Text[];

	// Component showcase
	private showcasePanel!: Panel;
	private showcaseTitle!: Text;
	private outputLabel!: Text;
	private outputText!: Text;
	private inputExamples!: Input[];

	/**
	 * Create a new developer screen
	 * @param renderer WebGL renderer
	 */
	constructor(renderer: Renderer) {
		super('developerScreen', renderer);

		// Create background
		const background = new Rectangle({
			x: 0,
			y: 0,
			width: window.innerWidth,
			height: window.innerHeight,
			style: {
				backgroundColor: '#262626',
			},
		});
		this.rootLayer.addChild(background);

		// Create title text
		this.title = new Text('Developer Tools', {
			style: {
				fontSize: 48,
				color: '#ffffff',
			},
		});
		this.rootLayer.addChild(this.title);

		// Create back button
		this.backButton = new Button('Back to Menu', {
			width: 200,
			height: 50,
			style: {
				fontSize: 20,
			},
		});
		this.backButton.onClick(() => {
			if (this.onBack) this.onBack();
		});
		this.rootLayer.addChild(this.backButton);

		// Create FPS counter
		this.createFpsCounter();

		// Create interactive controls
		this.createInteractiveControls();

		// Create style guide
		this.createStyleGuide();

		// Create UI component examples
		this.createExamples();

		// Create input showcase
		this.createInputShowcase();

		// Position elements
		this.positionElements();
	}

	/**
	 * Create example UI components
	 */
	private createExamples(): void {
		// Create a panel for rectangles
		const rectanglesPanel = new Panel({
			width: 400,
			height: 300,
			style: {
				backgroundColor: '#333333e6', // e6 = 90% alpha
			},
		});

		const rectanglesTitle = new Text('Rectangles', {
			style: {
				fontSize: 24,
				color: '#ffffff',
			},
		});
		rectanglesPanel.addChild(rectanglesTitle);

		// Add example rectangles
		const rect1 = new Rectangle({
			width: 80,
			height: 80,
			style: {
				backgroundColor: '#ff0000',
			},
		});
		rectanglesPanel.addChild(rect1);

		const rect2 = new Rectangle({
			width: 80,
			height: 80,
			style: {
				backgroundColor: '#00ff00',
				borderRadius: 20,
			},
		});
		rectanglesPanel.addChild(rect2);

		const rect3 = new Rectangle({
			width: 80,
			height: 80,
			style: {
				backgroundColor: '#0000ff',
				border: '4px solid #ffffff',
			},
		});
		rectanglesPanel.addChild(rect3);

		this.rootLayer.addChild(rectanglesPanel);

		// Create a panel for buttons
		const buttonsPanel = new Panel({
			width: 400,
			height: 300,
			style: {
				backgroundColor: '#333333e6', // e6 = 90% alpha
			},
		});

		const buttonsTitle = new Text('Buttons', {
			style: {
				fontSize: 24,
				color: '#ffffff',
			},
		});
		buttonsPanel.addChild(buttonsTitle);

		// Add example buttons
		const button1 = new Button('Standard Button', {
			width: 200,
			height: 50,
		});
		buttonsPanel.addChild(button1);

		const button2 = new Button('Custom Style', {
			width: 200,
			height: 50,
		});
		button2.setFillColor('#cc3333');
		button2.setTextColor('#ffffff');
		buttonsPanel.addChild(button2);

		const button3 = new Button('Disabled', {
			width: 200,
			height: 50,
		});
		button3.setEnabled(false);
		buttonsPanel.addChild(button3);

		this.rootLayer.addChild(buttonsPanel);

		// Create a panel for text examples
		const textPanel = new Panel({
			width: 400,
			height: 300,
			style: {
				backgroundColor: '#333333e6', // e6 = 90% alpha
			},
		});

		const textTitle = new Text('Text', {
			style: {
				fontSize: 24,
				color: '#ffffff',
			},
		});
		textPanel.addChild(textTitle);

		// Add example texts
		const text1 = new Text('Standard Text', {
			style: {
				fontSize: 20,
				color: '#ffffff',
			},
		});
		textPanel.addChild(text1);

		const text2 = new Text('Colored Text', {
			style: {
				fontSize: 20,
				color: '#ff8000',
			},
		});
		textPanel.addChild(text2);

		const text3 = new Text('Large Text', {
			style: {
				fontSize: 32,
				color: '#80ccff',
			},
		});
		textPanel.addChild(text3);

		this.rootLayer.addChild(textPanel);
	}

	/**
	 * Create FPS counter for performance monitoring
	 */
	private createFpsCounter(): void {
		this.fpsCounter = new Text('FPS: 0', {
			style: {
				fontSize: 16,
				color: '#00ff00',
			},
		});
		this.rootLayer.addChild(this.fpsCounter);
	}

	/**
	 * Create interactive controls panel
	 */
	private createInteractiveControls(): void {
		this.controlsPanel = new Panel({
			width: 300,
			height: 400,
			style: {
				backgroundColor: '#2a2a2ae6',
			},
		});

		this.controlsTitle = new Text('Interactive Controls', {
			style: {
				fontSize: 24,
				color: '#ffffff',
			},
		});
		this.controlsPanel.addChild(this.controlsTitle);

		// Create demo rectangle to control
		this.demoRectangle = new Rectangle({
			width: 100,
			height: 100,
			style: {
				backgroundColor: '#ff6600',
				borderRadius: 10,
			},
		});
		this.controlsPanel.addChild(this.demoRectangle);

		// Color controls
		this.colorLabel = new Text('Color (R,G,B,A):', {
			style: {
				fontSize: 16,
				color: '#ffffff',
			},
		});
		this.controlsPanel.addChild(this.colorLabel);

		// Create color inputs
		this.colorInputs = {
			r: new Input('', {
				width: 60,
				height: 30,
			}),
			g: new Input('', {
				width: 60,
				height: 30,
			}),
			b: new Input('', {
				width: 60,
				height: 30,
			}),
			a: new Input('', {
				width: 60,
				height: 30,
			}),
		};

		// Set initial values
		this.colorInputs.r.setValue('255');
		this.colorInputs.g.setValue('102');
		this.colorInputs.b.setValue('0');
		this.colorInputs.a.setValue('255');

		// Add change handlers
		Object.values(this.colorInputs).forEach((input) => {
			input.onChange(() => this.updateDemoRectangle());
			this.controlsPanel.addChild(input);
		});

		// Size controls
		this.sizeLabel = new Text('Size (W x H):', {
			style: {
				fontSize: 16,
				color: '#ffffff',
			},
		});
		this.controlsPanel.addChild(this.sizeLabel);

		this.sizeControls = {
			width: new Input('', {
				width: 80,
				height: 30,
			}),
			height: new Input('', {
				width: 80,
				height: 30,
			}),
		};

		this.sizeControls.width.setValue('100');
		this.sizeControls.height.setValue('100');

		this.sizeControls.width.onChange(() => this.updateDemoRectangle());
		this.sizeControls.height.onChange(() => this.updateDemoRectangle());

		this.controlsPanel.addChild(this.sizeControls.width);
		this.controlsPanel.addChild(this.sizeControls.height);

		this.rootLayer.addChild(this.controlsPanel);
	}

	/**
	 * Update demo rectangle based on input values
	 */
	private updateDemoRectangle(): void {
		const r = parseInt(this.colorInputs.r.getValue()) || 0;
		const g = parseInt(this.colorInputs.g.getValue()) || 0;
		const b = parseInt(this.colorInputs.b.getValue()) || 0;
		const a = parseInt(this.colorInputs.a.getValue()) || 255;

		// Convert to hex
		const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
		const color = `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}`;

		this.demoRectangle.setFillColor(color);

		// Update size
		const width = parseInt(this.sizeControls.width.getValue()) || 100;
		const height = parseInt(this.sizeControls.height.getValue()) || 100;
		this.demoRectangle.setSize(width, height);
	}

	/**
	 * Create visual style guide
	 */
	private createStyleGuide(): void {
		this.styleGuidePanel = new Panel({
			width: 300,
			height: 400,
			style: {
				backgroundColor: '#2a2a2ae6',
			},
		});

		this.styleTitle = new Text('Style Guide', {
			style: {
				fontSize: 24,
				color: '#ffffff',
			},
		});
		this.styleGuidePanel.addChild(this.styleTitle);

		// Color palette
		this.paletteLabel = new Text('Color Palette:', {
			style: {
				fontSize: 16,
				color: '#ffffff',
			},
		});
		this.styleGuidePanel.addChild(this.paletteLabel);

		// Wasteland Wheels color palette
		const colors = [
			'#ff6600', // Orange (primary)
			'#cc3333', // Red (danger)
			'#33cc33', // Green (success)
			'#3366cc', // Blue (info)
			'#ffcc00', // Yellow (warning)
			'#666666', // Gray (disabled)
			'#333333', // Dark gray (background)
			'#1a1a1a', // Black (deep background)
		];

		this.colorPalette = colors.map((color) => {
			const rect = new Rectangle({
				width: 50,
				height: 50,
				style: {
					backgroundColor: color,
					border: '2px solid #ffffff',
				},
			});
			this.styleGuidePanel.addChild(rect);
			return rect;
		});

		// Typography examples
		this.typographyLabel = new Text('Typography:', {
			style: {
				fontSize: 16,
				color: '#ffffff',
			},
		});
		this.styleGuidePanel.addChild(this.typographyLabel);

		const fontSizes = [48, 32, 24, 20, 16, 14];
		this.fontExamples = fontSizes.map((size) => {
			const text = new Text(`Size ${size}`, {
				style: {
					fontSize: size,
					color: '#ffffff',
				},
			});
			this.styleGuidePanel.addChild(text);
			return text;
		});

		this.rootLayer.addChild(this.styleGuidePanel);
	}

	/**
	 * Create input component showcase
	 */
	private createInputShowcase(): void {
		this.showcasePanel = new Panel({
			width: 400,
			height: 400,
			style: {
				backgroundColor: '#333333e6',
			},
		});

		this.showcaseTitle = new Text('Input Components', {
			style: {
				fontSize: 24,
				color: '#ffffff',
			},
		});
		this.showcasePanel.addChild(this.showcaseTitle);

		// Create various input examples
		this.inputExamples = [];

		// Standard input
		const input1 = new Input('Enter text here...', {
			width: 300,
			height: 40,
		});
		this.inputExamples.push(input1);
		this.showcasePanel.addChild(input1);

		// Input with value
		const input2 = new Input('', {
			width: 300,
			height: 40,
		});
		input2.setValue('Pre-filled value');
		this.inputExamples.push(input2);
		this.showcasePanel.addChild(input2);

		// Disabled input
		const input3 = new Input('', {
			width: 300,
			height: 40,
		});
		input3.setValue('Disabled input');
		input3.setEnabled(false);
		this.inputExamples.push(input3);
		this.showcasePanel.addChild(input3);

		// Input with max length
		const input4 = new Input('Max 10 chars', {
			width: 300,
			height: 40,
		});
		input4.setMaxLength(10);
		this.inputExamples.push(input4);
		this.showcasePanel.addChild(input4);

		// Add output display
		this.outputLabel = new Text('Last changed value:', {
			style: {
				fontSize: 16,
				color: '#ffffff',
			},
		});
		this.showcasePanel.addChild(this.outputLabel);

		this.outputText = new Text('', {
			style: {
				fontSize: 16,
				color: '#ffcc00',
			},
		});
		this.showcasePanel.addChild(this.outputText);

		// Add change handlers to all inputs
		this.inputExamples.forEach((input, index) => {
			input.onChange((value) => {
				this.outputText.setText(`Input ${index + 1}: "${value}"`);
			});
		});

		this.rootLayer.addChild(this.showcasePanel);
	}

	/**
	 * Position the screen elements
	 */
	private positionElements(): void {
		const centerX = window.innerWidth / 2;
		const titleY = 60;

		// Position title (centered)
		this.title.setAlign('center');
		this.title.setPosition(centerX, titleY);

		// Position back button (bottom center)
		this.backButton.setPosition(centerX - this.backButton.getWidth() / 2, window.innerHeight - 70);

		// Position FPS counter
		this.fpsCounter.setPosition(window.innerWidth - 100, 20);

		// Get all panels for positioning
		const panels = this.rootLayer
			.getChildren()
			.filter((child) => child.getComponentType() === 'Panel');

		// Separate panels by type
		const examplePanels = panels.filter(
			(p) => p !== this.controlsPanel && p !== this.styleGuidePanel && p !== this.showcasePanel,
		);

		// Position control panels on the left
		if (this.controlsPanel) {
			this.controlsPanel.setPosition(20, 150);
			this.positionControlsPanel();
		}

		// Position style guide on the right
		if (this.styleGuidePanel) {
			this.styleGuidePanel.setPosition(window.innerWidth - 320, 150);
			this.positionStyleGuidePanel();
		}

		// Position showcase panel
		if (this.showcasePanel) {
			this.showcasePanel.setPosition(340, 150);
			this.positionShowcasePanel();
		}

		// Position example panels at the bottom
		this.positionExamplePanels();
	}

	/**
	 * Set callback for when Back button is clicked
	 */
	public setOnBack(callback: () => void): void {
		this.onBack = callback;
	}

	/**
	 * Position controls panel elements
	 */
	private positionControlsPanel(): void {
		if (!this.controlsPanel) return;

		// Get panel's absolute position
		const panelX = this.controlsPanel.getX();
		const panelY = this.controlsPanel.getY();
		let y = 30;

		// Position title (centered)
		this.controlsTitle.setAlign('center');
		this.controlsTitle.setPosition(panelX + 150, panelY + y);
		y += 50;

		// Demo rectangle
		this.demoRectangle.setPosition(panelX + 100, panelY + y);
		y += 120;

		// Color label
		this.colorLabel.setPosition(panelX + 20, panelY + y);
		y += 30;

		// Color inputs in a row
		let x = 20;
		const colorInputs = [
			this.colorInputs.r,
			this.colorInputs.g,
			this.colorInputs.b,
			this.colorInputs.a,
		];
		colorInputs.forEach((input) => {
			input.setPosition(panelX + x, panelY + y);
			x += 70;
		});
		y += 50;

		// Size label
		this.sizeLabel.setPosition(panelX + 20, panelY + y);
		y += 30;

		// Size inputs
		this.sizeControls.width.setPosition(panelX + 20, panelY + y);
		this.sizeControls.height.setPosition(panelX + 110, panelY + y);
	}

	/**
	 * Position style guide panel elements
	 */
	private positionStyleGuidePanel(): void {
		if (!this.styleGuidePanel) return;

		// Get panel's absolute position
		const panelX = this.styleGuidePanel.getX();
		const panelY = this.styleGuidePanel.getY();
		let y = 30;

		// Title (centered)
		this.styleTitle.setAlign('center');
		this.styleTitle.setPosition(panelX + 150, panelY + y);
		y += 50;

		// Palette label
		this.paletteLabel.setPosition(panelX + 20, panelY + y);
		y += 30;

		// Color palette grid
		let x = 20;
		let colorIndex = 0;
		this.colorPalette.forEach((rect) => {
			rect.setPosition(panelX + x, panelY + y);
			x += 60;
			colorIndex++;
			if (colorIndex % 4 === 0) {
				x = 20;
				y += 60;
			}
		});
		y += 20;

		// Typography label
		this.typographyLabel.setPosition(panelX + 20, panelY + y);
		y += 30;

		// Font size examples
		this.fontExamples.forEach((text) => {
			text.setPosition(panelX + 20, panelY + y);
			// Use consistent spacing based on font size rather than getHeight()
			const fontSize = text.getFontSize();
			y += fontSize + 15; // Font size + some padding
		});
	}

	/**
	 * Position showcase panel elements
	 */
	private positionShowcasePanel(): void {
		if (!this.showcasePanel) return;

		// Get panel's absolute position
		const panelX = this.showcasePanel.getX();
		const panelY = this.showcasePanel.getY();
		let y = 30;

		// Title (centered)
		this.showcaseTitle.setAlign('center');
		this.showcaseTitle.setPosition(panelX + 200, panelY + y);
		y += 50;

		// Input examples
		this.inputExamples.forEach((input) => {
			input.setPosition(panelX + 50, panelY + y);
			y += 60;
		});

		// Output label and text
		this.outputLabel.setPosition(panelX + 50, panelY + y);
		this.outputText.setPosition(panelX + 50, panelY + y + 25);
	}

	/**
	 * Position example panels using layout component arrays
	 */
	private positionExamplePanels(): void {
		// Get all panels for positioning
		const panels = this.rootLayer
			.getChildren()
			.filter((child) => child.getComponentType() === 'Panel');

		// Separate panels by type
		const examplePanels = panels.filter(
			(p) => p !== this.controlsPanel && p !== this.styleGuidePanel && p !== this.showcasePanel,
		);

		// Position example panels at the bottom
		if (examplePanels.length > 0) {
			const panelWidth = 400;
			const panelSpacing = 20;
			const totalWidth =
				examplePanels.length * panelWidth + (examplePanels.length - 1) * panelSpacing;
			const startX = (window.innerWidth - totalWidth) / 2;
			const panelY = 580;

			// For each panel, store its layout components in an array
			examplePanels.forEach((panel, index) => {
				const panelX = startX + index * (panelWidth + panelSpacing);
				panel.setPosition(panelX, panelY);

				// Create array of components that need layout positioning
				const layoutComponents: Layer[] = [];
				
				// Get all children except the background (first child)
				const children = panel.getChildren();
				const isPanel = panel.getComponentType() === 'Panel';
				const startIndex = isPanel ? 1 : 0;
				
				// Add all non-background children to layout array
				for (let i = startIndex; i < children.length; i++) {
					layoutComponents.push(children[i]);
				}

				// Position using the layout components array
				if (layoutComponents.length > 0) {
					// Title at top center (first component)
					const title = layoutComponents[0];
					if (title.getComponentType() === 'Text') {
						(title as Text).setAlign('center');
					}
					title.setPosition(panelX + panelWidth / 2, panelY + 30);

					// Position other elements in the panel
					const elements = layoutComponents.slice(1);
					const elementSpacing = 70;
					const elementStartY = 80;

					elements.forEach((element, elementIndex) => {
						let x: number;
						let y: number;
						
						if (element.getComponentType() === 'Text') {
							// Center text elements
							(element as Text).setAlign('center');
							x = panelX + panelWidth / 2;
						} else {
							// Center other elements based on their width
							x = panelX + panelWidth / 2 - element.getWidth() / 2;
						}
						
						y = panelY + elementStartY + elementIndex * elementSpacing;
						element.setPosition(x, y);
					});
				}
			});
		}
	}

	/**
	 * Update FPS counter
	 */
	public onUpdate(deltaTime: number): void {
		super.onUpdate(deltaTime);

		// Update FPS
		const now = performance.now();
		this.frameCount++;

		if (now - this.lastFrameTime >= 1000) {
			this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFrameTime));
			this.fpsCounter.setText(`FPS: ${this.fps}`);
			this.frameCount = 0;
			this.lastFrameTime = now;
		}
	}

	/**
	 * Handle window resize
	 */
	protected onResized(): void {
		// Update background size
		const background = this.rootLayer.getChildren()[0] as Rectangle;
		background.setSize(window.innerWidth, window.innerHeight);
		
		// Update panel sizes to maintain their proportions
		this.updatePanelSizes();
		
		// Force layout update on all children FIRST (so text dimensions are calculated)
		this.rootLayer.layout();
		
		// Then reposition all elements (now that dimensions are correct)
		this.positionElements();
	}

	/**
	 * Update panel sizes on window resize
	 */
	private updatePanelSizes(): void {
		// Update fixed-size panels to maintain consistent sizing
		if (this.controlsPanel) {
			this.controlsPanel.setSize(300, 400);
		}
		
		if (this.styleGuidePanel) {
			this.styleGuidePanel.setSize(300, 400);
		}
		
		if (this.showcasePanel) {
			this.showcasePanel.setSize(400, 400);
		}
		
		// Update example panels
		const panels = this.rootLayer
			.getChildren()
			.filter((child) => child.getComponentType() === 'Panel');
			
		const examplePanels = panels.filter(
			(p) => p !== this.controlsPanel && p !== this.styleGuidePanel && p !== this.showcasePanel,
		);
		
		examplePanels.forEach((panel) => {
			panel.setSize(400, 300);
		});
	}
}
