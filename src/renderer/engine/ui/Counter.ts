import type { TweenHandle } from '../animation/Animator';
import type { MountContext } from '../components/MountContext';
import { Text, TextOptions } from '../components/Text';
import { tokens } from '../theme/tokens';

export type CounterFormat = (value: number) => string;

export interface CounterOptions extends TextOptions {
	value?: number;
	/** The shown number as text; whole numbers by default. Given every in-between value while it counts. */
	format?: CounterFormat;
	/** Milliseconds a change counts over. Default `dur_slow`. */
	duration?: number;
}

const WHOLE: CounterFormat = (value) => String(Math.round(value));

/**
 * R12.39's counter: a Text whose number counts toward `value` over
 * `dur_slow` through the animator (health, scrap, fuel), formatted by
 * `format` at every step. A value set while unmounted, or under reduced
 * motion, is shown at once; a new value mid-count heads there from where the
 * count is. A mono or tabular style keeps the width still while it counts.
 */
export class Counter extends Text {
	private target: number;
	private shown: number;
	private formatter: CounterFormat;
	private readonly duration: number;
	private tween: TweenHandle<number> | null = null;

	constructor({ value = 0, format = WHOLE, duration = tokens.motion.dur_slow, ...options }: CounterOptions = {}) {
		super(format(value), options);
		this.componentType = 'Counter';
		this.target = value;
		this.shown = value;
		this.formatter = format;
		this.duration = duration;
	}

	public get value(): number {
		return this.target;
	}

	public set value(value: number) {
		if (value === this.target) return;
		this.target = value;
		const animator = this.context?.animator;
		if (!animator) {
			this.tween?.cancel();
			this.tween = null;
			this.show(value);
			return;
		}
		if (this.tween?.running) {
			this.tween.retarget(value);
			return;
		}
		this.tween = animator.tween({
			from: this.shown,
			to: value,
			duration: this.duration,
			owner: this,
			onUpdate: (shown) => this.show(shown),
		});
	}

	/** The number on screen now, mid-count included. */
	public get displayedValue(): number {
		return this.shown;
	}

	public get format(): CounterFormat {
		return this.formatter;
	}

	public set format(format: CounterFormat) {
		this.formatter = format;
		this.setText(format(this.shown));
	}

	/**
	 * An unmount cancels the count where it was (R8.15); mounting again shows
	 * the value it was heading for, not the number it stopped on.
	 */
	protected onMount(context: MountContext): void {
		super.onMount(context);
		this.tween = null;
		if (this.shown !== this.target) this.show(this.target);
	}

	private show(value: number): void {
		this.shown = value;
		this.setText(this.formatter(value));
	}
}
