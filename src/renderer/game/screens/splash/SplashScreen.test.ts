/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import { key, send } from '../../../engine/services/testing';
import { ScreenManager } from '../../core/ScreenManager';
import type { SplashScene } from './SplashScene';
import { SplashScreen, splashBuildLine } from './SplashScreen';

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

	function scene(): SplashScene {
		const splash = screen.splash;
		if (!splash) throw new Error('the splash scene should be mounted');
		return splash;
	}

	/** The cover sheet's centre, without the page edges stepping out to its right. */
	function coverCentre(): number {
		const { book, bookScale } = scene();
		return book.x + (book.width - 10) * bookScale / 2;
	}

	it('centres the closed atlas and follows a resize with no screen code', () => {
		context.frame.layout();
		expect(screen.root.width).toBe(1280);
		expect(coverCentre()).toBeCloseTo(1280 / 2, 0);

		viewport.logical = { width: 800, height: 600 };
		context.frame.viewportChanged();
		context.frame.layout();
		expect(screen.root.width).toBe(800);
		expect(screen.root.height).toBe(600);
		expect(coverCentre()).toBeCloseTo(800 / 2, 0);
	});

	it('prints the cover lines and the ten-segment loader', () => {
		expect(scene().book.kickerText).toBe('A road atlas of the Halcyon region');
		expect(scene().book.editionText).toBe('fourth edition, revised after');
		expect(screen.root.findById('splash_loader_caption')).not.toBeNull();
		expect(scene().bar.segments).toBe(10);
		expect(scene().build.text).toBe('DEVELOPMENT BUILD');
	});

	it('at 1024 by 600 scales the book down and keeps the loader at full size, between the book and the build line', () => {
		viewport.logical = { width: 1024, height: 600 };
		context.frame.viewportChanged();
		context.frame.layout();
		const { book, loader, build, bar, bookScale } = scene();
		expect(bookScale).toBeCloseTo(600 / 900);
		expect(bar.width).toBe(420);
		expect(loader.y).toBeGreaterThanOrEqual(book.y + book.height * bookScale);
		expect(loader.y + loader.height).toBeLessThanOrEqual(build.y);
		expect(build.y + build.height).toBeLessThanOrEqual(600);
		expect(book.x).toBeGreaterThanOrEqual(0);
		expect(book.x + book.width * bookScale).toBeLessThanOrEqual(1024);
	});

	it('runs the loader on the fade and the hold, and fills it at the hand-off', () => {
		expect(scene().percentLabel).toBe('0%');
		advance(context, screen, 1000);
		expect(scene().percentLabel).toBe('33%');
		expect(scene().bar.filled).toBe(3);
		advance(context, screen, 1000);
		expect(scene().percentLabel).toBe('66%');
		advance(context, screen, 1000);
		expect(scene().percentLabel).toBe('100%');
		expect(scene().bar.filled).toBe(10);
	});

	it('shows the fade\'s share of the loader on a settled, paused page', () => {
		context.animator.settle();
		expect(scene().percentLabel).toBe('33%');
	});

	it('fades in and holds again after a remount mid-hold', () => {
		advance(context, screen, 1000);
		advance(context, screen, 1000);
		screen.unmount();

		screen.mount(context);
		expect(screen.root.opacity).toBe(0);
		expect(screen.root.findById('splash_book')).not.toBeNull();
		expect(screen.splash?.percentLabel).toBe('0%');
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

describe('splashBuildLine', () => {
	it('names the build number and commit a deploy defines', () => {
		expect(splashBuildLine({ sha: '2f8d7a7', number: '142' })).toBe('BUILD 142 - 2f8d7a7');
		expect(splashBuildLine({ sha: '2f8d7a7', number: null })).toBe('BUILD 2f8d7a7');
	});

	it('says development build where none is defined, so baselines hold across commits', () => {
		expect(splashBuildLine({ sha: null, number: null })).toBe('DEVELOPMENT BUILD');
	});
});
