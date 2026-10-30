/**
 * Strict readers for JSON values from outside the code, such as a parsed
 * save or a data file. Each takes a value (so `unknown`) and the path it
 * sits at, and returns it typed or throws an error naming that path: a
 * `ReaderTypeError` when it's the wrong kind of value, a `ReaderRangeError`
 * when it's the right kind out of range.
 */

import { MAX_JSON_DEPTH, describeValue, isPlainObject, type JsonValue } from './Json';

/**
 * A value of the wrong kind, as a reader reports it. A TypeError, so it
 * reads like one; a class of its own, so a load can tell a damaged save
 * from a bug in the code reading it.
 */
export class ReaderTypeError extends TypeError {}

/** A value of the right kind out of range, as a reader reports it. */
export class ReaderRangeError extends RangeError {}

/** Whether a reader threw this over a value, rather than code failing on its own. */
export function isReaderError(error: unknown): boolean {
	return error instanceof ReaderTypeError || error instanceof ReaderRangeError;
}

/** A plain object (`isPlainObject`), another realm's included; never a class instance or an array. */
export function readObject(value: unknown, path: string): Record<string, unknown> {
	if (isPlainObject(value)) return value;
	const object = typeof value === 'object' && value !== null && !Array.isArray(value);
	throw new ReaderTypeError(`${path} must be ${object ? 'a plain object' : 'an object'}, got ${describeValue(value)}`);
}

/**
 * A plain object with exactly these fields: none missing, none extra.
 * Optional fields may be left out, and read as undefined when they are.
 */
export function readFields<Field extends string, Optional extends string = never>(
	value: unknown,
	path: string,
	fields: readonly Field[],
	optional: readonly Optional[] = []
): Record<Field | Optional, unknown> {
	const object = readObject(value, path);
	const known: readonly string[] = [...fields, ...optional];
	for (const key of Object.keys(object)) {
		if (!known.includes(key)) throw new ReaderTypeError(`${path} has an unknown field "${key}"`);
	}
	for (const field of fields) {
		if (!Object.prototype.hasOwnProperty.call(object, field)) throw new ReaderTypeError(`${path}.${field} is missing`);
	}
	return object as Record<Field | Optional, unknown>;
}

/**
 * The value at `key`, read once. A getter that throws (code can hand a
 * reader one; JSON.parse never makes one) becomes a reader error naming
 * `path`, the value's own path.
 */
export function readValueAt(container: object, key: string | number, path: string): unknown {
	try {
		return (container as Record<string | number, unknown>)[key];
	} catch (error) {
		throw new ReaderTypeError(`${path} can't be read: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Any finite number, with -0 as 0, which is what JSON writes it as. */
export function readNumber(value: unknown, path: string): number {
	if (typeof value !== 'number') throw new ReaderTypeError(`${path} must be a number, got ${describeValue(value)}`);
	if (!Number.isFinite(value)) throw new ReaderRangeError(`${path} must be a finite number, got ${describeValue(value)}`);
	return value + 0;
}

/**
 * An array with a value at every index, as JSON.parse always makes: `map`
 * and `forEach` skip a hole, so nothing would check it. It comes back as it
 * is, so a reader that keeps what it reads builds it with `Array.from`:
 * another realm's array's own `map` builds that realm's arrays.
 */
export function readArray(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new ReaderTypeError(`${path} must be an array, got ${describeValue(value)}`);
	for (let index = 0; index < value.length; index += 1) {
		if (!(index in value)) throw new ReaderTypeError(`${path}[${index}] is missing: the array has a hole there`);
	}
	return value;
}

/** A string with something in it. */
export function readText(value: unknown, path: string): string {
	if (typeof value !== 'string') throw new ReaderTypeError(`${path} must be a string, got ${describeValue(value)}`);
	if (value.trim() === '') throw new ReaderRangeError(`${path} must not be blank`);
	return value;
}

export interface IntegerRange {
	min: number;
	max?: number;
	/** Names the max in the message when it comes from another field: "maxHitpoints (40)". */
	maxLabel?: string;
}

/** An integer in range, with -0 as 0, which is what JSON writes it as. */
export function readInteger(value: unknown, path: string, { min, max, maxLabel }: IntegerRange): number {
	if (typeof value !== 'number') throw new ReaderTypeError(`${path} must be a number, got ${describeValue(value)}`);
	if (!Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) {
		const range = max === undefined ? `>= ${min}` : `from ${min} to ${maxLabel ?? max}`;
		throw new ReaderRangeError(`${path} must be an integer ${range}, got ${describeValue(value)}`);
	}
	return value + 0;
}

const UINT32_MAX = 0xffffffff;

/**
 * A seed: an integer from 0 to 2^32 - 1. NaN, Infinity, and anything that
 * isn't a number fail here, where `new Rng({ seed })` would coerce NaN and
 * Infinity to 0 and quietly build seed 0's map.
 */
export function readSeed(value: unknown, path: string): number {
	return readInteger(value, path, { min: 0, max: UINT32_MAX });
}

export function readOneOf<Option extends string>(value: unknown, path: string, options: readonly Option[]): Option {
	if (typeof value !== 'string') throw new ReaderTypeError(`${path} must be a string, got ${describeValue(value)}`);
	if (!(options as readonly string[]).includes(value)) {
		throw new ReaderRangeError(`${path} must be one of ${options.join(', ')}, got ${describeValue(value)}`);
	}
	return value as Option;
}

export function readNullable<T>(value: unknown, path: string, read: (value: unknown, path: string) => T): T | null {
	return value === null ? null : read(value, path);
}

/**
 * Arrays and objects `freezeJson` made, checked and frozen all the way
 * down, so they can't have changed since, with how many levels each nests.
 */
const frozenJson = new WeakMap<object, number>();

/**
 * A deep copy of a JSON value, frozen all the way down and built from this
 * realm's arrays and objects, whatever realm the value's came from. Throws on
 * anything JSON can't hold: undefined, NaN, a class instance, a cycle, a
 * getter that throws, or nesting past `MAX_JSON_DEPTH` levels, the limit
 * `copyJson` holds the map's stop tables to, so a value this takes never
 * overflows the stack or fails a copy later. A value this already made comes
 * back as it is, so checking it again is free.
 */
export function freezeJson(value: unknown, path: string): JsonValue {
	return freezeValue(value, path, []);
}

function freezeValue(value: unknown, path: string, ancestors: readonly object[]): JsonValue {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new ReaderRangeError(`${path} must be a finite number, got ${describeValue(value)}`);
		return value;
	}
	if (!Array.isArray(value) && !isPlainObject(value)) {
		throw new ReaderTypeError(`${path} must be JSON (null, a boolean, a number, a string, an array, or a plain object), got ${describeValue(value)}`);
	}
	const container: object = value;
	const made = frozenJson.get(container);
	if (made !== undefined) {
		if (ancestors.length + made > MAX_JSON_DEPTH) throw tooDeep(path);
		return container as JsonValue;
	}
	if (ancestors.includes(container)) throw new ReaderTypeError(`${path} contains itself`);
	if (ancestors.length >= MAX_JSON_DEPTH) throw tooDeep(path);
	const inside = [...ancestors, container];
	let levels = 1;
	const freezeAt = (key: string | number, itemPath: string): JsonValue => {
		const frozen = freezeValue(readValueAt(container, key, itemPath), itemPath, inside);
		if (typeof frozen === 'object' && frozen !== null) levels = Math.max(levels, (frozenJson.get(frozen) ?? 0) + 1);
		return frozen;
	};
	const frozen = Array.isArray(container)
		? Object.freeze(Array.from({ length: container.length }, (_, index) => freezeAt(index, `${path}[${index}]`)))
		: Object.freeze(Object.fromEntries(Object.keys(container).map(key => [key, freezeAt(key, `${path}.${key}`)])));
	frozenJson.set(frozen, levels);
	return frozen as JsonValue;
}

function tooDeep(path: string): ReaderRangeError {
	return new ReaderRangeError(`${path} nests more than ${MAX_JSON_DEPTH} levels deep`);
}
