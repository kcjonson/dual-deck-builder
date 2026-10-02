import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { Panel } from '../../../engine/ui/Panel';
import { tokens } from '../../../engine/theme/tokens';

/**
 * What the battle result screen shows: the outcome. Plain data, so the dev
 * navigate hook can pass exactly what the combat screen does. Statistics
 * (salvage, levels, turns) join it when the screen shows them.
 */
export interface BattleResultData {
	victory: boolean;
}

const PANEL_WIDTH = 600;

function isBattleResultData(data: unknown): data is BattleResultData {
	return typeof data === 'object' && data !== null && 'victory' in data;
}

/**
 * Screen displayed after battle ends: a root stack centring one panel with
 * the outcome and a Continue button, which has focus on mount. Enter
 * continues, and so does Escape, since there is nowhere else to go.
 */
export class BattleResultScreen extends Screen {
	private readonly stack: Stack;

	constructor() {
		const root = new Stack({
			id: 'battleResultScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			distribution: 'center',
			crossAlign: 'center',
			style: { backgroundColor: 'bg_base' },
		});
		super('battleResultScreen', { root });
		this.stack = root;
	}

	protected onMount(data?: unknown): void {
		if (!isBattleResultData(data)) {
			console.error('BattleResultScreen: Invalid or missing data');
			return;
		}
		const { victory } = data;

		const panel = new Panel({
			id: 'result_panel',
			variant: 'raised',
			accent: victory ? 'accent' : 'none',
			corners: true,
			width: PANEL_WIDTH,
			crossAlign: 'center',
			gap: tokens.space.space_4,
			style: { padding: 'space_12' },
		});
		panel.addChild(new Text({
			text: victory ? 'VICTORY!' : 'DEFEAT!',
			id: 'result_title',
			style: {
				fontRole: 'display',
				fontSize: 'fs_4xl',
				color: victory ? 'status_ok' : 'status_crit',
				textAlign: 'center',
			},
			wrap: 'none',
		}));
		panel.addChild(new Text({
			text: victory ? 'All enemies have been defeated!' : 'Your vehicles have been destroyed!',
			id: 'result_subtitle',
			style: {
				fontSize: 'fs_lg',
				color: 'text_dim',
				textAlign: 'center',
			},
			wrap: 'none',
		}));

		const continueButton = new Button({
			label: 'Continue',
			id: 'result_continue_button',
			tone: 'accent',
			size: 'lg',
			width: 200,
			margin: { top: tokens.space.space_8 },
			// TODO: Navigate to reward screen or map for victory, or retry options for defeat
			onClick: () => this.continue(),
		});
		panel.addChild(continueButton);
		this.stack.addChild(panel);

		this.rootLayer.hotkeys.register('Escape', () => this.continue());
		this.context.focus.focus(continueButton);
	}

	protected onUnmount(): void {
		this.rootLayer.hotkeys.unregister('Escape');
		this.stack.clearChildren();
	}

	private continue(): void {
		ScreenManager.navigate('mainMenuScreen');
	}
}
