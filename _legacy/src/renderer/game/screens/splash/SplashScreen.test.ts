/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import type { RectCommand } from '../../../engine/draw';
import type { RGBA } from '../../../engine/draw/geometry';
import { key, send } from '../../../engine/services/testing';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { themes } from '../../../engine/theme/tokens';
import { ScreenManager } from '../../core/ScreenManager';
import type { SplashScene } from './SplashScene';
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

describe('the splash table', () => {
	function luminance([r, g, b]: RGBA): number {
		const linear = (channel: number): number => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
		return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
	}

	function over(top: RGBA, bottom: RGBA): RGBA {
		const alpha = top[3];
		return [0, 1, 2].map((channel) => top[channel] * alpha + bottom[channel] * (1 - alpha)).concat(1) as unknown as RGBA;
	}

	it('draws its grain as a few cached bands, the same option objects every frame', () => {
		const { api, backend } = createMeasuringDrawApi();
		const context = createTestContext({ viewport: { logical: { width: 1440, height: 882 } }, draw: api });
		const screen = new SplashScreen();
		screen.mount(context);
		context.frame.layout();
		const scene = screen.splash;
		if (!scene) throw new Error('no scene');
		const seen: unknown[][] = [];
		const drawRect = api.drawRect.bind(api);
		api.drawRect = (options) => {
			seen[seen.length - 1].push(options);
			drawRect(options);
		};
		for (let frame = 0; frame < 2; frame++) {
			seen.push([]);
			api.beginFrame({ viewport: { width: 1440, height: 882 } });
			scene.render(api);
			api.endFrame();
		}
		expect(seen[0].length).toBeLessThanOrEqual(48);
		seen[0].forEach((options, index) => expect(seen[1][index]).toBe(options));
		expect(backend.commands.length).toBe(seen[1].length);
	});

	it('keeps the build line at 4.5:1 or better on the grain under it', () => {
		const { api, backend } = createMeasuringDrawApi();
		for (const size of [{ width: 1440, height: 882 }, { width: 1024, height: 600 }]) {
			const context = createTestContext({ viewport: { logical: size }, draw: api });
			const screen = new SplashScreen();
			screen.mount(context);
			context.frame.layout();
			const scene = screen.splash;
			if (!scene) throw new Error('no scene');
			api.beginFrame({ viewport: size });
			scene.render(api);
			api.endFrame();
			const { build } = scene;
			const line = { top: build.y, bottom: build.y + build.height };
			const rects = backend.commands.filter((command): command is RectCommand => command.kind === 'rect');
			const [table, ...grain] = rects;
			const under = grain.filter((command) => command.rect.y < line.bottom && command.rect.y + command.rect.height > line.top);
			const lightest = under.filter((command) => command.fill && luminance(command.fill) > luminance(table.fill as RGBA));
			const darkest = under.filter((command) => !lightest.includes(command));
			// The worst case is every lifting band under the line and none of the darkening ones but the ground.
			let ground = table.fill as RGBA;
			for (const command of lightest) ground = over(command.fill as RGBA, ground);
			const groundBand = darkest[darkest.length - 1];
			ground = over(groundBand.fill as RGBA, ground);
			const text = luminance(themes.atlas.color.text_disabled);
			const ratio = (text + 0.05) / (luminance(ground) + 0.05);
			expect(ratio).toBeGreaterThanOrEqual(4.5);
			screen.unmount();
		}
	});
});
