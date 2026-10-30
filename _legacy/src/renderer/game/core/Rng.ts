/**
 * Seeded random streams. Game code draws from these and never calls
 * `Math.random`; a new root seed is minted by `freshSeed`. The generator is
 * sfc32, with PractRand's reference step and three-word seeding.
 *
 * The core is integer math and `weighted` uses only IEEE addition and
 * multiplication, so a seed draws the same numbers in every JS engine. Golden
 * tests pin the algorithm, the fork hash, and each method's draw count;
 * changing any of them moves every generated map and needs an `RNG_VERSION`
 * bump. See docs/AI_TECHNICAL_DECISIONS/seeded-prng.md.
 */

/** Names what a seed draws, so a change to the draws needs a bump. The goldens assert it; the map generator's version builds on it. */
export const RNG_VERSION = 1;

export interface RngOptions {
	/** Any number, coerced with ECMAScript ToUint32 (`seed >>> 0`), so NaN and Infinity give 0. Anything else throws. */
	seed: number;
}

export interface WeightedEntry<T> {
	readonly value: T;
	/** A finite number >= 0. A zero weight is never chosen. */
	readonly weight: number;
}

// Globals read once, at load: under Jest's vm context each global read costs about 0.15 us.
const imul = Math.imul;
const isInteger = Number.isInteger;
const isSafeInteger = Number.isSafeInteger;
const INFINITY = Infinity;
const StateArray = Int32Array;

const UINT32_COUNT = 4294967296;
/** The SplitMix increment that spaces the three seed words apart. */
const GOLDEN_GAMMA = 0x9e3779b9;
/** Draws discarded after seeding, as PractRand's sfc32 `seed(s1, s2, s3)` does. */
const WARMUP_DRAWS = 15;

/** A new root seed; the one place root seeds for generation, the campaign, and fights are minted. Reads `Math.random` per call, so a patched one applies. */
export function freshSeed(): number {
	// eslint-disable-next-line no-restricted-properties -- minting a root seed is the one unseeded read game code makes
	return (Math.random() * UINT32_COUNT) >>> 0;
}

/**
 * A seeded stream of draws, rebuilt exactly from its uint32 seed.
 *
 * Not designed for subclassing: the constructor calls no overridable method,
 * and `fork` always returns a base `Rng`. Methods aren't bound, so where a
 * `() => number` source is wanted, pass `() => rng.float()`. The argument
 * checks throw a RangeError for a wrong type as well as an out-of-range value.
 */
export class Rng {
	private readonly streamSeed: number;
	/**
	 * sfc32's a, b, c, and counter (PractRand's names), in int32 slots because
	 * V8 would box number fields holding them as doubles.
	 */
	private readonly state: Int32Array;

	constructor({ seed }: RngOptions) {
		// A seed missing from a save would otherwise coerce to 0 and build seed 0's map.
		if (typeof seed !== 'number') throw new RangeError(`Rng: seed must be a number, got ${display(seed)}`);
		this.streamSeed = seed >>> 0;
		let a = fmix32(this.streamSeed + GOLDEN_GAMMA);
		let b = fmix32(this.streamSeed + 2 * GOLDEN_GAMMA);
		let c = fmix32(this.streamSeed + 3 * GOLDEN_GAMMA);
		let counter = 1;
		// next()'s step again, on locals: a shared step(state) made construction 5 to 15 ns slower.
		for (let draw = 0; draw < WARMUP_DRAWS; draw += 1) {
			const result = (a + b + counter) | 0;
			a = b ^ (b >>> 9);
			b = (c + (c << 3)) | 0;
			c = (((c << 21) | (c >>> 11)) + result) | 0;
			counter = (counter + 1) | 0;
		}
		const state = new StateArray(4);
		state[0] = a;
		state[1] = b;
		state[2] = c;
		state[3] = counter;
		this.state = state;
	}

	/** The uint32 this stream was built from; `new Rng({ seed })` replays it from the start. */
	public get seed(): number {
		return this.streamSeed;
	}

	/**
	 * The child stream `name` at `attempt`, a pure function of this stream's
	 * seed, the name, and the attempt: it never reads or advances this stream,
	 * so siblings don't depend on call order or on how far this one has drawn.
	 * Always a base `Rng` built from the derived seed. Names are any string
	 * (`terrain`, `stop:123`); `attempt` is a retry or reroll count, an integer
	 * from 0 to 2^32 - 1, and 0 when left out. An explicit `undefined` throws,
	 * so a count missing from a save can't quietly become 0.
	 */
	public fork(name: string, ...rest: [] | [attempt: number]): Rng {
		if (typeof name !== 'string') throw new RangeError(`Rng.fork: name must be a string, got ${display(name)}`);
		const attempt = rest.length === 0 ? 0 : rest[0];
		if (!isInteger(attempt) || attempt < 0 || attempt >= UINT32_COUNT) {
			throw new RangeError(`Rng.fork: attempt must be an integer from 0 to 2^32 - 1, got ${display(attempt)}`);
		}
		return new Rng({ seed: forkSeed(this.streamSeed, name, attempt) });
	}

	/** The next raw draw, a uint32. One sfc32 step. */
	public next(): number {
		const state = this.state;
		const a = state[0];
		const b = state[1];
		const c = state[2];
		const counter = state[3];
		const result = (a + b + counter) | 0;
		state[0] = b ^ (b >>> 9);
		state[1] = (c + (c << 3)) | 0;
		state[2] = (((c << 21) | (c >>> 11)) + result) | 0;
		state[3] = (counter + 1) | 0;
		return result >>> 0;
	}

	/** A float in [0, 1), a multiple of 2^-32. One draw. */
	public float(): number {
		return this.next() / UINT32_COUNT;
	}

	/**
	 * An integer in [min, max], both ends inclusive, with no modulo bias. The
	 * bounds are safe integers spanning at most 2^32 values. One draw, or more
	 * on a rejection, which happens with probability below span / 2^32.
	 */
	public int(min: number, max: number): number {
		if (!isSafeInteger(min) || !isSafeInteger(max) || min > max) {
			throw new RangeError(`Rng.int: bounds must be safe integers with min <= max, got ${display(min)} and ${display(max)}`);
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
	 * returns the same array, drawing as `int(0, index)` for each index above 0.
	 * A caller that needs a new array shuffles a copy.
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
	 * on an empty list, a weight that isn't a finite number >= 0, or a total
	 * that is zero or overflows.
	 */
	public weighted<T>(entries: readonly WeightedEntry<T>[]): T {
		let total = 0;
		let last = 0;
		for (let index = 0; index < entries.length; index += 1) {
			const weight = entries[index].weight;
			if (typeof weight !== 'number' || !(weight >= 0 && weight < INFINITY)) {
				throw new RangeError(`Rng.weighted: weight at ${index} must be a finite number >= 0, got ${display(weight)}`);
			}
			total += weight;
			if (weight > 0) last = index;
		}
		if (!(total > 0 && total < INFINITY)) {
			throw new RangeError(`Rng.weighted: the weights must sum to a finite number above 0, got ${total}`);
		}
		// A zero weight can't carry `cumulative` past the target, and stopping at the
		// last positive weight keeps a target that rounds up to a subnormal total off
		// trailing zeros.
		const target = this.float() * total;
		let cumulative = 0;
		for (let index = 0; index < last; index += 1) {
			cumulative += entries[index].weight;
			if (target < cumulative) return entries[index].value;
		}
		return entries[last].value;
	}

	/**
	 * A uniform integer in [0, span) for span in [1, 2^32]: `draw % span`,
	 * redrawn while the draw falls in the last, incomplete block of span values.
	 */
	private below(span: number): number {
		if (span === UINT32_COUNT) return this.next();
		// A uint32 divisor and a uint32 result let V8 divide in integers rather than call Float64Mod.
		const divisor = span >>> 0;
		for (;;) {
			const draw = this.next();
			const value = (draw % divisor) >>> 0;
			if (draw - value <= UINT32_COUNT - divisor) return value;
		}
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
	let mixed = imul(block, 0xcc9e2d51);
	mixed = (mixed << 15) | (mixed >>> 17);
	mixed = imul(mixed, 0x1b873593);
	const folded = hash ^ mixed;
	return (imul((folded << 13) | (folded >>> 19), 5) + 0xe6546b64) | 0;
}

/** MurmurHash3's 32-bit finalizer, a bijection on uint32. */
function fmix32(value: number): number {
	let hash = value | 0;
	hash ^= hash >>> 16;
	hash = imul(hash, 0x85ebca6b);
	hash ^= hash >>> 13;
	hash = imul(hash, 0xc2b2ae35);
	hash ^= hash >>> 16;
	return hash >>> 0;
}

/** A rejected argument as an error shows it: numbers as written, strings quoted, anything else by type. */
function display(value: unknown): string {
	if (typeof value === 'number') return String(value);
	if (typeof value === 'string') return JSON.stringify(value);
	return value === null ? 'null' : typeof value;
}
