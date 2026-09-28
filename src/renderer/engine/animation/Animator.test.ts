import { tokens } from '../theme/tokens';
import { Animator, TweenOwner } from './Animator';
import { Clock } from './Clock';
import { cubicBezier, linear } from './easing';

function setup(options: { reducedMotion?: boolean } = {}): { clock: Clock; animator: Animator; frame: (ms: number) => void } {
	const clock = new Clock();
	const animator = new Animator({ clock, ...options });
	return {
		clock,
		animator,
		frame: (ms: number) => {
			clock.advance(ms);
			animator.tick();
		},
	};
}

function owner(mounted = true): TweenOwner & { isMounted: boolean } {
	return { isMounted: mounted };
}

describe('Animator.tween (R8.28)', () => {
	it('applies from at once, interpolates on each tick, and ends on to', () => {
		const { animator, frame } = setup();
		const values: number[] = [];
		const onComplete = jest.fn();
		const handle = animator.tween({ from: 0, to: 100, duration: 100, ease: linear, onUpdate: (value) => values.push(value), onComplete });

		expect(values).toEqual([0]);
		expect(handle.running).toBe(true);
		expect(animator.active).toBe(1);

		frame(25);
		frame(50);
		expect(values).toEqual([0, 25, 75]);
		expect(onComplete).not.toHaveBeenCalled();

		frame(50);
		expect(values).toEqual([0, 25, 75, 100]);
		expect(onComplete).toHaveBeenCalledTimes(1);
		expect(handle.running).toBe(false);
		expect(handle.value).toBe(100);
		expect(animator.active).toBe(0);
	});

	it('defaults to the motion tokens', () => {
		const { animator, frame } = setup();
		let value = 0;
		animator.tween({ from: 0, to: 1, onUpdate: (next) => { value = next; } });

		frame(tokens.motion.dur / 2);
		expect(value).toBeCloseTo(cubicBezier(tokens.motion.ease_standard)(0.5), 9);
		frame(tokens.motion.dur / 2);
		expect(value).toBe(1);
	});

	it('interpolates arrays per element and hands out a fresh array each time', () => {
		const { animator, frame } = setup();
		const seen: (readonly number[])[] = [];
		animator.tween({ from: [0, 0, 0, 1], to: [1, 0.5, 0, 0], duration: 100, ease: linear, onUpdate: (value) => seen.push(value) });

		frame(50);

		expect(seen[1]).toEqual([0.5, 0.25, 0, 0.5]);
		expect(seen[1]).not.toBe(seen[0]);
	});

	it('ticks in creation order, and a tween started during a tick waits for the next', () => {
		const { animator, frame } = setup();
		const log: string[] = [];
		animator.tween({
			from: 0, to: 1, duration: 10, ease: linear,
			onUpdate: (value) => log.push(`a${value}`),
			onComplete: () => {
				animator.tween({ from: 5, to: 6, duration: 10, ease: linear, onUpdate: (value) => log.push(`c${value}`) });
			},
		});
		animator.tween({ from: 0, to: 1, duration: 20, ease: linear, onUpdate: (value) => log.push(`b${value}`) });
		log.length = 0;

		frame(10);
		expect(log).toEqual(['a1', 'c5', 'b0.5']);

		log.length = 0;
		frame(5);
		expect(log).toEqual(['b0.75', 'c5.5']);
	});

	it('completes a zero-duration tween on its first tick', () => {
		const { animator, frame } = setup();
		const onUpdate = jest.fn();
		animator.tween({ from: 0, to: 1, duration: 0, onUpdate });

		frame(0);

		expect(onUpdate).toHaveBeenLastCalledWith(1);
		expect(animator.active).toBe(0);
	});

	it('rejects mismatched lengths and bad durations', () => {
		const { animator } = setup();
		expect(() => animator.tween({ from: [0, 0], to: [1, 1, 1], onUpdate: () => undefined })).toThrow('from has 2 components');
		expect(() => animator.tween({ from: 0, to: 1, duration: -5, onUpdate: () => undefined })).toThrow('duration -5');
	});
});

describe('reduced motion (R8.28, R11.13)', () => {
	it('completes every tween on its first tick, even with no time passing', () => {
		const { animator, frame } = setup({ reducedMotion: true });
		const values: number[] = [];
		const onComplete = jest.fn();
		animator.tween({ from: 0, to: 10, duration: 5000, onUpdate: (value) => values.push(value), onComplete });

		frame(0);

		expect(values).toEqual([0, 10]);
		expect(onComplete).toHaveBeenCalledTimes(1);
	});

	it('collapses a tween already in flight when the setting turns on', () => {
		const { animator, frame } = setup();
		let value = 0;
		animator.tween({ from: 0, to: 10, duration: 100, ease: linear, onUpdate: (next) => { value = next; } });
		frame(10);
		expect(value).toBe(1);

		animator.reducedMotion = true;
		frame(10);

		expect(value).toBe(10);
		expect(animator.active).toBe(0);
	});
});

describe('retargeting (R8.28)', () => {
	it('heads for a new target from the current value over the full duration', () => {
		const { animator, frame } = setup();
		const values: number[] = [];
		const handle = animator.tween({ from: 0, to: 100, duration: 100, ease: linear, onUpdate: (value) => values.push(value) });
		frame(40);

		handle.retarget(200);
		frame(50);
		frame(50);

		expect(values).toEqual([0, 40, 40, 120, 200]);
	});

	it('reverses in the time the way back takes, not the whole duration (CSS reversing)', () => {
		const { animator, frame } = setup();
		let value = 0;
		const handle = animator.tween({ from: 0, to: 100, duration: 200, ease: linear, onUpdate: (next) => { value = next; } });
		frame(50);
		expect(value).toBe(25);

		// A quarter of the way out, so a quarter of the duration back.
		handle.retarget(0);
		frame(25);
		expect(value).toBe(12.5);
		expect(handle.running).toBe(true);
		frame(25);
		expect(value).toBe(0);
		expect(handle.running).toBe(false);
	});

	it('compounds the shortening across repeated reversals', () => {
		const { animator, frame } = setup();
		let value = 0;
		const handle = animator.tween({ from: 0, to: 100, duration: 200, ease: linear, onUpdate: (next) => { value = next; } });
		frame(50);
		handle.retarget(0);
		frame(25);
		expect(value).toBe(12.5);

		// Back out again: CSS's factor is 0.5 * 0.25 + (1 - 0.25) = 0.875 of 200 ms.
		handle.retarget(100);
		frame(87.5);
		expect(value).toBeCloseTo(56.25, 9);
		frame(87.5);
		expect(value).toBe(100);
		expect(handle.running).toBe(false);
	});

	it('restarts a finished tween, once, even from its own completion', () => {
		const { animator, frame } = setup();
		const values: number[] = [];
		let restarted = false;
		const handle = animator.tween({
			from: 0, to: 10, duration: 10, ease: linear,
			onUpdate: (value) => values.push(value),
			onComplete: () => {
				if (restarted) return;
				restarted = true;
				handle.retarget(0);
			},
		});
		frame(10);
		expect(animator.active).toBe(1);

		frame(5);
		expect(values).toEqual([0, 10, 10, 5]);
		frame(5);
		expect(values).toEqual([0, 10, 10, 5, 0]);
		expect(animator.active).toBe(0);
	});
});

describe('cancel, owners and done', () => {
	it('cancel stops the tween where it is with no completion', async () => {
		const { animator, frame } = setup();
		const onUpdate = jest.fn();
		const onComplete = jest.fn();
		const handle = animator.tween({ from: 0, to: 10, duration: 100, ease: linear, onUpdate, onComplete });
		frame(50);
		const done = handle.done;

		handle.cancel();
		frame(100);

		expect(onUpdate).toHaveBeenCalledTimes(2);
		expect(onComplete).not.toHaveBeenCalled();
		expect(handle.value).toBe(5);
		await expect(done).resolves.toBeUndefined();
	});

	it('done resolves when the run completes', async () => {
		const { animator, frame } = setup();
		const handle = animator.tween({ from: 0, to: 1, duration: 10, onUpdate: () => undefined });
		let resolved = false;
		void handle.done.then(() => { resolved = true; });

		frame(5);
		await Promise.resolve();
		expect(resolved).toBe(false);

		frame(5);
		await Promise.resolve();
		expect(resolved).toBe(true);
	});

	it('cancels only the tweens an owner holds', () => {
		const { animator, frame } = setup();
		const leaving = owner();
		const staying = owner();
		const left = animator.tween({ from: 0, to: 1, duration: 10, owner: leaving, onUpdate: () => undefined });
		const stayed = animator.tween({ from: 0, to: 1, duration: 10, owner: staying, onUpdate: () => undefined });

		animator.cancelOwnedBy(leaving);
		expect(animator.active).toBe(1);
		frame(5);

		expect(left.running).toBe(false);
		expect(stayed.running).toBe(true);
		expect(animator.active).toBe(1);
	});

	it('never starts a tween for an unmounted owner, and will not restart one', () => {
		const { animator } = setup();
		const gone = owner(false);
		const onUpdate = jest.fn();
		const handle = animator.tween({ from: 0, to: 1, owner: gone, onUpdate });

		handle.retarget(2);

		expect(onUpdate).not.toHaveBeenCalled();
		expect(handle.running).toBe(false);
		expect(animator.active).toBe(0);
	});
});

describe('Animator.settle (R13.37)', () => {
	it('finishes every tween and the ones their completions start', () => {
		const { animator } = setup();
		const values: number[] = [];
		animator.tween({
			from: 0, to: 1, duration: 1000,
			onUpdate: (value) => values.push(value),
			onComplete: () => {
				animator.tween({ from: 1, to: 2, duration: 1000, onUpdate: (value) => values.push(value) });
			},
		});

		expect(animator.settle()).toBe(2);
		expect(values).toEqual([0, 1, 1, 2]);
		expect(animator.active).toBe(0);
		expect(animator.settle()).toBe(0);
	});

	it('throws on a chain that never ends', () => {
		const { animator } = setup();
		const loop = (): void => {
			animator.tween({ from: 0, to: 1, onUpdate: () => undefined, onComplete: loop });
		};
		loop();

		expect(() => animator.settle()).toThrow('still running after 64 rounds');
	});
});
