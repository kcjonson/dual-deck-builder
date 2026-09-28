import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { linear } from '../../../engine/animation/easing';

/** Milliseconds on the mount context's clock (R8.28). */
const FADE_IN_MS = 1000;
const HOLD_MS = 2000;
const FADE_OUT_MS = 1000;

/**
 * Splash screen displayed when the game launches: the whole screen fades in
 * through its root's opacity, holds, fades out, and hands over to the main
 * menu (R3.25's opacity multiplies down the tree, so one value fades it all).
 */
export class SplashScreen extends Screen {
	private background: Rectangle;
	private logo: Rectangle;
	private title: Text;
	private subtitle: Text;
	/** Clock time the fade-in finished, null before then. */
	private shownAt: number | null = null;
	private leaving = false;

	constructor() {
		super('splashScreen');

		this.background = new Rectangle({
			style: {
				backgroundColor: '#0d0d1a',
			},
		});
		this.rootLayer.addChild(this.background);

		this.logo = new Rectangle({
			id: 'splash_logo',
			width: 300,
			height: 300,
			style: {
				backgroundColor: '#3366cc',
				borderRadius: 20,
			},
		});
		this.rootLayer.addChild(this.logo);

		this.title = new Text('Dual Deckbuilder', {
			id: 'splash_title',
			style: {
				fontSize: 48,
				color: '#ffffff',
				textAlign: 'center',
				whiteSpace: 'nowrap',
			},
		});
		this.rootLayer.addChild(this.title);

		this.subtitle = new Text('A Roguelike Card Game', {
			id: 'splash_subtitle',
			style: {
				fontSize: 24,
				color: '#cccccc',
				textAlign: 'center',
				whiteSpace: 'nowrap',
			},
		});
		this.rootLayer.addChild(this.subtitle);
	}

	/**
	 * Placed once mounted, where the root has the viewport's size and the
	 * title has measured its line box (R1.6), then faded in. The tween
	 * belongs to the root, so leaving early cancels it; the hold is timed in
	 * `onUpdate`, which a paused page never runs, so the screenshot harness
	 * settles the fade-in and captures the screen at full opacity.
	 */
	protected onMount(): void {
		this.positionElements();
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

	private positionElements(): void {
		const width = this.rootLayer.width;
		const height = this.rootLayer.height;
		const centerX = width / 2;
		const centerY = height / 2;

		this.background.setSize(width, height);

		this.logo.setPosition(
			centerX - this.logo.getWidth() / 2,
			centerY - this.logo.getHeight() / 2 - 50,
		);

		// Title below the logo and the subtitle under its line box, both centred
		// across the screen
		this.title.setPosition(0, centerY + 100);
		this.title.setWidth(width);
		this.subtitle.setPosition(0, this.title.getY() + this.title.getHeight());
		this.subtitle.setWidth(width);
	}

	protected onResized(): void {
		this.positionElements();
	}

	protected onUpdate(): void {
		if (this.shownAt === null || this.leaving) return;
		if (this.context.clock.now - this.shownAt < HOLD_MS) return;

		this.leaving = true;
		this.context.animator.tween({
			from: 1,
			to: 0,
			duration: FADE_OUT_MS,
			ease: linear,
			owner: this.rootLayer,
			onUpdate: (opacity) => {
				this.rootLayer.opacity = opacity;
			},
			onComplete: () => ScreenManager.navigate('mainMenuScreen'),
		});
	}
}
