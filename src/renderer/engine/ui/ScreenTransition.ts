import type { TweenHandle } from '../animation/Animator';
import { Component, ResolvedColors } from '../components/Component';
import type { MountContext } from '../components/MountContext';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import type { OverlayHandle } from '../services/OverlayService';
import { tokens } from '../theme/tokens';

interface Waiter {
	resolve: () => void;
	reject: (error: unknown) => void;
}

/** A redirect that redirects again this many times inside one transition is a loop. */
const MAX_CHAINED_SWAPS = 8;

/** Idle, covering the outgoing scene, swapping, or uncovering the incoming one. */
export type TransitionPhase = 'idle' | 'out' | 'in';

export interface ScreenTransitionOptions {
	id?: string;
	/** The colour the scenes fade through. Default `bg_void`. */
	color?: RGBA;
	/** Milliseconds each way. Default `dur`. */
	duration?: number;
}

/**
 * R12.38's screen transition: an overlay root in the `transition` layer, a
 * full-viewport quad whose alpha is tweened, and R8.22's sequence for the
 * scene manager: fade out, `swap` (unmount the outgoing roots, mount the
 * incoming ones), one layout, fade in.
 *
 * Input is blocked for the whole run: the quad takes every press from its
 * first frame (its fade is its colour, so it is hit at alpha 0), and the
 * root is modal, so no hotkey beneath it fires. The root is `persistent`, so
 * the `closeAll` a scene change runs inside `swap` leaves it open.
 *
 * `run` while a run is going: the newest `swap` replaces a pending one; a
 * run already fading in heads back out from where it is; a run from inside
 * a swap (a screen that redirects from its mount) runs right after it, still
 * covered. Every `run`'s promise settles when the transition is next idle.
 * A swap that throws ends the transition at once, uncovered and released,
 * and every waiting `run` rejects with the error, which is also logged.
 * Reduced motion and the harness's settle run the whole sequence at once,
 * the swap included.
 *
 * The root pushes a focus scope with nothing focusable in it, so no key
 * reaches the scene while it runs; focus the incoming scene asks for is
 * kept by the focus manager and given to it when the scope pops (R9.20).
 */
export class ScreenTransition extends Component {
	private readonly fadeColor: RGBA;
	private readonly duration: number;
	private phaseValue: TransitionPhase = 'idle';
	private coverage = 0;
	private handle: OverlayHandle | null = null;
	private tween: TweenHandle<number> | null = null;
	private pendingSwap: (() => void) | null = null;
	private waiting: Waiter[] = [];
	/** A swap is running: a `run` from inside it is queued behind it, still covered. */
	private swapping = false;
	/** What the last swap threw, handed to every waiting `run` when the transition closes. */
	private failure: { error: unknown } | null = null;

	constructor({ id = 'screen_transition', color = tokens.color.bg_void, duration = tokens.motion.dur }: ScreenTransitionOptions = {}) {
		super({ id, pointerEvents: 'auto' });
		this.componentType = 'ScreenTransition';
		this.fadeColor = color;
		this.duration = duration;
	}

	public get phase(): TransitionPhase {
		return this.phaseValue;
	}

	public get active(): boolean {
		return this.phaseValue !== 'idle';
	}

	/** How much of the scene the quad hides: 0 clear, 1 covered. */
	public get progress(): number {
		return this.coverage;
	}

	public get overlay(): OverlayHandle | null {
		return this.handle;
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: this.quadColor };
	}

	/** Fades out, runs `swap`, lays out once, and fades in. */
	public run(context: MountContext, swap: () => void): Promise<void> {
		const settled = new Promise<void>((resolve, reject) => this.waiting.push({ resolve, reject }));
		// A caller that does not wait still has the failure logged; one that
		// does sees the rejection.
		settled.catch(() => undefined);
		this.pendingSwap = swap;
		if (this.phaseValue === 'out' || this.swapping) return settled;
		if (!this.handle) {
			this.handle = context.overlays.open(this, {
				id: `${this.id ?? 'screen_transition'}_root`,
				layer: 'transition',
				modal: true,
				fill: true,
				persistent: true,
				onClose: () => this.closed(),
			});
		}
		this.phaseValue = 'out';
		this.fadeTo(context, 1, () => this.swap(context));
		return settled;
	}

	public render(draw: DrawApi): void {
		if (this.coverage <= 0 || this.width <= 0 || this.height <= 0) return;
		draw.drawRect({ id: this.id ?? undefined, rect: { x: 0, y: 0, width: this.width, height: this.height }, fill: this.quadColor });
	}

	private get quadColor(): RGBA {
		const fade = this.fadeColor;
		return [fade[0], fade[1], fade[2], fade[3] * this.coverage];
	}

	/**
	 * Runs the pending swap, and any a swap queued from inside itself, then
	 * lays the incoming scene out and fades in. A throw anywhere in there
	 * ends the transition uncovered rather than leaving the game behind a
	 * modal quad.
	 */
	private swap(context: MountContext): void {
		this.swapping = true;
		try {
			for (let chained = 0; this.pendingSwap; chained += 1) {
				if (chained === MAX_CHAINED_SWAPS) {
					throw new Error(`ScreenTransition: ${MAX_CHAINED_SWAPS} swaps queued each other inside one transition; a scene keeps redirecting`);
				}
				const swap = this.pendingSwap;
				this.pendingSwap = null;
				swap();
			}
			// R8.22: the incoming scene is laid out before it is uncovered.
			context.frame.layout();
		} catch (error) {
			this.failure = { error };
			console.error('ScreenTransition: the swap threw; the transition ends uncovered', error);
		} finally {
			this.swapping = false;
		}
		if (!this.handle) {
			// Closed from inside the swap: already idle, every run settled.
			this.failure = null;
			return;
		}
		if (this.failure) {
			this.handle.close();
			return;
		}
		this.phaseValue = 'in';
		this.fadeTo(context, 0, () => this.handle?.close());
	}

	private fadeTo(context: MountContext, target: number, done: () => void): void {
		this.tween?.cancel();
		this.tween = context.animator.tween({
			from: this.coverage,
			to: target,
			duration: this.duration,
			ease: tokens.motion.ease_standard,
			owner: this,
			onUpdate: (value) => {
				this.coverage = value;
			},
			onComplete: () => {
				this.tween = null;
				done();
			},
		});
	}

	/** Closed at the end of the fade in, or from outside: idle, and every run settles. */
	private closed(): void {
		this.tween?.cancel();
		this.tween = null;
		this.handle = null;
		this.phaseValue = 'idle';
		this.coverage = 0;
		this.pendingSwap = null;
		const failure = this.failure;
		this.failure = null;
		const waiting = this.waiting;
		this.waiting = [];
		for (const waiter of waiting) {
			if (failure) waiter.reject(failure.error);
			else waiter.resolve();
		}
	}
}
