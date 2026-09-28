import type { Animator, TweenHandle, TweenOwner } from '../animation/Animator';
import type { RGBA } from '../draw/geometry';
import { tokens } from '../theme/tokens';
import { Look, sameLook } from './look';

/**
 * R11.13's state transitions for one control. Colour and the pressed offset
 * move over `dur_fast`, the glow over `dur`, both on the standard ease,
 * through the mount context's animator, so reduced motion collapses them and
 * a hover that ends mid-way reverses from where it got to (the animator's
 * retarget). Width, radius, the style's shadow, and the focus ring switch at
 * once: the first three are not state layers, and the ring is independent of
 * every other layer so it must never lag one.
 *
 * Without an animator (unmounted) the look snaps.
 */
export class LookTransition {
	private readonly owner: TweenOwner;
	private shown: Look;
	private goal: Look;
	private colors: TweenHandle<readonly number[]> | null = null;
	private glow: TweenHandle<readonly number[]> | null = null;
	private readonly onChange: ((look: Look) => void) | null;

	/** `onChange` hears every step, so parts that draw themselves (a label, an icon) can follow the look. */
	constructor({ owner, look, onChange }: { owner: TweenOwner; look: Look; onChange?: (look: Look) => void }) {
		this.owner = owner;
		this.shown = { ...look };
		this.goal = look;
		this.onChange = onChange ?? null;
	}

	/** What render draws this frame. */
	public get look(): Look {
		return this.shown;
	}

	/** Where the look is heading; equal to `look` when nothing is moving. */
	public get target(): Look {
		return this.goal;
	}

	public moveTo(target: Look, animator: Animator | null): void {
		if (sameLook(target, this.goal)) return;
		this.goal = target;
		this.shown.borderWidth = target.borderWidth;
		this.shown.radius = target.radius;
		this.shown.shadow = target.shadow;
		this.shown.focusRing = target.focusRing;

		if (!animator) {
			this.snap();
			return;
		}
		this.onChange?.(this.shown);

		const colors = packColors(target);
		if (this.colors) {
			this.colors.retarget(colors);
		} else {
			this.colors = animator.tween<readonly number[]>({
				from: packColors(this.shown),
				to: colors,
				duration: tokens.motion.dur_fast,
				ease: tokens.motion.ease_standard,
				owner: this.owner,
				onUpdate: (values) => this.unpackColors(values),
			});
		}

		if (this.glow) {
			this.glow.retarget(target.glow);
		} else {
			this.glow = animator.tween<readonly number[]>({
				from: this.shown.glow,
				to: target.glow,
				duration: tokens.motion.dur,
				ease: tokens.motion.ease_standard,
				owner: this.owner,
				onUpdate: (values) => {
					this.shown.glow = values as unknown as RGBA;
					this.onChange?.(this.shown);
				},
			});
		}
	}

	/** Jumps to the target and drops the tweens; the owner calls it on mount and unmount. */
	public snap(): void {
		this.colors?.cancel();
		this.glow?.cancel();
		this.colors = null;
		this.glow = null;
		this.shown = { ...this.goal };
		this.onChange?.(this.shown);
	}

	private unpackColors(values: readonly number[]): void {
		this.shown.fill = [values[0], values[1], values[2], values[3]];
		this.shown.border = [values[4], values[5], values[6], values[7]];
		this.shown.text = [values[8], values[9], values[10], values[11]];
		this.shown.offsetY = values[12];
		this.onChange?.(this.shown);
	}
}

function packColors(look: Look): number[] {
	return [...look.fill, ...look.border, ...look.text, look.offsetY];
}
