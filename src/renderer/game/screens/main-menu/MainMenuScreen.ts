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
	/** Stacked down the middle in this order. */
	private buttons: Button[] = [];
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

		// Sized with the root in positionElements
		this.background = new Rectangle({
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

		this.createButtons();
	}

	/**
	 * Create menu buttons
	 */
	private createButtons(): void {
		const buttonWidth = 300;
		const buttonHeight = 60;

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
		this.addButton(startButton);

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
		this.addButton(settingsButton);

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
		this.addButton(creditsButton);

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
		this.addButton(cardShowcaseButton);

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
		this.addButton(devButton);

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
		if (this.isElectron) {
			this.addButton(exitButton);
		}
	}

	private addButton(button: Button): void {
		this.buttons.push(button);
		this.rootLayer.addChild(button);
	}

	/**
	 * The build stamp in the bottom-right corner, so a playtester can tell
	 * which deploy they're on. Development builds define no SHA and show none,
	 * which keeps the main menu goldens stable across commits.
	 */
	protected onMount(): void {
		this.positionElements();

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
			this.rootLayer.width - BUILD_LABEL_WIDTH - BUILD_LABEL_MARGIN,
			this.rootLayer.height - BUILD_LABEL_HEIGHT - BUILD_LABEL_MARGIN,
		);
	}

	/**
	 * Position the menu elements from the root's size, which is the viewport's
	 */
	private positionElements(): void {
		const width = this.rootLayer.width;
		const height = this.rootLayer.height;
		const centerX = width / 2;

		this.background.setSize(width, height);

		// Title centred across the screen
		this.title.setPosition(0, height * 0.2);
		this.title.setWidth(width);

		const buttonWidth = 300;
		const buttonHeight = 60;
		const buttonSpacing = 20;
		const startY = height * 0.4;
		this.buttons.forEach((button, index) => {
			button.setPosition(
				centerX - buttonWidth / 2,
				startY + index * (buttonHeight + buttonSpacing),
			);
		});
	}

	protected onResized(): void {
		this.positionElements();
		this.positionBuildLabel();
	}
}
