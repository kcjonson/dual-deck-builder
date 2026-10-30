import type { TweenHandle } from '../animation/Animator';
import type { DrawApi } from '../draw/DrawApi';
import type { Rect } from '../draw/geometry';
import type { Look } from '../style/look';
import { CONTROL_SIZES } from '../style/variants';
import { tokens } from '../theme/tokens';
import { Checkable, CheckableOptions } from './Checkbox';

export type ToggleOptions = CheckableOptions;

/** The thumb's inset from the track's edge. */
const THUMB_INSET = tokens.space.space_0_5;

/**
 * R12.9's toggle (switch): a Checkbox with a pill track and a sliding thumb
 * instead of a box and a check, and no indeterminate state. The track is
 * two marks wide and one high; the thumb slides over `dur_fast` through the
 * animator, so reduced motion jumps it (R11.13).
 */
export class Toggle extends Checkable {
	/** 0 off, 1 on; what render draws, mid-slide included. */
	private thumbPosition: number;
	private slide: TweenHandle<number> | null = null;

	constructor(options: ToggleOptions = {}) {
		super(options);
		this.componentType = 'Toggle';
		this.thumbPosition = this.checked ? 1 : 0;
	}

	/** Where the thumb is drawn, 0 (off) to 1 (on). */
	public get thumb(): number {
		return this.thumbPosition;
	}

	protected get markSize(): { width: number; height: number } {
		const size = CONTROL_SIZES[this.size].iconSize;
		return { width: size * 2, height: size };
	}

	protected onMount(): void {
		super.onMount();
		this.slide = null;
		this.thumbPosition = this.checked ? 1 : 0;
	}

	protected onStateChange(): void {
		super.onStateChange();
		// `checked` is set in the base constructor, before this class's fields exist.
		if (this.thumbPosition === undefined) return;
		const target = this.checked ? 1 : 0;
		const animator = this.context?.animator;
		if (!animator) {
			this.slide = null;
			this.thumbPosition = target;
			return;
		}
		if (this.slide) {
			this.slide.retarget(target);
			return;
		}
		if (this.thumbPosition === target) return;
		this.slide = animator.tween({
			from: this.thumbPosition,
			to: target,
			duration: tokens.motion.dur_fast,
			ease: tokens.motion.ease_standard,
			owner: this,
			onUpdate: (value) => {
				this.thumbPosition = value;
			},
		});
	}

	protected drawMark(draw: DrawApi, rect: Rect, look: Look): void {
		this.drawMarkBox(draw, rect, look, rect.height / 2);
		const diameter = rect.height - THUMB_INSET * 2;
		const travel = rect.width - THUMB_INSET * 2 - diameter;
		const radius = diameter / 2;
		draw.drawCircle({
			center: { x: rect.x + THUMB_INSET + radius + travel * this.thumbPosition, y: rect.y + rect.height / 2 },
			radius,
			fill: look.text,
		});
	}
}
