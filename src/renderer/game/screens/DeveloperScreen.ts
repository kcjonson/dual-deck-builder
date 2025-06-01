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

		// Create FPS counter (stays fixed, not scrollable)
		this.createFpsCounter();

		// Create single main scrollable container for everything
		this.createMainScrollableContent();

		// Position fixed elements
		this.positionFixedElements();
	}

	/**
	 * Position fixed elements that don't scroll
	 */
	private positionFixedElements(): void {
		const centerX = window.innerWidth / 2;

		// Position title (centered)
		this.title.setAlign('center');
		this.title.setPosition(centerX, 30);

		// Position back button (bottom center)
		this.backButton.setPosition(centerX - this.backButton.getWidth() / 2, window.innerHeight - 70);

		// Position FPS counter
		this.fpsCounter.setPosition(window.innerWidth - 100, 20);
	}

	/**
	 * Create main scrollable container with all content
	 */
	private createMainScrollableContent(): void {
		// Create a full-window scrollable container that holds all content
		const mainScrollContainer = new Panel({
			width: window.innerWidth,
			height: window.innerHeight - 160, // Leave space for title (80) and back button (80)
			scrollable: true,
			scrollDirection: 'vertical',
			overflow: 'hidden',
			style: {
				backgroundColor: '#262626', // Match the background
			},
		});
		mainScrollContainer.setPosition(0, 80); // Position below title

		this.rootLayer.addChild(mainScrollContainer);

		// Layout parameters for full-width vertical sections
		let currentY = 40;
		const sectionSpacing = 80;
		const margin = 40;
		const contentWidth = window.innerWidth - margin * 2;

		// === INTERACTIVE CONTROLS SECTION ===
		currentY += this.createInteractiveControlsSection(
			mainScrollContainer,
			margin,
			currentY,
			contentWidth,
		);
		currentY += sectionSpacing;

		// === STYLE GUIDE SECTION ===
		currentY += this.createStyleGuideSection(mainScrollContainer, margin, currentY, contentWidth);
		currentY += sectionSpacing;

		// === INPUT SHOWCASE SECTION ===
		currentY += this.createInputShowcaseSection(
			mainScrollContainer,
			margin,
			currentY,
			contentWidth,
		);
		currentY += sectionSpacing;

		// === RECTANGLES SECTION ===
		currentY += this.createRectangleExamplesSection(
			mainScrollContainer,
			margin,
			currentY,
			contentWidth,
		);
		currentY += sectionSpacing;

		// === BUTTONS SECTION ===
		currentY += this.createButtonExamplesSection(
			mainScrollContainer,
			margin,
			currentY,
			contentWidth,
		);
		currentY += sectionSpacing;

		// === TEXT SECTION ===
		currentY += this.createTextExamplesSection(mainScrollContainer, margin, currentY, contentWidth);
		currentY += sectionSpacing;

		// === PRIMITIVE SHAPES SECTION ===
		currentY += this.createPrimitiveShapesSection(
			mainScrollContainer,
			margin,
			currentY,
			contentWidth,
		);
		currentY += sectionSpacing;

		// === NESTED PANELS SECTION ===
		currentY += this.createNestedPanelsSection(mainScrollContainer, margin, currentY, contentWidth);
		currentY += sectionSpacing;

		// Update the content size based on actual content height
		mainScrollContainer.setContentSize(window.innerWidth, currentY + 100);
	}

	// === SECTION CREATION METHODS ===

	private createInteractiveControlsSection(
		container: Panel,
		x: number,
		y: number,
		width: number,
	): number {
		const sectionTitle = new Text('Interactive Controls', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		sectionTitle.setPosition(x, y);
		container.addChild(sectionTitle);

		let currentY = y + 50;

		// Create demo rectangle to control
		const demoRectangle = new Rectangle({
			width: 100,
			height: 100,
			style: {
				backgroundColor: '#ff6600',
				borderRadius: 10,
			},
		});
		demoRectangle.setPosition(x + 20, currentY);
		container.addChild(demoRectangle);
		currentY += 120;

		// Color controls
		const colorLabel = new Text('Color (R,G,B,A):', {
			style: {
				fontSize: 16,
				color: '#ffffff',
			},
		});
		colorLabel.setPosition(x + 20, currentY);
		container.addChild(colorLabel);
		currentY += 30;

		// Create color inputs in a row
		let inputX = x + 20;
		const colorInputs = ['255', '102', '0', '255'];
		colorInputs.forEach((value) => {
			const input = new Input(value, {
				width: 60,
				height: 30,
			});
			input.setPosition(inputX, currentY);
			container.addChild(input);
			inputX += 70;
		});
		currentY += 50;

		// Size controls
		const sizeLabel = new Text('Size (W x H):', {
			style: {
				fontSize: 16,
				color: '#ffffff',
			},
		});
		sizeLabel.setPosition(x + 20, currentY);
		container.addChild(sizeLabel);
		currentY += 30;

		const widthInput = new Input('100', {
			width: 80,
			height: 30,
		});
		widthInput.setPosition(x + 20, currentY);
		container.addChild(widthInput);

		const heightInput = new Input('100', {
			width: 80,
			height: 30,
		});
		heightInput.setPosition(x + 110, currentY);
		container.addChild(heightInput);
		currentY += 50;

		return currentY - y; // Return height used
	}

	private createStyleGuideSection(container: Panel, x: number, y: number, width: number): number {
		const sectionTitle = new Text('Style Guide', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		sectionTitle.setPosition(x, y);
		container.addChild(sectionTitle);

		let currentY = y + 50;

		// Color palette
		const paletteLabel = new Text('Color Palette:', {
			style: {
				fontSize: 16,
				color: '#ffffff',
			},
		});
		paletteLabel.setPosition(x + 20, currentY);
		container.addChild(paletteLabel);
		currentY += 30;

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

		let colorX = x + 20;
		let colorY = currentY;
		colors.forEach((color, index) => {
			const rect = new Rectangle({
				width: 50,
				height: 50,
				style: {
					backgroundColor: color,
					border: '2px solid #ffffff',
				},
			});
			rect.setPosition(colorX, colorY);
			container.addChild(rect);
			colorX += 60;
			if ((index + 1) % 4 === 0) {
				colorX = x + 20;
				colorY += 60;
			}
		});
		currentY = colorY + 60 + 20;

		// Typography examples
		const typographyLabel = new Text('Typography:', {
			style: {
				fontSize: 16,
				color: '#ffffff',
			},
		});
		typographyLabel.setPosition(x + 20, currentY);
		container.addChild(typographyLabel);
		currentY += 30;

		const fontSizes = [48, 32, 24, 20, 16, 14];
		fontSizes.forEach((size) => {
			const text = new Text(`Size ${size}`, {
				style: {
					fontSize: size,
					color: '#ffffff',
				},
			});
			text.setPosition(x + 20, currentY);
			container.addChild(text);
			currentY += size + 15;
		});

		return currentY - y;
	}

	private createInputShowcaseSection(
		container: Panel,
		x: number,
		y: number,
		width: number,
	): number {
		const sectionTitle = new Text('Input Components', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		sectionTitle.setPosition(x, y);
		container.addChild(sectionTitle);

		let currentY = y + 50;

		// Create various input examples
		const inputs = [
			{ placeholder: 'Enter text here...', value: '' },
			{ placeholder: '', value: 'Pre-filled value' },
			{ placeholder: '', value: 'Disabled input', disabled: true },
			{ placeholder: 'Max 10 chars', value: '', maxLength: 10 },
		];

		inputs.forEach((inputConfig) => {
			const input = new Input(inputConfig.placeholder, {
				width: 300,
				height: 40,
			});
			if (inputConfig.value) {
				input.setValue(inputConfig.value);
			}
			if (inputConfig.disabled) {
				input.setEnabled(false);
			}
			if (inputConfig.maxLength) {
				input.setMaxLength(inputConfig.maxLength);
			}
			input.setPosition(x + 20, currentY);
			container.addChild(input);
			currentY += 60;
		});

		// Add output display
		const outputLabel = new Text('Last changed value:', {
			style: {
				fontSize: 16,
				color: '#ffffff',
			},
		});
		outputLabel.setPosition(x + 20, currentY);
		container.addChild(outputLabel);
		currentY += 25;

		const outputText = new Text('', {
			style: {
				fontSize: 16,
				color: '#ffcc00',
			},
		});
		outputText.setPosition(x + 20, currentY);
		container.addChild(outputText);
		currentY += 30;

		return currentY - y;
	}

	private createRectangleExamplesSection(
		container: Panel,
		x: number,
		y: number,
		width: number,
	): number {
		const sectionTitle = new Text('Rectangle Examples', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		sectionTitle.setPosition(x, y);
		container.addChild(sectionTitle);

		let currentY = y + 50;

		// Add example rectangles in a row
		let rectX = x + 20;
		const rectY = currentY;
		const rectSpacing = 120;

		const rectangles = [
			{ backgroundColor: '#ff0000', borderRadius: 8 },
			{ backgroundColor: '#00ff00', borderRadius: 20 },
			{ backgroundColor: '#0000ff', border: '4px solid #ffffff', borderRadius: 12 },
			{ backgroundColor: '#ffff00', borderRadius: 40 }, // Full circle
		];

		rectangles.forEach((style) => {
			const rect = new Rectangle({
				width: 80,
				height: 80,
				style: style,
			});
			rect.setPosition(rectX, rectY);
			container.addChild(rect);
			rectX += rectSpacing;
		});

		currentY += 120;
		return currentY - y;
	}

	private createButtonExamplesSection(
		container: Panel,
		x: number,
		y: number,
		width: number,
	): number {
		const sectionTitle = new Text('Button Examples', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		sectionTitle.setPosition(x, y);
		container.addChild(sectionTitle);

		let currentY = y + 50;

		// Add example buttons vertically
		const button1 = new Button('Standard Button', {
			width: 200,
			height: 50,
		});
		button1.setPosition(x + 20, currentY);
		container.addChild(button1);
		currentY += 70;

		const button2 = new Button('Custom Style Button', {
			width: 200,
			height: 50,
		});
		button2.setFillColor('#cc3333');
		button2.setTextColor('#ffffff');
		button2.setPosition(x + 20, currentY);
		container.addChild(button2);
		currentY += 70;

		const button3 = new Button('Disabled Button', {
			width: 200,
			height: 50,
		});
		button3.setEnabled(false);
		button3.setPosition(x + 20, currentY);
		container.addChild(button3);
		currentY += 70;

		const button4 = new Button('Wide Button', {
			width: Math.min(width - 40, 600),
			height: 50,
		});
		button4.setPosition(x + 20, currentY);
		container.addChild(button4);
		currentY += 70;

		return currentY - y;
	}

	private createTextExamplesSection(container: Panel, x: number, y: number, width: number): number {
		const sectionTitle = new Text('Text Examples', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		sectionTitle.setPosition(x, y);
		container.addChild(sectionTitle);

		let currentY = y + 50;

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
			textComponent.setPosition(x + 20, currentY);
			container.addChild(textComponent);
			currentY += example.style.fontSize + 15;
		});

		return currentY - y;
	}

	private createPrimitiveShapesSection(
		container: Panel,
		x: number,
		y: number,
		width: number,
	): number {
		const sectionTitle = new Text('Primitive Shapes', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		sectionTitle.setPosition(x, y);
		container.addChild(sectionTitle);

		let currentY = y + 50;

		// Add circles in a row
		let shapeX = x + 20;
		const shapeY = currentY;
		const shapeSpacing = 100;

		const circle1 = new Circle({
			style: {
				backgroundColor: '#ff0000',
			},
		});
		circle1.setRadius(35);
		circle1.setPosition(shapeX, shapeY);
		container.addChild(circle1);
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
		container.addChild(circle2);
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
		container.addChild(circle3);

		currentY += 100;

		// Add triangles in a row below circles
		shapeX = x + 20;
		const triangleY = currentY;

		const triangle1 = new Triangle({
			width: 70,
			height: 70,
			style: {
				backgroundColor: '#ff8000',
			},
		});
		triangle1.setPosition(shapeX, triangleY);
		container.addChild(triangle1);
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
		container.addChild(triangle2);
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
		container.addChild(triangle3);

		currentY += 100;
		return currentY - y;
	}

	private createNestedPanelsSection(container: Panel, x: number, y: number, width: number): number {
		const sectionTitle = new Text('Panel Examples', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		sectionTitle.setPosition(x, y);
		container.addChild(sectionTitle);

		let currentY = y + 50;

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
		nestedPanel.setPosition(x + 20, currentY);

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

		container.addChild(nestedPanel);
		currentY += 170;

		return currentY - y;
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
	 * Set callback for when Back button is clicked
	 */
	public setOnBack(callback: () => void): void {
		this.onBack = callback;
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

		// Force layout update on all children FIRST (so text dimensions are calculated)
		this.rootLayer.layout();

		// Then reposition all elements (now that dimensions are correct)
		this.positionFixedElements();
	}
}
