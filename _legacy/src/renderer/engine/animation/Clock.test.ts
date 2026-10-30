import { Clock } from './Clock';

describe('Clock (R8.28)', () => {
	it('starts at zero and moves only when advanced', () => {
		const clock = new Clock();
		expect([clock.now, clock.dt, clock.frame]).toEqual([0, 0, 0]);

		clock.advance(16);
		clock.advance(20);

		expect(clock.now).toBe(36);
		expect(clock.dt).toBe(20);
		expect(clock.frame).toBe(2);
	});

	it('counts frames but moves no time while frozen (R13.37)', () => {
		const clock = new Clock();
		clock.advance(10);
		clock.frozen = true;
		clock.advance(16);

		expect(clock.now).toBe(10);
		expect(clock.dt).toBe(0);
		expect(clock.frame).toBe(2);

		clock.frozen = false;
		clock.advance(5);
		expect(clock.now).toBe(15);
	});

	it('rejects a negative or non-finite delta', () => {
		const clock = new Clock();
		expect(() => clock.advance(-1)).toThrow('not a finite, non-negative duration');
		expect(() => clock.advance(Number.NaN)).toThrow();
		expect(() => clock.advance(Number.POSITIVE_INFINITY)).toThrow();
		expect(clock.frame).toBe(0);
	});
});
