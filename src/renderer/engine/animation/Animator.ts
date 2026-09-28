import { tokens } from '../theme/tokens';
import type { Clock } from './Clock';
import { Ease, EaseFunction, resolveEase } from './easing';

/** A number, or a fixed-length list of them interpolated per element (a colour, a translate). */
export type TweenValue = number | readonly number[];

/** What a tween belongs to: a component, cancelled with its tweens when it unmounts (R8.15). */
export interface TweenOwner {
	readonly isMounted: boolean;
}

export interface TweenOptions<T extends TweenValue> {
	from: T;
	to: T;
	/** Milliseconds; defaults to `motion.dur`. */
	duration?: number;
	/** Defaults to `motion.ease_standard`. */
	ease?: Ease;
	/** Every tick, and once with `from` when the tween starts. */
	onUpdate: (value: T) => void;
	/** After the last `onUpdate`, only when the tween runs to its end. */
	onComplete?: () => void;
	owner?: TweenOwner | null;
}

export interface RetargetOptions {
	/** Milliseconds; defaults to the duration the tween was created with. */
	duration?: number;
	ease?: Ease;
}

export interface TweenHandle<T extends TweenValue> {
	/** The value last passed to `onUpdate`. */
	readonly value: T;
	readonly running: boolean;
	/**
	 * Settles when the current run ends, completed or cancelled, never
	 * rejecting: a `reconcileChildren` exit can return it and a cancelled exit
	 * still detaches (R8.27).
	 */
	readonly done: Promise<void>;
	/** Stops where it is. No further `onUpdate`, no `onComplete`. */
	cancel(): void;
	/**
	 * Heads for `to` from the current value (R8.28). Reversing towards where
	 * the run came from takes only as long as the way back (CSS's reversing
	 * shortening factor), so a quick hover in and out never snaps. Restarts a
	 * finished tween, unless its owner has unmounted.
	 */
	retarget(to: T, options?: RetargetOptions): void;
}

export interface AnimatorOptions {
	clock: Clock;
	reducedMotion?: boolean;
}

/** Rounds of `settle` before a chain of tweens that keeps starting new ones is an error. */
const MAX_SETTLE_ROUNDS = 64;

const resolved = Promise.resolve();

/**
 * R8.28's animator: interpolation over the frame clock. Tweens tick in the
 * update phase (`UiFrame.update` calls `tick` after advancing the clock and
 * before component updates), in creation order, and a tween's owner
 * unmounting cancels it. Under reduced motion every tween completes on its
 * first tick (R11.13's collapse of every duration to zero).
 */
export class Animator {
	private readonly clock: Clock;
	private readonly tweens: Tween<TweenValue>[] = [];
	private reduced: boolean;

	constructor({ clock, reducedMotion = false }: AnimatorOptions) {
		this.clock = clock;
		this.reduced = reducedMotion;
	}

	/** The platform shell sets this from the system preference. */
	public get reducedMotion(): boolean {
		return this.reduced;
	}

	public set reducedMotion(value: boolean) {
		this.reduced = value;
	}

	/** Tweens still running. The list also holds ones cancelled since the last tick. */
	public get active(): number {
		let running = 0;
		for (const tween of this.tweens) {
			if (tween.running) running += 1;
		}
		return running;
	}

	public get now(): number {
		return this.clock.now;
	}

	/** Numbers are overloaded apart so `from: 0` gives a `number` tween rather than a `0` one. */
	public tween(options: TweenOptions<number>): TweenHandle<number>;
	public tween<T extends readonly number[]>(options: TweenOptions<T>): TweenHandle<T>;
	public tween<T extends TweenValue>(options: TweenOptions<T>): TweenHandle<T> {
		const tween = new Tween<T>(this, options);
		if (options.owner && !options.owner.isMounted) {
			// Nothing would ever cancel it. The value stays at `from`, unapplied.
			return tween;
		}
		tween.start(options.from, checkedDuration(options.duration), options.ease);
		return tween;
	}

	/**
	 * Advances every running tween to the clock's `now`, in creation order.
	 * Tweens started during the tick wait for the next one.
	 */
	public tick(): void {
		const count = this.tweens.length;
		for (let i = 0; i < count; i++) {
			const tween = this.tweens[i];
			if (tween.running) tween.advance(this.clock.now, this.reduced);
		}
		this.compact();
	}

	/** Cancels every tween `owner` holds. The base component calls it on unmount. */
	public cancelOwnedBy(owner: TweenOwner): void {
		if (this.tweens.length === 0) return;
		for (const tween of this.tweens) {
			if (tween.owner === owner) tween.cancel();
		}
	}

	/**
	 * Runs every tween to its end now, including the ones their completions
	 * start, and returns how many it finished. The screenshot harness calls it
	 * on a paused page so a capture shows where the animations land rather
	 * than the frame they started on (R13.37). Throws on a chain that never
	 * ends, which no golden can capture.
	 */
	public settle(): number {
		let finished = 0;
		for (let round = 0; this.tweens.length > 0; round++) {
			if (round === MAX_SETTLE_ROUNDS) {
				throw new Error(`Animator.settle: ${this.tweens.length} tweens still running after ${MAX_SETTLE_ROUNDS} rounds; a completion keeps starting new ones`);
			}
			const count = this.tweens.length;
			for (let i = 0; i < count; i++) {
				const tween = this.tweens[i];
				if (!tween.running) continue;
				tween.finish();
				finished += 1;
			}
			this.compact();
		}
		return finished;
	}

	/**
	 * @internal A tween starting joins the end of the order. One restarted
	 * before the list dropped it (from its own `onComplete`, say) is still in
	 * it and keeps its place.
	 */
	public enlist(tween: Tween<TweenValue>): void {
		if (tween.listed) return;
		tween.listed = true;
		this.tweens.push(tween);
	}

	private compact(): void {
		let write = 0;
		for (let read = 0; read < this.tweens.length; read++) {
			const tween = this.tweens[read];
			if (tween.running) this.tweens[write++] = tween;
			else tween.listed = false;
		}
		this.tweens.length = write;
	}
}

function checkedDuration(duration: number | undefined): number {
	const value = duration ?? tokens.motion.dur;
	if (!(value >= 0) || !Number.isFinite(value)) {
		throw new Error(`Animator.tween: duration ${value} is not a finite, non-negative number of milliseconds`);
	}
	return value;
}

class Tween<T extends TweenValue> implements TweenHandle<T> {
	public readonly owner: TweenOwner | null;
	/** @internal In the animator's list, which drops finished tweens only between passes. */
	public listed = false;
	private readonly animator: Animator;
	private readonly onUpdate: (value: T) => void;
	private readonly onComplete: (() => void) | null;
	private readonly scalar: boolean;
	private readonly baseDuration: number;
	private ease: EaseFunction;

	private from: number[];
	private to: number[];
	private current: T;
	private startedAt = 0;
	private duration = 0;
	/** Where the run started before any reversal, and how much reversals have shortened it (CSS Transitions, 3.1). */
	private reversingFrom: number[];
	private shortening = 1;
	private easedProgress = 0;

	private isRunning = false;
	private settleRun: (() => void) | null = null;
	private runDone: Promise<void> | null = null;

	constructor(animator: Animator, { from, to, duration, ease, onUpdate, onComplete, owner }: TweenOptions<T>) {
		this.animator = animator;
		this.owner = owner ?? null;
		this.onUpdate = onUpdate;
		this.onComplete = onComplete ?? null;
		this.scalar = typeof from === 'number';
		this.from = toArray(from);
		this.to = toArray(to);
		if (this.from.length !== this.to.length) {
			throw new Error(`Animator.tween: from has ${this.from.length} components and to has ${this.to.length}`);
		}
		this.reversingFrom = this.from;
		this.current = from;
		this.baseDuration = duration ?? tokens.motion.dur;
		this.ease = resolveEase(ease ?? tokens.motion.ease_standard);
	}

	public get value(): T {
		return this.current;
	}

	public get running(): boolean {
		return this.isRunning;
	}

	public get done(): Promise<void> {
		if (!this.isRunning) return resolved;
		if (!this.runDone) this.runDone = new Promise((resolve) => { this.settleRun = resolve; });
		return this.runDone;
	}

	/** @internal */
	public start(from: T, duration: number, ease: Ease | undefined): void {
		if (ease !== undefined) this.ease = resolveEase(ease);
		this.from = toArray(from);
		this.duration = duration;
		this.startedAt = this.animator.now;
		this.easedProgress = 0;
		this.isRunning = true;
		this.animator.enlist(this as unknown as Tween<TweenValue>);
		this.apply(this.from);
	}

	/** @internal */
	public advance(now: number, reducedMotion: boolean): void {
		const linearProgress = reducedMotion || this.duration === 0
			? 1
			: Math.min((now - this.startedAt) / this.duration, 1);
		if (linearProgress >= 1) {
			this.finish();
			return;
		}
		this.easedProgress = this.ease(linearProgress);
		this.apply(this.interpolate(this.easedProgress));
	}

	/** @internal Jumps to `to` and completes. */
	public finish(): void {
		this.easedProgress = 1;
		this.apply(this.to);
		this.end();
		this.onComplete?.();
	}

	public cancel(): void {
		if (this.isRunning) this.end();
	}

	public retarget(to: T, options: RetargetOptions = {}): void {
		if (this.owner && !this.owner.isMounted) return;
		const target = toArray(to);
		if (target.length !== this.to.length) {
			throw new Error(`TweenHandle.retarget: target has ${target.length} components, the tween has ${this.to.length}`);
		}
		const duration = checkedDuration(options.duration ?? this.baseDuration);
		const current = toArray(this.current);

		if (this.isRunning && sameValue(target, this.reversingFrom)) {
			// CSS Transitions 3.1: a reversal starts its reversing-adjusted
			// start at the old end, and its duration shrinks by how far the
			// old run had got.
			this.shortening = Math.min(Math.max(Math.abs(this.easedProgress * this.shortening + 1 - this.shortening), 0), 1);
			this.reversingFrom = this.to;
		} else {
			this.shortening = 1;
			this.reversingFrom = current;
		}
		this.to = target;
		this.start(fromArray(current, this.scalar) as T, duration * this.shortening, options.ease);
	}

	private end(): void {
		this.isRunning = false;
		const settle = this.settleRun;
		this.settleRun = null;
		this.runDone = null;
		settle?.();
	}

	private interpolate(progress: number): number[] {
		const out = new Array<number>(this.from.length);
		for (let i = 0; i < out.length; i++) {
			out[i] = this.from[i] + (this.to[i] - this.from[i]) * progress;
		}
		return out;
	}

	private apply(values: readonly number[]): void {
		this.current = fromArray(values, this.scalar) as T;
		this.onUpdate(this.current);
	}
}

function toArray(value: TweenValue): number[] {
	return typeof value === 'number' ? [value] : [...value];
}

/** A fresh value per call: a callback may keep the array it was handed. */
function fromArray(values: readonly number[], scalar: boolean): TweenValue {
	return scalar ? values[0] : [...values];
}

function sameValue(a: readonly number[], b: readonly number[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (Math.abs(a[i] - b[i]) > 1e-9) return false;
	}
	return true;
}
