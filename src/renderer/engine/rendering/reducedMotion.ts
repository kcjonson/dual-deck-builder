import type { Animator } from '../animation/Animator';

/** The slice of `MediaQueryList` this reads. */
export interface MotionPreference {
	readonly matches: boolean;
	addEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
	removeEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
}

/**
 * The platform half of R11.13's reduced-motion setting: keeps the animator's
 * flag on the system preference, now and whenever it changes. Returns the
 * unsubscribe. Electron's renderer answers the same media query from the OS
 * setting, so both builds share this.
 */
export function followReducedMotion(
	animator: Animator,
	preference: MotionPreference | null = systemPreference(),
): () => void {
	if (!preference) return () => undefined;
	animator.reducedMotion = preference.matches;
	const listener = (event: { matches: boolean }): void => {
		animator.reducedMotion = event.matches;
	};
	preference.addEventListener('change', listener);
	return () => preference.removeEventListener('change', listener);
}

function systemPreference(): MotionPreference | null {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
	return window.matchMedia('(prefers-reduced-motion: reduce)');
}
