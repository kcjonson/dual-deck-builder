import { Screen } from '../core/Screen';
import { Renderer } from '../../engine/rendering/Renderer';
import { Text } from '../../engine/components/Text';
import { Rectangle } from '../../engine/components/Rectangle';

/**
 * Splash screen displayed when the game launches
 */
export class SplashScreen extends Screen {
	private logo: Rectangle;
	private title: Text;
	private subtitle: Text;
	private fadeInTime = 1.0; // Time in seconds to fade in
	private displayTime = 2.0; // Time in seconds to display the splash
	private fadeOutTime = 1.0; // Time in seconds to fade out
	private totalTime: number;
	private currentTime = 0;
	private onComplete: (() => void) | null = null;

	/**
	 * Create a new splash screen
	 * @param renderer WebGL renderer
	 */
	constructor(renderer: Renderer) {
		super('splashScreen', renderer);

		this.totalTime = this.fadeInTime + this.displayTime + this.fadeOutTime;

		// Set up the background
		const background = new Rectangle('splashBackground');
		background.setPosition(0, 0);
		background.setSize(window.innerWidth, window.innerHeight);
		background.setFillColor([0.05, 0.05, 0.1, 1]);
		this.rootLayer.addChild(background);

		// Create logo
		this.logo = new Rectangle('splashLogo');
		this.logo.setSize(300, 300);
		this.logo.setFillColor([0.2, 0.4, 0.8, 0]); // Start transparent
		this.logo.setCornerRadius(20);
		this.rootLayer.addChild(this.logo);

		// Create title text
		this.title = new Text('splashTitle', 'Dual Deckbuilder');
		this.title.setFontSize(48);
		this.title.setColor([1, 1, 1, 0]); // Start transparent
		this.rootLayer.addChild(this.title);

		// Create subtitle text
		this.subtitle = new Text('splashSubtitle', 'A Roguelike Card Game');
		this.subtitle.setFontSize(24);
		this.subtitle.setColor([0.8, 0.8, 0.8, 0]); // Start transparent
		this.rootLayer.addChild(this.subtitle);

		// Position elements
		this.positionElements();
	}

	/**
	 * Position the splash screen elements
	 */
	private positionElements(): void {
		const centerX = window.innerWidth / 2;
		const centerY = window.innerHeight / 2;

		// Position logo at the center
		this.logo.setPosition(
			centerX - this.logo.getWidth() / 2,
			centerY - this.logo.getHeight() / 2 - 50,
		);

		// Position title below the logo
		this.title.setPosition(centerX, centerY + 100);

		// Position subtitle below the title
		this.subtitle.setPosition(centerX, centerY + 150);
	}

	/**
	 * Set the completion callback
	 * @param callback Function to call when the splash screen completes
	 */
	public setOnComplete(callback: () => void): void {
		this.onComplete = callback;
	}

	/**
	 * Handle window resize
	 */
	protected onResized(): void {
		this.positionElements();
	}

	/**
	 * Update the splash screen
	 * @param dt Time elapsed since last frame in seconds
	 */
	protected onUpdate(dt: number): void {
		// Update timer
		this.currentTime += dt;

		// Calculate opacity based on current phase
		let opacity = 0;

		if (this.currentTime < this.fadeInTime) {
			// Fade in phase
			opacity = this.currentTime / this.fadeInTime;
		} else if (this.currentTime < this.fadeInTime + this.displayTime) {
			// Display phase
			opacity = 1;
		} else if (this.currentTime < this.totalTime) {
			// Fade out phase
			const fadeOutProgress =
				(this.currentTime - this.fadeInTime - this.displayTime) / this.fadeOutTime;
			opacity = 1 - fadeOutProgress;
		} else {
			// Complete
			opacity = 0;

			// Call the completion callback if defined
			if (this.onComplete) {
				this.onComplete();
				this.onComplete = null; // Prevent multiple calls
			}
		}

		// Update opacities
		this.logo.setFillColor([0.2, 0.4, 0.8, opacity]);
		this.title.setColor([1, 1, 1, opacity]);
		this.subtitle.setColor([0.8, 0.8, 0.8, opacity]);
	}
}
