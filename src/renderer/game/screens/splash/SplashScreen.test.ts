/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import { key, send } from '../../../engine/services/testing';
import { ScreenManager } from '../../core/ScreenManager';
import { SplashScreen } from './SplashScreen';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

/** One frame the way the game runs it: the frame's update phase, then the screen's. */
function advance(context: MountContext, screen: SplashScreen, milliseconds: number): void {
	context.frame.update(milliseconds / 1000);
	screen.update(milliseconds / 1000);
}

describe('SplashScreen', () => {
	const viewport = { logical: { width: 1280, height: 720 } };
	let context: MountContext;
	let screen: SplashScreen;

	beforeEach(() => {
		navigate.mockClear();
		viewport.logical = { width: 1280, height: 720 };
		context = createTestContext({ viewport });
		screen = new SplashScreen();
		screen.mount(context);
	});

	it('mounts transparent and fades in through the root', () => {
		expect(screen.root.opacity).toBe(0);
		advance(context, screen, 500);
		expect(screen.root.opacity).toBeCloseTo(0.5);
		advance(context, screen, 500);
		expect(screen.root.opacity).toBe(1);
	});

	it('holds, then hands over to the main menu through the screen transition', () => {
		advance(context, screen, 1000);
		advance(context, screen, 1999);
		expect(navigate).not.toHaveBeenCalled();

		advance(context, screen, 1);
		expect(navigate).toHaveBeenCalledTimes(1);
		expect(navigate).toHaveBeenCalledWith('mainMenuScreen');
		// The fade out is the transition's, not the splash's own
		expect(screen.root.opacity).toBe(1);

		advance(context, screen, 1000);
		expect(navigate).toHaveBeenCalledTimes(1);
	});

	it('settles to full opacity on a paused page, which is what the screenshot harness captures', () => {
		context.animator.settle();
		expect(screen.root.opacity).toBe(1);
		expect(navigate).not.toHaveBeenCalled();
	});

	it.each(['Enter', 'Escape', ' '])('skips the wait on %p, once', (name) => {
		send(context, [key(name), key(name)]);
		expect(navigate).toHaveBeenCalledTimes(1);
		expect(navigate).toHaveBeenCalledWith('mainMenuScreen');
	});

	it('centres its content in the viewport and follows a resize with no screen code', () => {
		context.frame.layout();
		const logo = screen.root.findById('splash_logo');
		const title = screen.root.findById('splash_title');
		if (!logo || !title) throw new Error('the logo and title should be mounted');
		expect(screen.root.getWidth()).toBe(1280);
		expect(logo.getX()).toBe((1280 - logo.getWidth()) / 2);

		viewport.logical = { width: 800, height: 600 };
		context.frame.viewportChanged();
		context.frame.layout();
		expect(screen.root.getWidth()).toBe(800);
		expect(screen.root.getHeight()).toBe(600);
		expect(logo.getX()).toBe((800 - logo.getWidth()) / 2);
		expect(title.getX()).toBe((800 - title.getWidth()) / 2);
	});

	it('fades in and holds again after a remount mid-hold', () => {
		advance(context, screen, 1000);
		advance(context, screen, 1000);
		screen.unmount();

		screen.mount(context);
		expect(screen.root.opacity).toBe(0);
		expect(screen.root.findById('splash_title')).not.toBeNull();
		advance(context, screen, 1000);
		advance(context, screen, 1999);
		expect(screen.root.opacity).toBe(1);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('stops fading when it unmounts', () => {
		advance(context, screen, 200);
		screen.unmount();
		expect(context.animator.active).toBe(0);
	});
});
