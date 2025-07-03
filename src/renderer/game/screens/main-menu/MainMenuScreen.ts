import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Renderer } from '../../../engine/rendering/Renderer';
import { Button } from '../../../engine/ui/Button';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';

/**
 * Main menu screen with game options
 */
export class MainMenuScreen extends Screen {
	private background: Rectangle;
	private title: Text;
	private isElectron = false;

	/**
	 * Create a new main menu screen
	 * @param renderer WebGL renderer
	 */
	constructor(renderer: Renderer) {
		super('mainMenuScreen', renderer);
		
		// Check if running in Electron
		interface ElectronWindow extends Window {
			electron?: {
				isElectron: boolean;
				[key: string]: unknown;
			};
		}
		const electronWindow = window as ElectronWindow;
		this.isElectron = electronWindow.electron?.isElectron === true;

		// Create background
		this.background = new Rectangle({
			x: 0,
			y: 0,
			width: window.innerWidth,
			height: window.innerHeight,
			style: {
				backgroundColor: '#1a1a33',
			},
		});
		this.rootLayer.addChild(this.background);

		// Create title text
		this.title = new Text('Dual Deckbuilder', {
			style: {
				fontSize: 64,
				color: '#ffffff',
			},
		});
		this.rootLayer.addChild(this.title);

		// Create buttons
		this.createButtons();

		// Position elements
		this.positionElements();
	}

	/**
	 * Create menu buttons
	 */
	private createButtons(): void {
		const buttonWidth = 300;
		const buttonHeight = 60;
		// Unused variable removed
		// const buttonSpacing = 20;

		// Start Game button
		const startButton = new Button('Start Game', {
			width: buttonWidth,
			height: buttonHeight,
			style: {
				fontSize: 24,
			},
		});
		startButton.onClick(() => {
			ScreenManager.navigate('driverSelectionScreen');
		});
		this.rootLayer.addChild(startButton);

		// Settings button
		const settingsButton = new Button('Settings', {
			width: buttonWidth,
			height: buttonHeight,
			style: {
				fontSize: 24,
			},
		});
		settingsButton.onClick(() => {
			// Settings not implemented yet
			console.log('Settings not implemented');
		});
		this.rootLayer.addChild(settingsButton);

		// Credits button
		const creditsButton = new Button('Credits', {
			width: buttonWidth,
			height: buttonHeight,
			style: {
				fontSize: 24,
			},
		});
		creditsButton.onClick(() => {
			// Credits not implemented yet
			console.log('Credits not implemented');
		});
		this.rootLayer.addChild(creditsButton);

		// Card showcase button
		const cardShowcaseButton = new Button('Card Showcase', {
			width: buttonWidth,
			height: buttonHeight,
			style: {
				fontSize: 24,
			},
		});
		cardShowcaseButton.onClick(() => {
			ScreenManager.navigate('cardShowcaseScreen');
		});
		this.rootLayer.addChild(cardShowcaseButton);

		// Developer button
		const devButton = new Button('Developer Tools', {
			width: buttonWidth,
			height: buttonHeight,
			style: {
				fontSize: 24,
			},
		});
		devButton.onClick(() => {
			ScreenManager.navigate('developerScreen');
		});
		this.rootLayer.addChild(devButton);

		// Exit button (only for desktop)
		const exitButton = new Button('Exit Game', {
			width: buttonWidth,
			height: buttonHeight,
			style: {
				fontSize: 24,
			},
		});
		exitButton.onClick(() => {
			if (this.isElectron) {
				// In Electron mode, request to close the app
				// Would use electron API to quit
				console.log('Exit requested in Electron mode');
			}
		});

		// Only show exit button in desktop mode
		interface ElectronWindow extends Window {
			electron?: {
				isElectron: boolean;
				[key: string]: unknown;
			};
		}
		const electronWindow = window as ElectronWindow;
		if (electronWindow.electron && electronWindow.electron.isElectron === true) {
			this.rootLayer.addChild(exitButton);
		}
	}

	/**
	 * Position the menu elements
	 */
	private positionElements(): void {
		const centerX = window.innerWidth / 2;
		const titleY = window.innerHeight * 0.2;

		// Position title
		this.title.setPosition(centerX, titleY);

		// Position buttons
		const buttonWidth = 300;
		const buttonHeight = 60;
		const buttonSpacing = 20;
		const startY = window.innerHeight * 0.4;

		// Get all buttons
		const buttons = this.rootLayer
			.getChildren()
			.filter((child) => child.getComponentType() === 'Button');

		// Position each button
		buttons.forEach((button, index) => {
			button.setPosition(
				centerX - buttonWidth / 2,
				startY + index * (buttonHeight + buttonSpacing),
			);
		});
	}


	/**
	 * Handle window resize
	 */
	protected onResized(): void {
		// Update background size
		this.background.setWidth(window.innerWidth);
		this.background.setHeight(window.innerHeight);
		
		this.positionElements();
	}
}
