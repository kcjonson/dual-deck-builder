import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { GameSettings, MotionSetting } from '../../core/GameSettings';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { SegmentedControl } from '../../../engine/ui/SegmentedControl';
import { tokens } from '../../../engine/theme/tokens';
import { AtlasButton } from '../../ui/atlas/AtlasButton';
import { AtlasSheet } from '../../ui/atlas/AtlasSheet';
import { LegendBox } from '../../ui/atlas/LegendBox';
import { PageTitle } from '../../ui/atlas/PageTitle';

const { space } = tokens;
const PANEL_WIDTH = 560;
const BACK_WIDTH = 240;

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
 * The settings, an appendix of the atlas (UI Art Direction, Screens): one
 * sheet with its title at the top, a legend box per group of settings, and
 * Back to contents as a back road; a change applies at once, so there's no
 * primary action and no highway. It offers only what the game has a working
 * effect for, which today is reduced motion (R11.13); the choice is marked
 * with the highlighter, as the atlas marks every selection. Focus starts on
 * the motion control, Escape and Back return to the main menu with focus on
 * Settings again, and the Escape is the root's own (R9.15), so an open
 * popup has the key first.
 */
export class SettingsScreen extends Screen {
	private readonly sheet: AtlasSheet;
	private readonly settings: GameSettings;

	constructor({ settings = GameSettings.shared }: SettingsScreenOptions = {}) {
		const root = new AtlasSheet({
			id: 'settingsScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'center',
			gap: space.space_6,
		});
		super('settingsScreen', { root, theme: 'atlas' });
		this.sheet = root;
		this.settings = settings;
	}

	protected onMount(): void {
		this.sheet.addChild(new PageTitle({ title: 'Settings', titleId: 'settings_title', alignSelf: 'stretch' }));

		const motion = new SegmentedControl<MotionSetting>({
			id: 'settings_motion',
			options: MOTION_OPTIONS,
			selected: this.settings.motion,
			tone: 'highlight',
			onChange: (value) => {
				this.settings.motion = value;
			},
		});
		this.sheet.addChild(this.createMotionPanel(motion));

		this.sheet.addChild(new AtlasButton({
			label: 'Back to contents',
			id: 'settings_back_button',
			width: BACK_WIDTH,
			onClick: () => this.back(),
		}));

		this.rootLayer.hotkeys.register('Escape', () => this.back());
		const selected = motion.items.find((segment) => segment.selected) ?? motion.items[0];
		if (selected) this.context.focus.focus(selected);
	}

	protected onUnmount(): void {
		this.rootLayer.hotkeys.unregister('Escape');
		this.sheet.clearChildren();
	}

	private createMotionPanel(motion: SegmentedControl<MotionSetting>): LegendBox {
		const panel = new LegendBox({
			id: 'settings_motion_panel',
			title: 'Motion',
			width: PANEL_WIDTH,
			crossAlign: 'stretch',
			gap: space.space_3,
		});
		const row = new Stack({
			id: 'settings_motion_row',
			direction: 'horizontal',
			crossAlign: 'center',
			gap: space.space_4,
		});
		row.addChild(new Text({
			text: 'Reduce motion',
			id: 'settings_motion_label',
			widthMode: 'fill',
			style: { fontSize: 'fs_md', color: 'text' },
			wrap: 'none',
		}));
		row.addChild(motion);
		panel.addChild(row);
		panel.addChild(new Text({
			text: 'System follows your device\'s reduced motion setting. Reduced finishes every animation at once: screen fades, card movement, and combat effects.',
			id: 'settings_motion_hint',
			style: { fontSize: 'fs_base', color: 'text_dim' },
		}));
		return panel;
	}

	/** To the menu, focus back on the button that opened this screen. */
	private back(): void {
		ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
	}
}
