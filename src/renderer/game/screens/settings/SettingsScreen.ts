import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { GameSettings, MotionSetting } from '../../core/GameSettings';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { Panel } from '../../../engine/ui/Panel';
import { SegmentedControl } from '../../../engine/ui/SegmentedControl';
import { tokens } from '../../../engine/theme/tokens';

const PANEL_WIDTH = 560;
const BACK_WIDTH = 200;

const MOTION_OPTIONS: readonly { label: string; value: MotionSetting }[] = [
	{ label: 'System', value: 'system' },
	{ label: 'Reduced', value: 'reduced' },
	{ label: 'Full', value: 'full' },
];

export interface SettingsScreenOptions {
	/** The settings it edits. Default: the game's shared, persisted ones. */
	settings?: GameSettings;
}

/**
 * The settings screen: a root stack centring a title, one panel per group of
 * settings, and Back. It offers only what the game has a working effect for,
 * which today is reduced motion (R11.13); a change applies and persists at
 * once. Focus starts on the motion control, Escape and Back return to the
 * main menu with focus on Settings again, and the Escape is the root's own
 * (R9.15), so an open popup has the key first.
 */
export class SettingsScreen extends Screen {
	private readonly stack: Stack;
	private readonly settings: GameSettings;

	constructor({ settings = GameSettings.shared }: SettingsScreenOptions = {}) {
		const root = new Stack({
			id: 'settingsScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			distribution: 'center',
			crossAlign: 'center',
			gap: tokens.space.space_8,
			style: { backgroundColor: 'bg_base' },
		});
		super('settingsScreen', { root });
		this.stack = root;
		this.settings = settings;
	}

	protected onMount(): void {
		this.stack.addChild(new Text('Settings', {
			id: 'settings_title',
			style: {
				fontRole: 'display',
				fontSize: 'fs_4xl',
				color: 'text_bright',
				textAlign: 'center',
			},
			wrap: 'none',
		}));

		const motion = new SegmentedControl<MotionSetting>({
			id: 'settings_motion',
			options: MOTION_OPTIONS,
			selected: this.settings.motion,
			onChange: (value) => {
				this.settings.motion = value;
			},
		});
		this.stack.addChild(this.createMotionPanel(motion));

		this.stack.addChild(new Button('Back', {
			id: 'settings_back_button',
			icon: 'arrow_back',
			size: 'lg',
			width: BACK_WIDTH,
			onClick: () => this.back(),
		}));

		this.rootLayer.hotkeys.register('Escape', () => this.back());
		const selected = motion.items.find((segment) => segment.selected) ?? motion.items[0];
		if (selected) this.context.focus.focus(selected);
	}

	protected onUnmount(): void {
		this.rootLayer.hotkeys.unregister('Escape');
		this.stack.clearChildren();
	}

	private createMotionPanel(motion: SegmentedControl<MotionSetting>): Panel {
		const panel = new Panel({
			id: 'settings_motion_panel',
			title: 'Motion',
			corners: true,
			width: PANEL_WIDTH,
			crossAlign: 'stretch',
			gap: tokens.space.space_3,
		});
		const row = new Stack({
			id: 'settings_motion_row',
			direction: 'horizontal',
			crossAlign: 'center',
			gap: tokens.space.space_4,
		});
		row.addChild(new Text('Reduce motion', {
			id: 'settings_motion_label',
			widthMode: 'fill',
			style: { fontSize: 'fs_md', color: 'text_bright' },
			wrap: 'none',
		}));
		row.addChild(motion);
		panel.addChild(row);
		panel.addChild(new Text(
			'System follows your device\'s reduced motion setting. Reduced finishes every animation at once: screen fades, card movement, and combat effects.',
			{
				id: 'settings_motion_hint',
				style: { fontSize: 'fs_base', color: 'text_dim' },
			},
		));
		return panel;
	}

	/** To the menu, focus back on the button that opened this screen. */
	private back(): void {
		ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
	}
}
