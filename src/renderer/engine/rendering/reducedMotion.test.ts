import { Animator } from '../animation/Animator';
import { Clock } from '../animation/Clock';
import { MotionPreference, ReducedMotion } from './reducedMotion';

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

describe('ReducedMotion (R11.13)', () => {
	it('takes the preference now and follows its changes until disposed', () => {
		const animator = new Animator({ clock: new Clock() });
		const preference = fakePreference(true);

		const motion = new ReducedMotion({ animator, preference });
		expect(animator.reducedMotion).toBe(true);

		preference.set(false);
		expect(animator.reducedMotion).toBe(false);

		motion.dispose();
		expect(preference.listeners).toBe(0);
		preference.set(true);
		expect(animator.reducedMotion).toBe(false);
	});

	it('lets an override win over the system, and null hands it back', () => {
		const animator = new Animator({ clock: new Clock() });
		const preference = fakePreference(false);
		const motion = new ReducedMotion({ animator, preference });

		motion.override = true;
		expect(animator.reducedMotion).toBe(true);
		preference.set(false);
		expect(animator.reducedMotion).toBe(true);

		motion.override = false;
		preference.set(true);
		expect(animator.reducedMotion).toBe(false);

		motion.override = null;
		expect(animator.reducedMotion).toBe(true);
		expect(motion.system).toBe(true);
	});

	it('leaves the animator alone where there is no media query', () => {
		const animator = new Animator({ clock: new Clock() });

		const motion = new ReducedMotion({ animator, preference: null });

		expect(animator.reducedMotion).toBe(false);
		expect(motion.system).toBe(false);
		motion.dispose();
	});
});
