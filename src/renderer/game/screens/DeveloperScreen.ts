import { Screen } from '../core/Screen';
import { Renderer } from '../../engine/rendering/Renderer';
import { Button } from '../../engine/ui/Button';
import { Text } from '../../engine/components/Text';
import { Rectangle } from '../../engine/components/Rectangle';
import { Panel } from '../../engine/ui/Panel';
import { Input } from '../../engine/ui/Input';
import { Circle } from '../../engine/components/Circle';
import { Triangle } from '../../engine/components/Triangle';

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
		// Create a main scrollable container that takes up most of the right side of the screen
		const mainScrollContainer = new Panel({
			width: 600, // Wider container for better content layout
			height: window.innerHeight - 200, // Full height minus top margin
			scrollable: true,
			scrollDirection: 'vertical',
			style: {
				backgroundColor: '#1a1a1a99', // Semi-transparent dark background
				borderRadius: 8,
			},
		});
		mainScrollContainer.setPosition(400, 100); // Position on the right side

		// Set content size for a long scrollable document
		// We'll calculate this based on all the content sections
		const contentHeight = 2000; // Plenty of space for all examples
		mainScrollContainer.setContentSize(600, contentHeight);

		this.rootLayer.addChild(mainScrollContainer);

		// Current Y position for laying out content vertically
		let currentY = 40;
		const sectionSpacing = 60;
		const leftMargin = 40;
		const rightMargin = 40;
		const contentWidth = 600 - leftMargin - rightMargin;

		// === RECTANGLES SECTION ===
		const rectanglesTitle = new Text('Rectangle Examples', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		rectanglesTitle.setPosition(leftMargin, currentY);
		mainScrollContainer.addChild(rectanglesTitle);
		currentY += 50;

		// Add example rectangles in a row
		let rectX = leftMargin;
		const rectY = currentY;
		const rectSpacing = 120;

		const rect1 = new Rectangle({
			width: 80,
			height: 80,
			style: {
				backgroundColor: '#ff0000',
				borderRadius: 8,
			},
		});
		rect1.setPosition(rectX, rectY);
		mainScrollContainer.addChild(rect1);
		rectX += rectSpacing;

		const rect2 = new Rectangle({
			width: 80,
			height: 80,
			style: {
				backgroundColor: '#00ff00',
				borderRadius: 20,
			},
		});
		rect2.setPosition(rectX, rectY);
		mainScrollContainer.addChild(rect2);
		rectX += rectSpacing;

		const rect3 = new Rectangle({
			width: 80,
			height: 80,
			style: {
				backgroundColor: '#0000ff',
				border: '4px solid #ffffff',
				borderRadius: 12,
			},
		});
		rect3.setPosition(rectX, rectY);
		mainScrollContainer.addChild(rect3);
		rectX += rectSpacing;

		const rect4 = new Rectangle({
			width: 80,
			height: 80,
			style: {
				backgroundColor: '#ffff00',
				borderRadius: 40, // Full circle
			},
		});
		rect4.setPosition(rectX, rectY);
		mainScrollContainer.addChild(rect4);

		currentY += 120 + sectionSpacing;

		// === BUTTONS SECTION ===
		const buttonsTitle = new Text('Button Examples', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		buttonsTitle.setPosition(leftMargin, currentY);
		mainScrollContainer.addChild(buttonsTitle);
		currentY += 50;

		// Add example buttons vertically
		const button1 = new Button('Standard Button', {
			width: 200,
			height: 50,
		});
		button1.setPosition(leftMargin, currentY);
		mainScrollContainer.addChild(button1);
		currentY += 70;

		const button2 = new Button('Custom Style Button', {
			width: 200,
			height: 50,
		});
		button2.setFillColor('#cc3333');
		button2.setTextColor('#ffffff');
		button2.setPosition(leftMargin, currentY);
		mainScrollContainer.addChild(button2);
		currentY += 70;

		const button3 = new Button('Disabled Button', {
			width: 200,
			height: 50,
		});
		button3.setEnabled(false);
		button3.setPosition(leftMargin, currentY);
		mainScrollContainer.addChild(button3);
		currentY += 70;

		const button4 = new Button('Wide Button', {
			width: contentWidth - 100,
			height: 50,
		});
		button4.setPosition(leftMargin, currentY);
		mainScrollContainer.addChild(button4);

		currentY += 90 + sectionSpacing;

		// === TEXT SECTION ===
		const textTitle = new Text('Text Examples', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		textTitle.setPosition(leftMargin, currentY);
		mainScrollContainer.addChild(textTitle);
		currentY += 50;

		const textExamples = [
			{ text: 'Standard text in white', style: { fontSize: 18, color: '#ffffff' } },
			{ text: 'Colored text in orange', style: { fontSize: 18, color: '#ff8000' } },
			{ text: 'Large blue text', style: { fontSize: 24, color: '#4080ff' } },
			{ text: 'Small green text', style: { fontSize: 14, color: '#40ff80' } },
			{ text: 'Extra large purple text', style: { fontSize: 32, color: '#8040ff' } },
		];

		textExamples.forEach((example) => {
			const textComponent = new Text(example.text, {
				style: example.style,
			});
			textComponent.setPosition(leftMargin, currentY);
			mainScrollContainer.addChild(textComponent);
			currentY += example.style.fontSize + 15;
		});

		currentY += sectionSpacing;

		// === INPUT SECTION ===
		const inputTitle = new Text('Input Examples', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		inputTitle.setPosition(leftMargin, currentY);
		mainScrollContainer.addChild(inputTitle);
		currentY += 50;

		const input1 = new Input('Standard input field', {
			width: 250,
			height: 40,
		});
		input1.setPosition(leftMargin, currentY);
		mainScrollContainer.addChild(input1);
		currentY += 60;

		const input2 = new Input('Password input', {
			width: 250,
			height: 40,
		});
		input2.setPosition(leftMargin, currentY);
		mainScrollContainer.addChild(input2);
		currentY += 60;

		const input3 = new Input('Wide input field', {
			width: contentWidth - 100,
			height: 40,
		});
		input3.setPosition(leftMargin, currentY);
		mainScrollContainer.addChild(input3);

		currentY += 80 + sectionSpacing;

		// === PRIMITIVE SHAPES SECTION ===
		const primitivesTitle = new Text('Primitive Shapes', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		primitivesTitle.setPosition(leftMargin, currentY);
		mainScrollContainer.addChild(primitivesTitle);
		currentY += 50;

		// Add circles in a row
		let shapeX = leftMargin;
		const shapeY = currentY;
		const shapeSpacing = 100;

		const circle1 = new Circle({
			style: {
				backgroundColor: '#ff0000',
			},
		});
		circle1.setRadius(35);
		circle1.setPosition(shapeX, shapeY);
		mainScrollContainer.addChild(circle1);
		shapeX += shapeSpacing;

		const circle2 = new Circle({
			style: {
				backgroundColor: '#00ff00',
				borderColor: '#ffffff',
				borderWidth: 3,
			},
		});
		circle2.setRadius(30);
		circle2.setPosition(shapeX, shapeY);
		mainScrollContainer.addChild(circle2);
		shapeX += shapeSpacing;

		const circle3 = new Circle({
			style: {
				backgroundColor: '#0000ff80', // Semi-transparent blue
				borderColor: '#ffff00',
				borderWidth: 2,
			},
		});
		circle3.setRadius(25);
		circle3.setPosition(shapeX, shapeY);
		mainScrollContainer.addChild(circle3);

		currentY += 100;

		// Add triangles in a row below circles
		shapeX = leftMargin;
		const triangleY = currentY;

		const triangle1 = new Triangle({
			width: 70,
			height: 70,
			style: {
				backgroundColor: '#ff8000',
			},
		});
		triangle1.setPosition(shapeX, triangleY);
		mainScrollContainer.addChild(triangle1);
		shapeX += shapeSpacing;

		const triangle2 = new Triangle({
			width: 60,
			height: 60,
			style: {
				backgroundColor: '#8000ff',
				borderColor: '#ffffff',
				borderWidth: 2,
			},
		});
		triangle2.setPosition(shapeX, triangleY);
		mainScrollContainer.addChild(triangle2);
		shapeX += shapeSpacing;

		const triangle3 = new Triangle({
			width: 50,
			height: 50,
			style: {
				backgroundColor: '#00ff8080',
				borderColor: '#ff0080',
				borderWidth: 3,
			},
		});
		triangle3.setPosition(shapeX, triangleY);
		mainScrollContainer.addChild(triangle3);

		currentY += 100 + sectionSpacing;

		// === NESTED PANELS SECTION ===
		const panelsTitle = new Text('Panel Examples', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		panelsTitle.setPosition(leftMargin, currentY);
		mainScrollContainer.addChild(panelsTitle);
		currentY += 50;

		// Create a nested panel with some content
		const nestedPanel = new Panel({
			width: contentWidth - 100,
			height: 150,
			style: {
				backgroundColor: '#333333e6',
				borderRadius: 8,
				border: '2px solid #555555',
			},
		});
		nestedPanel.setPosition(leftMargin, currentY);

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

		mainScrollContainer.addChild(nestedPanel);
		currentY += 170 + sectionSpacing;

		// Update the content size based on actual content
		mainScrollContainer.setContentSize(600, currentY + 100);
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

		// All positions are now local to the panel (0,0 = panel's top-left)
		let y = 30;

		// Position title (centered)
		this.controlsTitle.setAlign('center');
		this.controlsTitle.setPosition(150, y);
		y += 50;

		// Demo rectangle
		this.demoRectangle.setPosition(100, y);
		y += 120;

		// Color label
		this.colorLabel.setPosition(20, y);
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
			input.setPosition(x, y);
			x += 70;
		});
		y += 50;

		// Size label
		this.sizeLabel.setPosition(20, y);
		y += 30;

		// Size inputs
		this.sizeControls.width.setPosition(20, y);
		this.sizeControls.height.setPosition(110, y);
	}

	/**
	 * Position style guide panel elements
	 */
	private positionStyleGuidePanel(): void {
		if (!this.styleGuidePanel) return;

		// All positions are now local to the panel (0,0 = panel's top-left)
		let y = 30;

		// Title (centered)
		this.styleTitle.setAlign('center');
		this.styleTitle.setPosition(150, y);
		y += 50;

		// Palette label
		this.paletteLabel.setPosition(20, y);
		y += 30;

		// Color palette grid
		let x = 20;
		let colorIndex = 0;
		this.colorPalette.forEach((rect) => {
			rect.setPosition(x, y);
			x += 60;
			colorIndex++;
			if (colorIndex % 4 === 0) {
				x = 20;
				y += 60;
			}
		});
		y += 20;

		// Typography label
		this.typographyLabel.setPosition(20, y);
		y += 30;

		// Font size examples
		this.fontExamples.forEach((text) => {
			text.setPosition(20, y);
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

		// All positions are now local to the panel (0,0 = panel's top-left)
		let y = 30;

		// Title (centered)
		this.showcaseTitle.setAlign('center');
		this.showcaseTitle.setPosition(200, y);
		y += 50;

		// Input examples
		this.inputExamples.forEach((input) => {
			input.setPosition(50, y);
			y += 60;
		});

		// Output label and text
		this.outputLabel.setPosition(50, y);
		this.outputText.setPosition(50, y + 25);
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
