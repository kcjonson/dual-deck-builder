import { freshSeed, Rng, RNG_VERSION, WeightedEntry } from './Rng';

const SEED = 20261006;
const UINT32_MAX = 0xffffffff;

// Chi-squared critical values at p = 0.001, by degrees of freedom. The draws
// are fixed by the seed, so a pass holds until the algorithm or a seed changes.
const CHI_SQUARED_CRITICAL: Readonly<Record<number, number>> = { 3: 16.27, 4: 18.47, 5: 20.52, 9: 27.88 };

/** The next `count` raw draws. */
function take(rng: Rng, count = 16): number[] {
	return Array.from({ length: count }, () => rng.next());
}

function floats(rng: Rng, count: number): number[] {
	return Array.from({ length: count }, () => rng.float());
}

/** Pearson's statistic for counts against an even spread of their total. */
function chiSquared(counts: readonly number[], expected?: readonly number[]): number {
	const total = counts.reduce((sum, count) => sum + count, 0);
	let statistic = 0;
	counts.forEach((count, index) => {
		const expectedCount = expected ? expected[index] : total / counts.length;
		statistic += (count - expectedCount) ** 2 / expectedCount;
	});
	return statistic;
}

/** Counts of floats in [0, 1) across `bins` equal bins. */
function histogram(values: readonly number[], bins: number): number[] {
	const counts = new Array<number>(bins).fill(0);
	for (const value of values) counts[Math.floor(value * bins)] += 1;
	return counts;
}

function correlation(xs: readonly number[], ys: readonly number[]): number {
	const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
	const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
	let covariance = 0;
	let varianceX = 0;
	let varianceY = 0;
	for (let index = 0; index < xs.length; index += 1) {
		const dx = xs[index] - meanX;
		const dy = ys[index] - meanY;
		covariance += dx * dy;
		varianceX += dx * dx;
		varianceY += dy * dy;
	}
	return covariance / Math.sqrt(varianceX * varianceY);
}

/**
 * A real Rng whose raw draws come off the front of `script`, to reach the edges
 * a real stream almost never hits. Past the end of the script it throws, so a
 * call that draws more than it should fails instead of looping forever, and an
 * empty script afterwards means the call took every scripted draw.
 */
function scripted(script: number[]): Rng {
	const rng = new Rng({ seed: 0 });
	rng.next = () => {
		const draw = script.shift();
		if (draw === undefined) throw new Error('scripted Rng: drew past the end of its script');
		return draw;
	};
	return rng;
}

describe('Rng', () => {
	describe('the sequence', () => {
		it('repeats exactly for the same seed', () => {
			expect(take(new Rng({ seed: SEED }), 64)).toEqual(take(new Rng({ seed: SEED }), 64));
		});

		it('matches the pinned sfc32 sequence', () => {
			// Every map depends on these; an intended change bumps RNG_VERSION.
			// Cross-checked against PractRand's sfc32 and SMHasher's MurmurHash3
			// in C when pinned.
			expect(RNG_VERSION).toBe(1);
			expect(take(new Rng({ seed: SEED }), 8)).toEqual([
				0xbdd943ed, 0x34fa9b12, 0xa35b1c6f, 0x3a82c513, 0x360a65a6, 0xdaee38e7, 0xd23f8ec0, 0xf769aa1b,
			]);
			expect(take(new Rng({ seed: 0 }), 4)).toEqual([0x4fc89f56, 0x94fffb63, 0xa38c1db3, 0x48345ebb]);
			expect(take(new Rng({ seed: UINT32_MAX }), 4)).toEqual([0xa54b7665, 0x1108a63e, 0xc16a67f8, 0x53c7c08d]);
		});

		it('pins the derived draws', () => {
			expect(RNG_VERSION).toBe(1);
			const rng = new Rng({ seed: SEED });
			expect([rng.float(), rng.float(), rng.float()]).toEqual([0xbdd943ed / 2 ** 32, 0x34fa9b12 / 2 ** 32, 0xa35b1c6f / 2 ** 32]);
			expect(Array.from({ length: 10 }, () => rng.int(1, 6))).toEqual([6, 5, 6, 5, 4, 3, 4, 4, 2, 6]);
			expect(Array.from({ length: 5 }, () => rng.int(-50, 50))).toEqual([-33, -29, -34, -41, -41]);
			expect(Array.from({ length: 5 }, () => rng.pick(['raider', 'wreck', 'find', 'hazard']))).toEqual([
				'find', 'hazard', 'raider', 'hazard', 'hazard',
			]);
			expect(rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([0, 7, 1, 2, 5, 6, 8, 4, 3, 9]);
			const stops: WeightedEntry<string>[] = [
				{ value: 'raider', weight: 3 },
				{ value: 'checkpoint', weight: 2 },
				{ value: 'none', weight: 0 },
				{ value: 'wreck', weight: 1 },
			];
			expect(Array.from({ length: 12 }, () => rng.weighted(stops))).toEqual([
				'raider', 'checkpoint', 'raider', 'raider', 'raider', 'checkpoint',
				'checkpoint', 'raider', 'wreck', 'raider', 'wreck', 'wreck',
			]);
		});

		it('differs between neighbouring seeds', () => {
			expect(take(new Rng({ seed: 1 }))).not.toEqual(take(new Rng({ seed: 2 })));
		});

		it.each([
			[-1, UINT32_MAX],
			[2 ** 32 + 5, 5],
			[-(2 ** 32) - 2, UINT32_MAX - 1],
			[1.9, 1],
			[Number.NaN, 0],
			[Infinity, 0],
		])('coerces seed %p to the uint32 %p', (seed, uint32) => {
			const rng = new Rng({ seed });
			expect(rng.seed).toBe(uint32);
			expect(take(rng)).toEqual(take(new Rng({ seed: uint32 })));
		});

		// ToUint32 would turn each of these into a number, undefined and null into seed 0.
		it.each([[undefined], [null], ['123'], [true], [[5]]])('rejects the seed %p, which is not a number', (seed) => {
			expect(() => new Rng({ seed: seed as unknown as number })).toThrow(RangeError);
		});

		it('builds and warms up a stream without calling the public next()', () => {
			const next = jest.spyOn(Rng.prototype, 'next');
			try {
				new Rng({ seed: SEED }).fork('terrain', 3);
				expect(next).not.toHaveBeenCalled();
			} finally {
				next.mockRestore();
			}
		});
	});

	describe('fork', () => {
		it('derives the pinned child seeds', () => {
			expect(RNG_VERSION).toBe(1);
			const root = new Rng({ seed: SEED });
			expect(root.fork('terrain').seed).toBe(0x7843fb4e);
			expect(root.fork('terrain', 1).seed).toBe(0xb60805a9);
			expect(root.fork('terrain', UINT32_MAX).seed).toBe(0x855371ee);
			expect(root.fork('stop:123', 2).seed).toBe(0xc75516e2);
			expect(root.fork('').seed).toBe(0xf84e7cde);
			expect(root.fork('car \u{1F697}', 3).seed).toBe(0xddc4a4af);
			expect(take(root.fork('terrain', 1), 4)).toEqual([0xc20035bd, 0x07fa6c27, 0xd69e7744, 0x50e352a4]);
		});

		it('gives the same stream for the same name and attempt, with attempt 0 by default', () => {
			const root = new Rng({ seed: SEED });
			expect(take(root.fork('growth', 3))).toEqual(take(root.fork('growth', 3)));
			expect(take(root.fork('growth'))).toEqual(take(root.fork('growth', 0)));
		});

		it('does not depend on how far the parent has drawn', () => {
			const drawn = new Rng({ seed: SEED });
			take(drawn, 1000);
			expect(take(drawn.fork('terrain', 2))).toEqual(take(new Rng({ seed: SEED }).fork('terrain', 2)));
		});

		it('never advances the parent or a sibling, so fork order does not matter', () => {
			const root = new Rng({ seed: SEED });
			const terrain = root.fork('terrain');
			const growth = root.fork('growth');
			const stop = root.fork('stops').fork('stop:7', 1);
			take(terrain, 100);
			expect(take(root)).toEqual(take(new Rng({ seed: SEED })));
			expect(take(growth)).toEqual(take(new Rng({ seed: SEED }).fork('growth')));
			expect(take(stop)).toEqual(take(new Rng({ seed: SEED }).fork('stops').fork('stop:7', 1)));
		});

		it('gives each attempt its own stream', () => {
			const root = new Rng({ seed: SEED });
			const seeds = Array.from({ length: 32 }, (_, attempt) => root.fork('growth', attempt).seed);
			expect(new Set(seeds).size).toBe(32);
			expect(take(root.fork('growth', 1))).not.toEqual(take(root.fork('growth', 0)));
		});

		it('gives near-identical names their own streams', () => {
			const root = new Rng({ seed: SEED });
			const names = ['stop:1', 'stop:2', 'stop:12', 'stop:21', 'stop:01', 'Stop:1', 'stop:1 ', ' stop:1', 'stop1', 'terrain', 'terrain2', ''];
			expect(new Set(names.map((name) => root.fork(name).seed)).size).toBe(names.length);
			// 'b' is code unit 98, so a name and an attempt must not run together.
			expect(root.fork('a', 98).seed).not.toBe(root.fork('ab').seed);
		});

		it('takes any string as a name, hashing its UTF-16 code units', () => {
			const root = new Rng({ seed: SEED });
			for (const name of ['', 'Мёртвая дорога', 'car \u{1F697}', 'x'.repeat(10000)]) {
				expect(() => root.fork(name, 1)).not.toThrow();
			}
			// UTF-8 would encode each lone surrogate as U+FFFD, giving all three one stream.
			const seeds = ['\ud800', '\udc00', '\ufffd'].map((name) => root.fork(name).seed);
			expect(new Set(seeds).size).toBe(3);
		});

		it('gives every campaign seed its own stage stream', () => {
			// For a fixed name and attempt the child seed is a bijection of the parent's.
			const seeds = Array.from({ length: 10000 }, (_, seed) => new Rng({ seed }).fork('terrain').seed);
			expect(new Set(seeds).size).toBe(10000);
		});

		it('is rebuilt from its seed alone', () => {
			const stop = new Rng({ seed: SEED }).fork('stop:123', 2);
			expect(take(new Rng({ seed: stop.seed }))).toEqual(take(stop));
		});

		it('returns a base Rng built from the derived seed, whatever it was forked from', () => {
			// The scripted parent throws on any draw, and its replaced next() doesn't carry over.
			const child = scripted([]).fork('terrain', 2);
			expect(take(child)).toEqual(take(new Rng({ seed: 0 }).fork('terrain', 2)));
		});

		it.each([-1, 1.5, 2 ** 32, Number.NaN, Infinity])('rejects attempt %p', (attempt) => {
			expect(() => new Rng({ seed: SEED }).fork('terrain', attempt)).toThrow(RangeError);
		});

		it('reads a left-out attempt as 0 but rejects an explicit undefined', () => {
			const root = new Rng({ seed: SEED });
			expect(root.fork('stop:7').seed).toBe(root.fork('stop:7', 0).seed);
			// A roll count missing from an older save must not quietly rebuild roll 0.
			const saved: { rollCount?: number } = {};
			// @ts-expect-error: no signature takes an attempt that may be undefined.
			expect(() => root.fork('stop:7', saved.rollCount)).toThrow(RangeError);
		});

		it.each([[5], [7], [null], [undefined], [['terrain']]])('rejects the name %p, which is not a string', (name) => {
			expect(() => new Rng({ seed: SEED }).fork(name as unknown as string)).toThrow(RangeError);
		});
	});

	describe('float', () => {
		it('spans [0, 1) and never reaches 1', () => {
			expect(scripted([0]).float()).toBe(0);
			expect(scripted([UINT32_MAX]).float()).toBe(1 - 2 ** -32);
		});
	});

	describe('int', () => {
		it.each([
			[0, 0],
			[7, 7],
			[-7, -7],
			[0, 1],
			[-1, 0],
			[1, 6],
			[-3, 3],
			[-10, -1],
			[250, 260],
		])('stays inside [%d, %d] and reaches both ends', (min, max) => {
			const rng = new Rng({ seed: SEED });
			const seen = new Set<number>();
			for (let draw = 0; draw < 2000; draw += 1) seen.add(rng.int(min, max));
			const values = [...seen].sort((x, y) => x - y);
			expect(values).toEqual(Array.from({ length: max - min + 1 }, (_, offset) => min + offset));
		});

		it.each([
			[-(2 ** 31), 2 ** 31 - 1],
			[0, UINT32_MAX],
			[0, 2 ** 31],
			[Number.MAX_SAFE_INTEGER - UINT32_MAX, Number.MAX_SAFE_INTEGER],
			[Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER + 3],
		])('stays inside [%d, %d] at the widest spans and the safe-integer limits', (min, max) => {
			const rng = new Rng({ seed: SEED });
			for (let draw = 0; draw < 1000; draw += 1) {
				const value = rng.int(min, max);
				if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`int(${min}, ${max}) gave ${value}`);
			}
		});

		it('redraws instead of wrapping when a draw lands in the last, incomplete block', () => {
			// 2^32 = 6 * 715827882 + 4: the top four draws can't map evenly onto six values.
			const script = [2 ** 32 - 4, UINT32_MAX, 7];
			expect(scripted(script).int(0, 5)).toBe(1);
			expect(script).toEqual([]);
			expect(scripted([2 ** 32 - 5]).int(0, 5)).toBe(5);
			// A power-of-two span divides 2^32 evenly, so even the top draw sits in a complete block.
			const top = [UINT32_MAX];
			expect(scripted(top).int(0, 2 ** 31 - 1)).toBe(2 ** 31 - 1);
			expect(top).toEqual([]);
			// Span 2^31 + 1 rejects every draw above 2^31, so int returns the first raw draw at or below it.
			const raw = take(new Rng({ seed: SEED }), 64).filter((draw) => draw <= 2 ** 31);
			const rng = new Rng({ seed: SEED });
			expect(Array.from({ length: 10 }, () => rng.int(0, 2 ** 31))).toEqual(raw.slice(0, 10));
		});

		it('returns min plus the raw draw over a full 2^32 span, one draw each', () => {
			const raw = take(new Rng({ seed: SEED }), 4);
			const rng = new Rng({ seed: SEED });
			expect([rng.int(0, UINT32_MAX), rng.int(-(2 ** 31), 2 ** 31 - 1), rng.int(1, 2 ** 32)]).toEqual([raw[0], raw[1] - 2 ** 31, raw[2] + 1]);
			expect(rng.next()).toBe(raw[3]);
		});

		it.each([
			['min above max', 3, 2],
			['a fractional bound', 0.5, 3],
			['NaN', Number.NaN, 3],
			['an infinite bound', 0, Infinity],
			['unsafe bounds with a small span', 2 ** 53, 2 ** 53 + 2],
			['an unsafe min', -(2 ** 53), -(2 ** 53) + 2],
			['an unsafe max', Number.MAX_SAFE_INTEGER, 2 ** 53],
			['a span over 2^32', 0, 2 ** 32],
			['a string bound', '1' as unknown as number, 6],
		])('rejects %s', (_case, min, max) => {
			expect(() => new Rng({ seed: SEED }).int(min, max)).toThrow(RangeError);
		});
	});

	describe('pick', () => {
		it('returns every item over enough draws, and only those', () => {
			const rng = new Rng({ seed: SEED });
			const items = ['raider', 'wreck', 'find'] as const;
			const seen = new Set<string>();
			for (let draw = 0; draw < 300; draw += 1) seen.add(rng.pick(items));
			expect([...seen].sort()).toEqual(['find', 'raider', 'wreck']);
		});

		it('rejects an empty list', () => {
			expect(() => new Rng({ seed: SEED }).pick([])).toThrow(RangeError);
		});
	});

	describe('shuffle', () => {
		it('permutes the array in place and returns it', () => {
			const deck = Array.from({ length: 52 }, (_, card) => card);
			const shuffled = new Rng({ seed: SEED }).shuffle(deck);
			expect(shuffled).toBe(deck);
			expect([...deck].sort((x, y) => x - y)).toEqual(Array.from({ length: 52 }, (_, card) => card));
			expect(deck).not.toEqual(Array.from({ length: 52 }, (_, card) => card));
		});

		it('leaves empty and single-item arrays alone', () => {
			expect(new Rng({ seed: SEED }).shuffle([])).toEqual([]);
			expect(new Rng({ seed: SEED }).shuffle(['only'])).toEqual(['only']);
		});
	});

	describe('weighted', () => {
		it('never chooses a zero weight', () => {
			const rng = new Rng({ seed: SEED });
			const entries = [
				{ value: 'zero', weight: 0 },
				{ value: 'a', weight: 1 },
				{ value: 'zero', weight: 0 },
				{ value: 'b', weight: 2 },
				{ value: 'zero', weight: 0 },
			];
			const seen = new Set<string>();
			for (let draw = 0; draw < 10000; draw += 1) seen.add(rng.weighted(entries));
			expect([...seen].sort()).toEqual(['a', 'b']);
		});

		it('skips zero weights at the lowest and highest draws, even when the total is subnormal', () => {
			// Only a total this small lets the top draw's target round up to the total
			// and walk past the last positive weight.
			const entries = [
				{ value: 'zero', weight: 0 },
				{ value: 'first', weight: 5e-324 },
				{ value: 'zero', weight: 0 },
				{ value: 'last', weight: 5e-324 },
				{ value: 'zero', weight: 0 },
			];
			expect(scripted([0]).weighted(entries)).toBe('first');
			expect(scripted([UINT32_MAX]).weighted(entries)).toBe('last');
		});

		it('chooses the later entry when the target lands exactly on a running total', () => {
			// Draw 2^31 is the float 0.5, so the target is exactly 1, the first entry's running total.
			const entries = [{ value: 'first', weight: 1 }, { value: 'second', weight: 1 }];
			expect(scripted([2 ** 31]).weighted(entries)).toBe('second');
		});

		it.each([
			['an empty list', []],
			['all-zero weights', [{ value: 'a', weight: 0 }, { value: 'b', weight: 0 }]],
			['a negative weight', [{ value: 'a', weight: 2 }, { value: 'b', weight: -1 }]],
			['a NaN weight', [{ value: 'a', weight: Number.NaN }]],
			['an infinite weight', [{ value: 'a', weight: Infinity }]],
			['weights summing past the largest number', [{ value: 'a', weight: 1e308 }, { value: 'b', weight: 1e308 }]],
		])('rejects %s', (_case, entries: WeightedEntry<string>[]) => {
			expect(() => new Rng({ seed: SEED }).weighted(entries)).toThrow(RangeError);
		});

		// Each passes a `>= 0 && < Infinity` check, and string weights would concatenate the total.
		it.each([['3'], [true], [null], [[1]]])('rejects the weight %p, which is not a number', (weight) => {
			const entries = [{ value: 'a', weight: 1 }, { value: 'b', weight }] as unknown as WeightedEntry<string>[];
			expect(() => new Rng({ seed: SEED }).weighted(entries)).toThrow(RangeError);
		});
	});

	describe('draw counts', () => {
		type Call = (rng: Rng) => unknown;
		const manyEntries = Array.from({ length: 100 }, (_, index) => ({ value: index, weight: index % 3 }));
		const oneDrawCalls: [string, Call][] = [
			['float()', (rng) => rng.float()],
			['weighted() over one entry', (rng) => rng.weighted([{ value: 'only', weight: 1 }])],
			['weighted() over 100 entries, a third of them zero', (rng) => rng.weighted(manyEntries)],
		];
		const oneDrawCases = oneDrawCalls.flatMap(([name, call]) => [0, 2 ** 31, UINT32_MAX].map((draw): [string, number, Call] => [name, draw, call]));

		it.each(oneDrawCases)('takes exactly one draw for %s at draw %d', (_name, draw, call) => {
			const script = [draw];
			call(scripted(script));
			expect(script).toEqual([]);
		});

		it('takes one draw for int and pick, and another for each rejected draw', () => {
			const reference = take(new Rng({ seed: SEED }), 4);
			const rng = new Rng({ seed: SEED });
			rng.int(5, 5);
			rng.int(-1000, 1000);
			rng.pick(['only']);
			expect(rng.next()).toBe(reference[3]);
			// SEED's first draw is above 2^31, so int(0, 2^31) rejects it and returns the second.
			const rejecting = new Rng({ seed: SEED });
			expect(rejecting.int(0, 2 ** 31)).toBe(reference[1]);
			expect(rejecting.next()).toBe(reference[2]);
			// 2^32 = 3 * 1431655765 + 1, so the top draw is the incomplete block for three items.
			const script = [UINT32_MAX, 4];
			expect(scripted(script).pick(['a', 'b', 'c'])).toBe('b');
			expect(script).toEqual([]);
		});

		it('draws as int(0, index) for each index above 0 to shuffle', () => {
			const rng = new Rng({ seed: SEED });
			const shadow = new Rng({ seed: SEED });
			rng.shuffle([]);
			rng.shuffle(['only']);
			rng.shuffle(Array.from({ length: 10 }, (_, card) => card));
			for (let index = 9; index > 0; index -= 1) shadow.int(0, index);
			expect(rng.next()).toBe(shadow.next());
			// A rejected draw costs a shuffle a redraw too.
			const script = [UINT32_MAX, 4, 0];
			expect(scripted(script).shuffle(['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
			expect(script).toEqual([]);
		});
	});

	describe('distribution', () => {
		it('returns uint32s from next() with each bit set about half the time', () => {
			const rng = new Rng({ seed: SEED });
			const draws = 20000;
			const setCounts = new Array<number>(32).fill(0);
			for (let draw = 0; draw < draws; draw += 1) {
				const value = rng.next();
				if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) throw new Error(`next() gave ${value}`);
				for (let bit = 0; bit < 32; bit += 1) setCounts[bit] += (value >>> bit) & 1;
			}
			// 0.48 to 0.52 is more than five standard deviations either side.
			for (const count of setCounts) {
				expect(count / draws).toBeGreaterThan(0.48);
				expect(count / draws).toBeLessThan(0.52);
			}
		});

		it('spreads float() evenly over [0, 1)', () => {
			const values = floats(new Rng({ seed: SEED }), 100000);
			const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
			expect(Math.abs(mean - 0.5)).toBeLessThan(0.005);
			expect(chiSquared(histogram(values, 10))).toBeLessThan(CHI_SQUARED_CRITICAL[9]);
		});

		it('spreads int() evenly over its range', () => {
			const rng = new Rng({ seed: SEED });
			const counts = new Array<number>(10).fill(0);
			for (let draw = 0; draw < 100000; draw += 1) counts[rng.int(-5, 4) + 5] += 1;
			expect(chiSquared(counts)).toBeLessThan(CHI_SQUARED_CRITICAL[9]);
		});

		it('spreads pick() evenly over the items', () => {
			const rng = new Rng({ seed: SEED });
			const items = [0, 1, 2, 3, 4];
			const counts = new Array<number>(items.length).fill(0);
			for (let draw = 0; draw < 50000; draw += 1) counts[rng.pick(items)] += 1;
			expect(chiSquared(counts)).toBeLessThan(CHI_SQUARED_CRITICAL[4]);
		});

		it('chooses weighted entries in proportion to their weights', () => {
			const rng = new Rng({ seed: SEED });
			const entries = [1, 2, 3, 4].map((weight, index) => ({ value: index, weight }));
			const counts = [0, 0, 0, 0];
			const draws = 100000;
			for (let draw = 0; draw < draws; draw += 1) counts[rng.weighted(entries)] += 1;
			expect(chiSquared(counts, [0.1, 0.2, 0.3, 0.4].map((share) => share * draws))).toBeLessThan(CHI_SQUARED_CRITICAL[3]);
		});

		it('shuffles into every order about equally often', () => {
			const rng = new Rng({ seed: SEED });
			const counts = new Map<string, number>();
			for (let shuffle = 0; shuffle < 60000; shuffle += 1) {
				const order = rng.shuffle(['a', 'b', 'c']).join('');
				counts.set(order, (counts.get(order) ?? 0) + 1);
			}
			expect(counts.size).toBe(6);
			expect(chiSquared([...counts.values()])).toBeLessThan(CHI_SQUARED_CRITICAL[5]);
		});

		it('spreads the first draws of neighbouring seeds, names, and attempts, with no link between neighbours', () => {
			const count = 10000;
			const root = new Rng({ seed: SEED });
			const firstDraws = [
				Array.from({ length: count }, (_, seed) => new Rng({ seed }).float()),
				Array.from({ length: count }, (_, id) => root.fork(`stop:${id}`).float()),
				Array.from({ length: count }, (_, attempt) => root.fork('growth', attempt).float()),
			];
			for (const values of firstDraws) {
				expect(chiSquared(histogram(values, 10))).toBeLessThan(CHI_SQUARED_CRITICAL[9]);
				// Five standard deviations of a sample correlation over 10,000 pairs.
				expect(Math.abs(correlation(values.slice(0, -1), values.slice(1)))).toBeLessThan(0.05);
			}
		});

		it('keeps a fork uncorrelated with its parent and its siblings', () => {
			const root = new Rng({ seed: SEED });
			const parent = floats(new Rng({ seed: SEED }), 10000);
			const terrain = floats(root.fork('terrain'), 10000);
			const growth = floats(root.fork('growth'), 10000);
			const retry = floats(root.fork('terrain', 1), 10000);
			for (const [xs, ys] of [[parent, terrain], [terrain, growth], [terrain, retry]]) {
				expect(Math.abs(correlation(xs, ys))).toBeLessThan(0.05);
			}
		});
	});
});

describe('freshSeed', () => {
	it('scales Math.random, read on every call, to a uint32', () => {
		const random = jest.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(1 - 2 ** -53);
		try {
			expect([freshSeed(), freshSeed(), freshSeed()]).toEqual([0, 2 ** 31, UINT32_MAX]);
		} finally {
			random.mockRestore();
		}
	});
});
