import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Stack } from '../../../engine/components/Stack';
import { linear } from '../../../engine/animation/easing';
import { formatBuildLabel } from '../main-menu/buildLabel';
import { SplashScene } from './SplashScene';

/** Milliseconds on the mount context's clock (R8.28). */
const FADE_IN_MS = 1000;
const HOLD_MS = 2000;
/** Any of these leaves the splash before the hold is up. */
const SKIP_KEYS = ['Enter', 'Escape', ' '];

/**
 * The splash's build line: the build number and commit a deploy defines, or
 * "development build" where it defines neither, which keeps the screenshot
 * baselines stable across commits.
 */
export function splashBuildLine({ sha, number }: { sha: string | null; number: string | null }): string {
	const label = formatBuildLabel({ sha, number });
	if (!label) return 'DEVELOPMENT BUILD';
	return label.startsWith('build ') ? `BUILD ${label.slice('build '.length)}` : `BUILD ${label}`;
}

/**
 * Splash screen displayed when the game launches: the closed atlas on the
 * table (UI Art Direction, Launch splash), on the atlas theme, faded in
 * through the root's opacity (R3.25 multiplies it down the tree), held, then
 * handed to the main menu through the screen transition. Everything loads
 * before the splash mounts, so the scale-bar loader runs on the fade and the
 * hold. Enter, Escape, or Space skips the wait.
 */
export class SplashScreen extends Screen {
	private readonly stack: Stack;
	private scene: SplashScene | null = null;
	/** Clock time the fade-in finished, null before then. */
	private shownAt: number | null = null;
	private leaving = false;

	constructor() {
		const root = new Stack({
			id: 'splashScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			style: { backgroundColor: 'bg_void' },
		});
		super('splashScreen', { root, theme: 'atlas' });
		this.stack = root;
	}

	/** The table, the book, the decks, and the loader; null while unmounted. */
	public get splash(): SplashScene | null {
		return this.scene;
	}

	/**
	 * Faded in once mounted. The tween belongs to the root, so leaving early
	 * cancels it; the hold is timed in `onUpdate`, which a paused page never
	 * runs, so the screenshot harness settles the fade-in and captures the
	 * screen at full opacity with the loader at the fade's share.
	 */
	protected onMount(): void {
		this.shownAt = null;
		this.leaving = false;

		const scene = new SplashScene({ id: 'splash_scene', buildLine: splashBuildLine({ sha: __BUILD_SHA__, number: __BUILD_NUMBER__ }) });
		this.scene = scene;
		this.stack.addChild(scene);

		for (const key of SKIP_KEYS) this.rootLayer.hotkeys.register(key, () => this.leave());

		this.rootLayer.opacity = 0;
		this.context.animator.tween({
			from: 0,
			to: 1,
			duration: FADE_IN_MS,
			ease: linear,
			owner: this.rootLayer,
			onUpdate: (opacity) => {
				this.rootLayer.opacity = opacity;
				scene.progress = (opacity * FADE_IN_MS) / (FADE_IN_MS + HOLD_MS);
			},
			onComplete: () => {
				this.shownAt = this.context.clock.now;
				scene.progress = FADE_IN_MS / (FADE_IN_MS + HOLD_MS);
			},
		});
	}

	protected onUnmount(): void {
		for (const key of SKIP_KEYS) this.rootLayer.hotkeys.unregister(key);
		this.stack.clearChildren();
		this.scene = null;
	}

	protected onUpdate(): void {
		if (this.shownAt === null || this.leaving) return;
		const held = this.context.clock.now - this.shownAt;
		if (this.scene) this.scene.progress = (FADE_IN_MS + Math.min(held, HOLD_MS)) / (FADE_IN_MS + HOLD_MS);
		if (held < HOLD_MS) return;
		this.leave();
	}

	private leave(): void {
		if (this.leaving) return;
		this.leaving = true;
		if (this.scene) this.scene.progress = 1;
		ScreenManager.navigate('mainMenuScreen');
	}
}
