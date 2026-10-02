import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { linear } from '../../../engine/animation/easing';
import { tokens } from '../../../engine/theme/tokens';

/** Milliseconds on the mount context's clock (R8.28). */
const FADE_IN_MS = 1000;
const HOLD_MS = 2000;
const LOGO_SIZE = 240;
/** Any of these leaves the splash before the hold is up. */
const SKIP_KEYS = ['Enter', 'Escape', ' '];

/**
 * Splash screen displayed when the game launches: a root stack centring the
 * logo over the title, faded in through the root's opacity (R3.25 multiplies
 * it down the tree), held, then handed to the main menu through the screen
 * transition. Enter, Escape, or Space skips the wait.
 */
export class SplashScreen extends Screen {
	private readonly stack: Stack;
	/** Clock time the fade-in finished, null before then. */
	private shownAt: number | null = null;
	private leaving = false;

	constructor() {
		const root = new Stack({
			id: 'splashScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			distribution: 'center',
			crossAlign: 'center',
			style: { backgroundColor: 'bg_void' },
		});
		super('splashScreen', { root });
		this.stack = root;
	}

	/**
	 * Faded in once mounted. The tween belongs to the root, so leaving early
	 * cancels it; the hold is timed in `onUpdate`, which a paused page never
	 * runs, so the screenshot harness settles the fade-in and captures the
	 * screen at full opacity.
	 */
	protected onMount(): void {
		this.shownAt = null;
		this.leaving = false;

		this.stack.addChild(new Rectangle({
			id: 'splash_logo',
			width: LOGO_SIZE,
			height: LOGO_SIZE,
			margin: { bottom: tokens.space.space_8 },
			style: {
				backgroundColor: 'accent_dim',
				borderColor: 'accent',
				borderWidth: 'bw_thick',
				borderRadius: 'r_xl',
			},
		}));
		this.stack.addChild(new Text('Dual Deckbuilder', {
			id: 'splash_title',
			style: {
				fontRole: 'display',
				fontSize: 'fs_4xl',
				color: 'text_bright',
				textAlign: 'center',
			},
			wrap: 'none',
		}));
		this.stack.addChild(new Text('A Roguelike Card Game', {
			id: 'splash_subtitle',
			style: {
				fontSize: 'fs_xl',
				color: 'text_dim',
				textAlign: 'center',
			},
			wrap: 'none',
		}));

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
			},
			onComplete: () => {
				this.shownAt = this.context.clock.now;
			},
		});
	}

	protected onUnmount(): void {
		for (const key of SKIP_KEYS) this.rootLayer.hotkeys.unregister(key);
		this.stack.clearChildren();
	}

	protected onUpdate(): void {
		if (this.shownAt === null || this.leaving) return;
		if (this.context.clock.now - this.shownAt < HOLD_MS) return;
		this.leave();
	}

	private leave(): void {
		if (this.leaving) return;
		this.leaving = true;
		ScreenManager.navigate('mainMenuScreen');
	}
}
