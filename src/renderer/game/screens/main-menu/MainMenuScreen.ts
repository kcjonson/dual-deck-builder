import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { FocusGroup } from '../../../engine/ui/FocusGroup';
import { tokens } from '../../../engine/theme/tokens';
import { formatBuildLabel } from './buildLabel';

const MENU_WIDTH = 300;

interface ElectronWindow extends Window {
	electron?: {
		isElectron: boolean;
		[key: string]: unknown;
	};
}

/**
 * The main menu: a root stack that centres the title over one column of
 * buttons, so the frame lays it out at any viewport and nothing is placed by
 * hand. The column is a focus group, one Tab stop the arrows move through,
 * and focus starts on Start Game.
 */
export class MainMenuScreen extends Screen {
	private readonly stack: Stack;
	private startButton: Button | null = null;

	constructor() {
		const root = new Stack({
			id: 'mainMenuScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			distribution: 'center',
			crossAlign: 'center',
			gap: tokens.space.space_12,
			style: { backgroundColor: 'bg_base' },
		});
		super('mainMenuScreen', { root });
		this.stack = root;
	}

	protected onMount(): void {
		this.stack.addChild(new Text({
			text: 'Dual Deckbuilder',
			id: 'main_menu_title',
			style: {
				fontRole: 'display',
				fontSize: 'fs_5xl',
				color: 'text_bright',
				textAlign: 'center',
			},
			wrap: 'none',
		}));
		this.stack.addChild(this.createMenu());

		// The build stamp in the bottom-right corner, so a playtester can tell
		// which deploy they're on. Development builds define no SHA and show
		// none, which keeps the main menu goldens stable across commits.
		const label = formatBuildLabel({ sha: __BUILD_SHA__, number: __BUILD_NUMBER__ });
		if (label) {
			this.stack.addChild(new Text({
				text: label,
				id: 'main_menu_build_label',
				positioned: 'absolute',
				anchor: 'bottomRight',
				pivot: 'bottomRight',
				x: -tokens.space.space_2,
				y: -tokens.space.space_2,
				style: { fontRole: 'mono', fontSize: 'fs_sm', color: 'text_faint' },
				wrap: 'none',
			}));
		}

		if (this.startButton) this.context.focus.focus(this.startButton);
	}

	protected onUnmount(): void {
		this.stack.clearChildren();
		this.startButton = null;
	}

	private createMenu(): FocusGroup {
		const menu = new FocusGroup({
			id: 'main_menu_buttons',
			orientation: 'vertical',
			wrap: true,
			width: MENU_WIDTH,
			crossAlign: 'stretch',
			gap: tokens.space.space_4,
		});

		this.startButton = new Button({
			label: 'Start Game',
			id: 'main_menu_start_button',
			tone: 'accent',
			size: 'lg',
			block: true,
			onClick: () => ScreenManager.navigate('driverSelectionScreen'),
		});
		menu.addChild(this.startButton);
		menu.addChild(new Button({
			label: 'Settings',
			id: 'main_menu_settings_button',
			size: 'lg',
			block: true,
			onClick: () => ScreenManager.navigate('settingsScreen'),
		}));
		menu.addChild(new Button({
			label: 'Credits',
			id: 'main_menu_credits_button',
			size: 'lg',
			block: true,
			onClick: () => ScreenManager.navigate('creditsScreen'),
		}));
		menu.addChild(new Button({
			label: 'Card Showcase',
			id: 'main_menu_card_showcase_button',
			size: 'lg',
			block: true,
			onClick: () => ScreenManager.navigate('cardShowcaseScreen'),
		}));
		menu.addChild(new Button({
			label: 'Developer Tools',
			id: 'main_menu_developer_button',
			size: 'lg',
			block: true,
			onClick: () => ScreenManager.navigate('developerScreen'),
		}));

		// Only the desktop build can quit
		if ((window as ElectronWindow).electron?.isElectron === true) {
			menu.addChild(new Button({
				label: 'Exit Game',
				id: 'main_menu_exit_button',
				size: 'lg',
				block: true,
				// Would use the electron API to quit
				onClick: () => console.log('Exit requested in Electron mode'),
			}));
		}
		return menu;
	}
}
