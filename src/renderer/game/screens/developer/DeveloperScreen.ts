import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Button } from '../../../engine/ui/Button';
import { Text } from '../../../engine/components/Text';
import { Panel } from '../../../engine/ui/Panel';
import { Rectangle } from '../../../engine/components/Rectangle';
import { InputSystem } from '../../../engine/input/InputSystem';

// The sections are defined once, in sections.ts, so this screen and the
// ?scene= gallery show the same eight things (R13.30).
import { developerSections } from './sections';

/**
 * Developer screen for testing UI components and rendering
 */
export class DeveloperScreen extends Screen {
	private background: Rectangle;
	private title: Text;
	private backButton: Button;
	private mainScrollContainer!: Panel;


	/**
	 * Create a new developer screen
	 */
	constructor() {
		super('developerScreen');

		// Create background
		this.background = new Rectangle({
			x: 0,
			y: 0,
			width: this.rootLayer.getWidth(),
			height: this.rootLayer.getHeight(),
			style: {
				backgroundColor: '#262626',
			},
		});
		this.rootLayer.addChild(this.background);

		// Create title text
		this.title = new Text('Developer Tools', {
			id: 'dev_title',
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
			ScreenManager.navigate('mainMenuScreen');
		});
		this.rootLayer.addChild(this.backButton);


		// Create single main scrollable container for everything
		this.createMainScrollableContent();

		// Position fixed elements
		this.positionFixedElements();
	}

	/**
	 * Position fixed elements that don't scroll
	 */
	private positionFixedElements(): void {
		const centerX = this.rootLayer.getWidth() / 2;

		// Position title (centered)
		this.title.setAlign('center');
		this.title.setPosition(centerX, 30);

		// Position back button (bottom center)
		this.backButton.setPosition(centerX - this.backButton.getWidth() / 2, this.rootLayer.getHeight() - 70);

	}

	/**
	 * Create main scrollable container with all content
	 */
	private createMainScrollableContent(): void {
		// Create a full-window scrollable container that holds all content
		this.mainScrollContainer = new Panel({
			id: 'dev_scroll',
			width: this.rootLayer.getWidth(),
			height: this.rootLayer.getHeight() - 160, // Leave space for title (80) and back button (80)
			scrollable: true,
			scrollDirection: 'vertical',
			overflow: 'hidden',
			style: {
				backgroundColor: '#262626', // Match the background
			},
		});
		this.mainScrollContainer.setPosition(0, 80); // Position below title

		this.rootLayer.addChild(this.mainScrollContainer);

		// Layout parameters for full-width vertical sections
		let currentY = 40;
		const sectionSpacing = 80;
		const margin = 40;
		const contentWidth = this.rootLayer.getWidth() - margin * 2;

		// A section computes its own height from its content and publishes it
		// with setSize on the last line of its constructor, so the next
		// section's y is only knowable after the previous factory returned.
		for (const definition of developerSections) {
			const section = definition.build({ x: margin, y: currentY, width: contentWidth });
			this.mainScrollContainer.addChild(section);
			currentY += section.getHeight() + sectionSpacing;
		}

		// Update the content size based on actual content height
		this.mainScrollContainer.setContentSize(this.rootLayer.getWidth(), currentY + 100);
	}



	/**
	 * Update - removed FPS counter as it's now in dev overlay
	 */
	public onUpdate(deltaTime: number): void {
		super.onUpdate(deltaTime);
	}

	/**
	 * Handle window resize
	 */
	protected onResized(): void {
		// Update background size
		if (this.background) {
			this.background.setSize(this.rootLayer.getWidth(), this.rootLayer.getHeight());
		}

		// Force layout update on all children FIRST (so text dimensions are calculated)
		this.rootLayer.layout();

		// Then reposition all elements (now that dimensions are correct)
		this.positionFixedElements();
		
		// Update scroll container size
		if (this.mainScrollContainer) {
			this.mainScrollContainer.setSize(
				this.rootLayer.getWidth(),
				this.rootLayer.getHeight() - 160 // Leave space for title (80) and back button (80)
			);
			
			// Note: Content height is preserved automatically, we don't need to update it
		}
	}

	/**
	 * Handle screen unmount
	 */
	protected onUnmount(): void {
		// Clear any focus from input fields
		if (InputSystem.getFocus()) {
			InputSystem.setFocus(null);
		}
		
		// Find and reset scroll position of the main panel
		const children = this.rootLayer.getChildren();
		for (const child of children) {
			if (child instanceof Panel && child.getY() === 80) { // The main scroll container
				child.setScrollOffset(0, 0); // Reset both x and y scroll
				break;
			}
		}
	}
}
