/**
 * Seeded random streams for generation and campaign code, which never calls
 * `Math.random`. The generator is sfc32 (PractRand's reference step and
 * three-word seeding), and a stream is rebuilt exactly from its uint32 seed.
 * `fork` derives a named child stream from (seed, name, attempt) alone, so no
 * stream depends on another's draws or on the order streams were forked in.
 *
 * The core is integer math (`Math.imul`, `>>> 0`) and `weighted` uses only
 * IEEE addition and multiplication, so a seed yields the same numbers in every
 * JS engine. Changing anything here moves every generated map: the algorithm,
 * the fork hash, and each method's draw count are pinned by golden tests and
 * recorded in docs/AI_TECHNICAL_DECISIONS/seeded-prng.md.
 */

export interface RngOptions {
	/** Any number, coerced with ECMAScript ToUint32 (`seed >>> 0`). */
	seed: number;
}

export interface WeightedEntry<T> {
	readonly value: T;
	/** Finite and >= 0. A zero weight is never chosen. */
	readonly weight: number;
}

const UINT32_COUNT = 4294967296;
const FLOAT_SCALE = 1 / UINT32_COUNT;
/** The SplitMix increment that spaces the three seed words apart. */
const GOLDEN_GAMMA = 0x9e3779b9;
/** Draws discarded after seeding, as PractRand's sfc32 `seed(s1, s2, s3)` does. */
const WARMUP_DRAWS = 15;

export class Rng {
	private readonly streamSeed: number;
	private a: number;
	private b: number;
	private c: number;
	private counter: number;

	constructor({ seed }: RngOptions) {
		this.streamSeed = seed >>> 0;
		this.a = fmix32(this.streamSeed + GOLDEN_GAMMA);
		this.b = fmix32(this.streamSeed + 2 * GOLDEN_GAMMA);
		this.c = fmix32(this.streamSeed + 3 * GOLDEN_GAMMA);
		this.counter = 1;
		for (let draw = 0; draw < WARMUP_DRAWS; draw += 1) this.next();
	}

	/** The uint32 this stream was built from; `new Rng({ seed })` replays it from the start. */
	public get seed(): number {
		return this.streamSeed;
	}

	/**
	 * The child stream `name` at `attempt`, a pure function of this stream's
	 * seed, the name, and the attempt: it never reads or advances this stream,
	 * so siblings don't depend on call order or on how far this one has drawn.
	 * Names are any string (`terrain`, `stop:123`); `attempt` is a retry or
	 * reroll count, an integer from 0 to 2^32 - 1.
	 */
	public fork(name: string, attempt = 0): Rng {
		if (!Number.isInteger(attempt) || attempt < 0 || attempt >= UINT32_COUNT) {
			throw new RangeError(`Rng.fork: attempt must be an integer from 0 to 2^32 - 1, got ${attempt}`);
		}
		return new Rng({ seed: forkSeed(this.streamSeed, name, attempt) });
	}

	/** The next raw draw, a uint32. One sfc32 step. */
	public next(): number {
		const b = this.b;
		const c = this.c;
		const result = (this.a + b + this.counter) | 0;
		this.counter = (this.counter + 1) | 0;
		this.a = b ^ (b >>> 9);
		this.b = (c + (c << 3)) | 0;
		this.c = (((c << 21) | (c >>> 11)) + result) | 0;
		return result >>> 0;
	}

	/** A float in [0, 1), a multiple of 2^-32. One draw. */
	public float(): number {
		return this.next() * FLOAT_SCALE;
	}

	/**
	 * An integer in [min, max], both ends inclusive, with no modulo bias. The
	 * bounds are safe integers spanning at most 2^32 values. One draw, or more
	 * on a rejection, which happens with probability below span / 2^32.
	 */
	public int(min: number, max: number): number {
		if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
			throw new RangeError(`Rng.int: bounds must be safe integers with min <= max, got ${min} and ${max}`);
		}
		const span = max - min + 1;
		if (span > UINT32_COUNT) throw new RangeError(`Rng.int: [${min}, ${max}] spans more than 2^32 values`);
		return min + this.below(span);
	}

	/** A uniformly chosen item, drawing as `int(0, items.length - 1)` does. Throws on an empty list. */
	public pick<T>(items: readonly T[]): T {
		if (items.length === 0) throw new RangeError('Rng.pick: no items to pick from');
		return items[this.below(items.length)];
	}

	/**
	 * Shuffles `items` in place (Fisher-Yates from the last index down) and
	 * returns it. One bounded draw per index above 0.
	 */
	public shuffle<T>(items: T[]): T[] {
		for (let index = items.length - 1; index > 0; index -= 1) {
			const other = this.below(index + 1);
			const held = items[index];
			items[index] = items[other];
			items[other] = held;
		}
		return items;
	}

	/**
	 * A value chosen with probability weight / total weight. One draw. Throws
	 * on an empty list, a negative or non-finite weight, or a total that is
	 * zero or overflows.
	 */
	public weighted<T>(entries: readonly WeightedEntry<T>[]): T {
		let total = 0;
		for (let index = 0; index < entries.length; index += 1) {
			const weight = entries[index].weight;
			if (!(weight >= 0 && weight < Infinity)) {
				throw new RangeError(`Rng.weighted: weight at ${index} must be finite and >= 0, got ${weight}`);
			}
			total += weight;
		}
		if (!(total > 0 && total < Infinity)) {
			throw new RangeError(`Rng.weighted: the weights must sum to a finite number above 0, got ${total}`);
		}
		const target = this.float() * total;
		let cumulative = 0;
		let chosen = 0;
		for (let index = 0; index < entries.length; index += 1) {
			const weight = entries[index].weight;
			if (weight === 0) continue;
			cumulative += weight;
			chosen = index;
			if (target < cumulative) break;
		}
		return entries[chosen].value;
	}

	/**
	 * A uniform integer in [0, span) for span in [1, 2^32]: `draw % span`,
	 * redrawing while the draw falls in the last, incomplete block of span values.
	 */
	private below(span: number): number {
		let draw = this.next();
		let value = draw % span;
		while (draw - value > UINT32_COUNT - span) {
			draw = this.next();
			value = draw % span;
		}
		return value;
	}
}

/**
 * MurmurHash3_x86_32 seeded with the parent's seed, over the name's UTF-16 code
 * units and then the attempt, each as one little-endian uint32 block, so the
 * input is 4 * (name.length + 1) bytes and has no tail.
 */
function forkSeed(parentSeed: number, name: string, attempt: number): number {
	let hash = parentSeed;
	for (let index = 0; index < name.length; index += 1) hash = murmurBlock(hash, name.charCodeAt(index));
	hash = murmurBlock(hash, attempt);
	return fmix32(hash ^ ((name.length + 1) * 4));
}

function murmurBlock(hash: number, block: number): number {
	let mixed = Math.imul(block, 0xcc9e2d51);
	mixed = (mixed << 15) | (mixed >>> 17);
	mixed = Math.imul(mixed, 0x1b873593);
	const folded = hash ^ mixed;
	return (Math.imul((folded << 13) | (folded >>> 19), 5) + 0xe6546b64) | 0;
}

/** MurmurHash3's 32-bit finalizer, a bijection on uint32. */
function fmix32(value: number): number {
	let hash = value | 0;
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 0x85ebca6b);
	hash ^= hash >>> 13;
	hash = Math.imul(hash, 0xc2b2ae35);
	hash ^= hash >>> 16;
	return hash >>> 0;
}
