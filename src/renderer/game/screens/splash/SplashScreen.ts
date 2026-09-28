import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';

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

	/**
	 * Create a new splash screen
	 */
	constructor() {
		super('splashScreen');

		this.totalTime = this.fadeInTime + this.displayTime + this.fadeOutTime;

		// Set up the background
		const background = new Rectangle({
			x: 0,
			y: 0,
			width: window.innerWidth,
			height: window.innerHeight,
			style: {
				backgroundColor: '#0d0d1a',
			},
		});
		this.rootLayer.addChild(background);

		// Create logo
		this.logo = new Rectangle({
			id: 'splash_logo',
			width: 300,
			height: 300,
			style: {
				backgroundColor: '#3366cc',
				borderRadius: 20,
			},
		});
		this.rootLayer.addChild(this.logo);

		// Create title text
		this.title = new Text('Dual Deckbuilder', {
			id: 'splash_title',
			style: {
				fontSize: 48,
				color: '#ffffff',
				textAlign: 'center',
				whiteSpace: 'nowrap',
			},
		});
		this.rootLayer.addChild(this.title);

		// Create subtitle text
		this.subtitle = new Text('A Roguelike Card Game', {
			id: 'splash_subtitle',
			style: {
				fontSize: 24,
				color: '#cccccc',
				textAlign: 'center',
				whiteSpace: 'nowrap',
			},
		});
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

		// Title below the logo and the subtitle under its line box, both centred
		// across the screen
		this.title.setPosition(0, centerY + 100);
		this.title.setWidth(window.innerWidth);
		this.subtitle.setPosition(0, this.title.getY() + this.title.getHeight());
		this.subtitle.setWidth(window.innerWidth);
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
		// TODO: Implement fade in/out animations when opacity support is added to components
		// let opacity = 0;

		if (this.currentTime < this.fadeInTime) {
			// Fade in phase
			// opacity = this.currentTime / this.fadeInTime;
		} else if (this.currentTime < this.fadeInTime + this.displayTime) {
			// Display phase
			// opacity = 1;
		} else if (this.currentTime < this.totalTime) {
			// Fade out phase
			// const fadeOutProgress =
			//	(this.currentTime - this.fadeInTime - this.displayTime) / this.fadeOutTime;
			// opacity = 1 - fadeOutProgress;
		} else {
			// Complete
			// opacity = 0; // Animation complete

			// Navigate to main menu
			ScreenManager.navigate('mainMenuScreen');
		}

		// Update colors (keeping them solid for simplicity)
		this.logo.setFillColor('#3366cc');
		this.title.setColor('#ffffff');
		this.subtitle.setColor('#cccccc');
	}
}
