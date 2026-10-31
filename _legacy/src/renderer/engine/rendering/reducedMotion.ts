import type { Animator } from '../animation/Animator';

/** The slice of `MediaQueryList` this reads. */
export interface MotionPreference {
	readonly matches: boolean;
	addEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
	removeEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
}

export interface ReducedMotionOptions {
	animator: Animator;
	/** The system's preference; absent, `prefers-reduced-motion` where there is one. */
	preference?: MotionPreference | null;
}

/**
 * R11.13's reduced-motion setting: keeps the animator's flag on the system
 * preference, now and whenever it changes, unless an override from the
 * game's settings says otherwise. Electron's renderer answers the same media
 * query from the OS setting, so both builds share this.
 */
export class ReducedMotion {
	private readonly animator: Animator;
	private readonly preference: MotionPreference | null;
	private forced: boolean | null = null;

	constructor({ animator, preference = systemPreference() }: ReducedMotionOptions) {
		this.animator = animator;
		this.preference = preference;
		this.preference?.addEventListener('change', this.handleChange);
		this.apply();
	}

	/** What the system asks for; false where there is no media query. */
	public get system(): boolean {
		return this.preference?.matches ?? false;
	}

	/** True or false overrides the system; null follows it. */
	public get override(): boolean | null {
		return this.forced;
	}

	public set override(value: boolean | null) {
		this.forced = value;
		this.apply();
	}

	public dispose(): void {
		this.preference?.removeEventListener('change', this.handleChange);
	}

	private apply(): void {
		this.animator.reducedMotion = this.forced ?? this.system;
	}

	private handleChange = (): void => {
		this.apply();
	};
}

function systemPreference(): MotionPreference | null {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
	return window.matchMedia('(prefers-reduced-motion: reduce)');
}
