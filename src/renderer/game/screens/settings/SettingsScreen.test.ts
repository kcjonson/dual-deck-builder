/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import { key, send } from '../../../engine/services/testing';
import type { SegmentedControl } from '../../../engine/ui/SegmentedControl';
import { ScreenManager } from '../../core/ScreenManager';
import { GameSettings, MotionSetting } from '../../core/GameSettings';
import { SettingsScreen } from './SettingsScreen';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

describe('SettingsScreen', () => {
	const viewport = { logical: { width: 1024, height: 600 } };
	let context: MountContext;
	let settings: GameSettings;
	let screen: SettingsScreen;

	function motionControl(): SegmentedControl<MotionSetting> {
		const control = screen.root.findById('settings_motion');
		if (!control) throw new Error('the motion control should be mounted');
		return control as SegmentedControl<MotionSetting>;
	}

	beforeEach(() => {
		navigate.mockClear();
		viewport.logical = { width: 1024, height: 600 };
		context = createTestContext({ viewport });
		settings = new GameSettings();
		screen = new SettingsScreen({ settings });
		screen.mount(context);
		context.frame.layout();
	});

	afterEach(() => {
		screen.unmount();
	});

	it('shows the stored motion setting and focuses it on mount', () => {
		screen.unmount();
		settings.motion = 'reduced';
		screen.mount(context);
		expect(motionControl().value).toBe('reduced');
		expect(context.focus.focused).toBe(motionControl().items[1]);
	});

	it('changes and keeps the setting from the arrows', () => {
		send(context, [key('ArrowRight')]);
		expect(settings.motion).toBe('reduced');
		send(context, [key('ArrowRight')]);
		expect(settings.motion).toBe('full');
		expect(motionControl().value).toBe('full');
	});

	it('walks to Back and back with Down and Up, returning to the selected option (R9.24, R9.26)', () => {
		screen.unmount();
		settings.motion = 'full';
		screen.mount(context);
		context.frame.layout();
		send(context, [key('ArrowDown')]);
		expect(context.focus.focused?.id).toBe('settings_back_button');
		send(context, [key('ArrowUp')]);
		expect(context.focus.focused).toBe(motionControl().items[2]);
		send(context, [key('ArrowRight')]);
		expect(settings.motion).toBe('system');
	});

	it('tabs from the setting to Back, which returns to the menu', () => {
		send(context, [key('Tab')]);
		expect(context.focus.focused?.id).toBe('settings_back_button');
		send(context, [key('Enter')]);
		expect(navigate).toHaveBeenCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
	});

	it('owns its Escape, which returns to the menu', () => {
		expect(screen.root.ownHotkeys?.has('Escape')).toBe(true);
		send(context, [key('Escape')]);
		expect(navigate).toHaveBeenCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
		screen.unmount();
		expect(screen.root.ownHotkeys?.has('Escape')).toBe(false);
		screen.mount(context);
	});

	it('centres the panel and keeps everything inside a 1024 by 600 viewport', () => {
		const panel = screen.root.findById('settings_motion_panel');
		const back = screen.root.findById('settings_back_button');
		if (!panel || !back) throw new Error('the panel and Back should be mounted');
		expect(panel.getX()).toBe((1024 - panel.getWidth()) / 2);
		expect(back.getY() + back.getHeight()).toBeLessThanOrEqual(600);
	});

	it('builds nothing twice across a remount', () => {
		screen.unmount();
		screen.mount(context);
		expect(screen.root.getChildren().filter((child) => child.id === 'settings_motion_panel')).toHaveLength(1);
	});
});
