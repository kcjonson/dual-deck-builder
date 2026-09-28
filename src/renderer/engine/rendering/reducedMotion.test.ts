import { Animator } from '../animation/Animator';
import { Clock } from '../animation/Clock';
import { MotionPreference, followReducedMotion } from './reducedMotion';

function fakePreference(matches: boolean): MotionPreference & { set(value: boolean): void; listeners: number } {
	const listeners = new Set<(event: { matches: boolean }) => void>();
	const preference = {
		matches,
		get listeners() {
			return listeners.size;
		},
		addEventListener: (_type: 'change', listener: (event: { matches: boolean }) => void) => listeners.add(listener),
		removeEventListener: (_type: 'change', listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
		set: (value: boolean) => {
			preference.matches = value;
			for (const listener of listeners) listener({ matches: value });
		},
	};
	return preference;
}

describe('followReducedMotion (R11.13)', () => {
	it('takes the preference now and follows its changes until unsubscribed', () => {
		const animator = new Animator({ clock: new Clock() });
		const preference = fakePreference(true);

		const stop = followReducedMotion(animator, preference);
		expect(animator.reducedMotion).toBe(true);

		preference.set(false);
		expect(animator.reducedMotion).toBe(false);

		stop();
		expect(preference.listeners).toBe(0);
		preference.set(true);
		expect(animator.reducedMotion).toBe(false);
	});

	it('leaves the animator alone where there is no media query', () => {
		const animator = new Animator({ clock: new Clock() });

		followReducedMotion(animator, null)();

		expect(animator.reducedMotion).toBe(false);
	});
});
