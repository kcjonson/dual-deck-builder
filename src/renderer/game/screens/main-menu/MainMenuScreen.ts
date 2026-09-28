import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Button } from '../../../engine/ui/Button';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { formatBuildLabel } from './buildLabel';

const BUILD_LABEL_WIDTH = 240;
const BUILD_LABEL_HEIGHT = 12;
const BUILD_LABEL_MARGIN = 8;

/**
 * Main menu screen with game options
 */
export class MainMenuScreen extends Screen {
	private background: Rectangle;
	private title: Text;
	private buildLabel: Text | null = null;
	private isElectron = false;

	/**
	 * Create a new main menu screen
	 */
	constructor() {
		super('mainMenuScreen');
		
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
			id: 'main_menu_title',
			style: {
				fontSize: 64,
				color: '#ffffff',
				textAlign: 'center',
				whiteSpace: 'nowrap',
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
			id: 'main_menu_start_button',
			width: buttonWidth,
			height: buttonHeight,
			style: {
				fontSize: 24,
			},
		});
		startButton.onClick = () => {
			ScreenManager.navigate('driverSelectionScreen');
		};
		this.rootLayer.addChild(startButton);

		// Settings button
		const settingsButton = new Button('Settings', {
			id: 'main_menu_settings_button',
			width: buttonWidth,
			height: buttonHeight,
			style: {
				fontSize: 24,
			},
		});
		settingsButton.onClick = () => {
			// Settings not implemented yet
			console.log('Settings not implemented');
		};
		this.rootLayer.addChild(settingsButton);

		// Credits button
		const creditsButton = new Button('Credits', {
			id: 'main_menu_credits_button',
			width: buttonWidth,
			height: buttonHeight,
			style: {
				fontSize: 24,
			},
		});
		creditsButton.onClick = () => {
			// Credits not implemented yet
			console.log('Credits not implemented');
		};
		this.rootLayer.addChild(creditsButton);

		// Card showcase button
		const cardShowcaseButton = new Button('Card Showcase', {
			id: 'main_menu_card_showcase_button',
			width: buttonWidth,
			height: buttonHeight,
			style: {
				fontSize: 24,
			},
		});
		cardShowcaseButton.onClick = () => {
			ScreenManager.navigate('cardShowcaseScreen');
		};
		this.rootLayer.addChild(cardShowcaseButton);

		// Developer button
		const devButton = new Button('Developer Tools', {
			id: 'main_menu_developer_button',
			width: buttonWidth,
			height: buttonHeight,
			style: {
				fontSize: 24,
			},
		});
		devButton.onClick = () => {
			ScreenManager.navigate('developerScreen');
		};
		this.rootLayer.addChild(devButton);

		// Exit button (only for desktop)
		const exitButton = new Button('Exit Game', {
			width: buttonWidth,
			height: buttonHeight,
			style: {
				fontSize: 24,
			},
		});
		exitButton.onClick = () => {
			if (this.isElectron) {
				// In Electron mode, request to close the app
				// Would use electron API to quit
				console.log('Exit requested in Electron mode');
			}
		};

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
	 * The build stamp in the bottom-right corner, so a playtester can tell
	 * which deploy they're on. Development builds define no SHA and show none,
	 * which keeps the main menu goldens stable across commits.
	 */
	protected onMount(): void {
		const label = formatBuildLabel({ sha: __BUILD_SHA__, number: __BUILD_NUMBER__ });
		if (!label) return;

		// An explicit box rather than a zero-width anchor, so a layout pass
		// can't resize it and shift the right edge.
		this.buildLabel = new Text(label, {
			id: 'main_menu_build_label',
			width: BUILD_LABEL_WIDTH,
			height: BUILD_LABEL_HEIGHT,
			style: {
				fontSize: 12,
				color: '#6b6b8f',
				textAlign: 'right',
				verticalAlign: 'bottom',
				whiteSpace: 'nowrap',
			},
		});
		this.rootLayer.addChild(this.buildLabel);
		this.positionBuildLabel();
	}

	private positionBuildLabel(): void {
		this.buildLabel?.setPosition(
			window.innerWidth - BUILD_LABEL_WIDTH - BUILD_LABEL_MARGIN,
			window.innerHeight - BUILD_LABEL_HEIGHT - BUILD_LABEL_MARGIN,
		);
	}

	/**
	 * Position the menu elements
	 */
	private positionElements(): void {
		const centerX = window.innerWidth / 2;
		const titleY = window.innerHeight * 0.2;

		// Title centred across the screen
		this.title.setPosition(0, titleY);
		this.title.setWidth(window.innerWidth);

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
		this.positionBuildLabel();
	}
}
