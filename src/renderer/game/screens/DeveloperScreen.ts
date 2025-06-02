import { Screen } from '../core/Screen';
import { Renderer } from '../../engine/rendering/Renderer';
import { Button } from '../../engine/ui/Button';
import { Text } from '../../engine/components/Text';
import { Panel } from '../../engine/ui/Panel';
import { Rectangle } from '../../engine/components/Rectangle';

// Import all section components
import { InteractiveControlsSection } from './InteractiveControlsSection';
import { StyleGuideSection } from './StyleGuideSection';
import { InputShowcaseSection } from './InputShowcaseSection';
import { RectangleExamplesSection } from './RectangleExamplesSection';
import { ButtonExamplesSection } from './ButtonExamplesSection';
import { TextExamplesSection } from './TextExamplesSection';
import { PrimitiveShapesSection } from './PrimitiveShapesSection';
import { NestedPanelsSection } from './NestedPanelsSection';

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
		const interactiveSection = new InteractiveControlsSection(margin, currentY, contentWidth);
		mainScrollContainer.addChild(interactiveSection);
		currentY += interactiveSection.getHeight() + sectionSpacing;

		// === STYLE GUIDE SECTION ===
		const styleGuideSection = new StyleGuideSection(margin, currentY, contentWidth);
		mainScrollContainer.addChild(styleGuideSection);
		currentY += styleGuideSection.getHeight() + sectionSpacing;

		// === INPUT SHOWCASE SECTION ===
		const inputSection = new InputShowcaseSection(margin, currentY, contentWidth);
		mainScrollContainer.addChild(inputSection);
		currentY += inputSection.getHeight() + sectionSpacing;

		// === RECTANGLES SECTION ===
		const rectangleSection = new RectangleExamplesSection(margin, currentY, contentWidth);
		mainScrollContainer.addChild(rectangleSection);
		currentY += rectangleSection.getHeight() + sectionSpacing;

		// === BUTTONS SECTION ===
		const buttonSection = new ButtonExamplesSection(margin, currentY, contentWidth);
		mainScrollContainer.addChild(buttonSection);
		currentY += buttonSection.getHeight() + sectionSpacing;

		// === TEXT SECTION ===
		const textSection = new TextExamplesSection(margin, currentY, contentWidth);
		mainScrollContainer.addChild(textSection);
		currentY += textSection.getHeight() + sectionSpacing;

		// === PRIMITIVE SHAPES SECTION ===
		const shapesSection = new PrimitiveShapesSection(margin, currentY, contentWidth);
		mainScrollContainer.addChild(shapesSection);
		currentY += shapesSection.getHeight() + sectionSpacing;

		// === NESTED PANELS SECTION ===
		const nestedSection = new NestedPanelsSection(margin, currentY, contentWidth);
		mainScrollContainer.addChild(nestedSection);
		currentY += nestedSection.getHeight() + sectionSpacing;

		// Update the content size based on actual content height
		mainScrollContainer.setContentSize(window.innerWidth, currentY + 100);
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
