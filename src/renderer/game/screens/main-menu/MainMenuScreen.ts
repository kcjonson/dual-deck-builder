import { Screen } from '../../core/Screen';
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
	private onStartGame: (() => void) | null = null;
	private onOpenSettings: (() => void) | null = null;
	private onOpenCredits: (() => void) | null = null;
	private onOpenDeveloper: (() => void) | null = null;
	private onOpenCardShowcase: (() => void) | null = null;
	private onExitGame: (() => void) | null = null;

	/**
	 * Create a new main menu screen
	 * @param renderer WebGL renderer
	 */
	constructor(renderer: Renderer) {
		super('mainMenuScreen', renderer);

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
			if (this.onStartGame) this.onStartGame();
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
			if (this.onOpenSettings) this.onOpenSettings();
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
			if (this.onOpenCredits) this.onOpenCredits();
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
			if (this.onOpenCardShowcase) this.onOpenCardShowcase();
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
			if (this.onOpenDeveloper) this.onOpenDeveloper();
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
			if (this.onExitGame) this.onExitGame();
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
	 * Set callback for when Start Game is clicked
	 */
	public setOnStartGame(callback: () => void): void {
		this.onStartGame = callback;
	}

	/**
	 * Set callback for when Settings is clicked
	 */
	public setOnOpenSettings(callback: () => void): void {
		this.onOpenSettings = callback;
	}

	/**
	 * Set callback for when Credits is clicked
	 */
	public setOnOpenCredits(callback: () => void): void {
		this.onOpenCredits = callback;
	}

	/**
	 * Set callback for when Card Showcase is clicked
	 */
	public setOnOpenCardShowcase(callback: () => void): void {
		this.onOpenCardShowcase = callback;
	}

	/**
	 * Set callback for when Developer Tools is clicked
	 */
	public setOnOpenDeveloper(callback: () => void): void {
		this.onOpenDeveloper = callback;
	}

	/**
	 * Set callback for when Exit Game is clicked
	 */
	public setOnExitGame(callback: () => void): void {
		this.onExitGame = callback;
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
