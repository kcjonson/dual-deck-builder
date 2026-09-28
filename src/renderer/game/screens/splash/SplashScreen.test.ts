/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
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

describe('SplashScreen fade (DDB-41)', () => {
	let context: MountContext;
	let screen: SplashScreen;

	beforeEach(() => {
		navigate.mockClear();
		context = createTestContext({ viewport: { logical: { width: 1280, height: 720 } } });
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

	it('holds, fades out, then goes to the main menu', () => {
		advance(context, screen, 1000);
		advance(context, screen, 1999);
		expect(screen.root.opacity).toBe(1);
		expect(navigate).not.toHaveBeenCalled();

		// The hold ends; the fade-out starts on this frame and runs on the next
		advance(context, screen, 1);
		advance(context, screen, 500);
		expect(screen.root.opacity).toBeCloseTo(0.5);
		expect(navigate).not.toHaveBeenCalled();

		advance(context, screen, 500);
		expect(screen.root.opacity).toBe(0);
		expect(navigate).toHaveBeenCalledWith('mainMenuScreen');
	});

	it('settles to full opacity on a paused page, which is what the screenshot harness captures', () => {
		context.animator.settle();
		expect(screen.root.opacity).toBe(1);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('places its content from the viewport and follows a resize', () => {
		const title = screen.root.findById('splash_title');
		expect(title?.getWidth()).toBe(1280);

		screen.resize(800, 600);
		expect(title?.getWidth()).toBe(800);
		expect(screen.root.findById('splash_logo')?.getX()).toBe(400 - 150);
	});

	it('fades in and holds again after a remount mid-fade-out', () => {
		advance(context, screen, 1000);
		advance(context, screen, 2000);
		advance(context, screen, 200);
		screen.unmount();

		screen.mount(context);
		expect(screen.root.opacity).toBe(0);
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
