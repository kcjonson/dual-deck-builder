/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import { key, send } from '../../../engine/services/testing';
import { ScreenManager } from '../../core/ScreenManager';
import { MainMenuScreen } from './MainMenuScreen';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

describe('MainMenuScreen', () => {
	const viewport = { logical: { width: 1280, height: 720 } };
	let context: MountContext;
	let screen: MainMenuScreen;

	beforeEach(() => {
		navigate.mockClear();
		viewport.logical = { width: 1280, height: 720 };
		context = createTestContext({ viewport });
		screen = new MainMenuScreen();
		screen.mount(context);
		context.frame.layout();
	});

	afterEach(() => {
		screen.unmount();
	});

	it('focuses Start Game on mount, and Enter starts a run', () => {
		expect(context.focus.focused?.id).toBe('main_menu_start_button');
		send(context, [key('Enter')]);
		expect(navigate).toHaveBeenCalledWith('driverSelectionScreen');
	});

	it('moves through the buttons with the arrows, wrapping', () => {
		send(context, [key('ArrowDown')]);
		expect(context.focus.focused?.id).toBe('main_menu_settings_button');
		send(context, [key('ArrowUp'), key('ArrowUp')]);
		expect(context.focus.focused?.id).toBe('main_menu_developer_button');
		send(context, [key('Enter')]);
		expect(navigate).toHaveBeenCalledWith('developerScreen');
	});

	it('centres the column in the viewport and follows a resize with no screen code', () => {
		const menu = screen.root.findById('main_menu_buttons');
		if (!menu) throw new Error('the menu should be mounted');
		expect(screen.root.getWidth()).toBe(1280);
		expect(menu.getX()).toBe((1280 - menu.getWidth()) / 2);

		viewport.logical = { width: 1024, height: 600 };
		context.frame.viewportChanged();
		context.frame.layout();
		expect(screen.root.getHeight()).toBe(600);
		expect(menu.getX()).toBe((1024 - menu.getWidth()) / 2);
		expect(menu.getY()).toBeGreaterThanOrEqual(0);
		expect(menu.getY() + menu.getHeight()).toBeLessThanOrEqual(600);
	});

	it('builds nothing twice across a remount', () => {
		screen.unmount();
		screen.mount(context);
		expect(screen.root.getChildren().filter((child) => child.id === 'main_menu_buttons')).toHaveLength(1);
		expect(context.focus.focused?.id).toBe('main_menu_start_button');
	});
});
