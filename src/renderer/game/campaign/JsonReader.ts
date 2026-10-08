/**
 * Readers for campaign state. Each takes a value that may have come from a
 * parsed save (so `unknown`) and the path it sits at, and returns it typed
 * or throws an error naming that path: a TypeError when it's the wrong kind
 * of value, a RangeError when it's the right kind out of range. The models
 * run the same readers on every change, so state that saves always loads.
 */

import type { JsonValue } from '../core/Json';

/** A value as an error message shows it: as JSON, cut short. */
export function describeValue(value: unknown): string {
	if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
		return typeof value;
	}
	if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
	let text: string;
	try {
		// A toJSON can return undefined, which stringifies to nothing.
		text = JSON.stringify(value) ?? String(value);
	} catch {
		text = Object.prototype.toString.call(value);
	}
	return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

export function readObject(value: unknown, path: string): Record<string, unknown> {
	if (!isPlainObject(value)) throw new TypeError(`${path} must be an object, got ${describeValue(value)}`);
	return value;
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
		if (!known.includes(key)) throw new TypeError(`${path} has an unknown field "${key}"`);
	}
	for (const field of fields) {
		if (!Object.prototype.hasOwnProperty.call(object, field)) throw new TypeError(`${path}.${field} is missing`);
	}
	return object as Record<Field | Optional, unknown>;
}

/** Any finite number. */
export function readNumber(value: unknown, path: string): number {
	if (typeof value !== 'number') throw new TypeError(`${path} must be a number, got ${describeValue(value)}`);
	if (!Number.isFinite(value)) throw new RangeError(`${path} must be a finite number, got ${describeValue(value)}`);
	return value;
}

/** An array with a value at every index, as JSON.parse always makes: `map` and `forEach` skip a hole, so nothing would check it. */
export function readArray(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${path} must be an array, got ${describeValue(value)}`);
	for (let index = 0; index < value.length; index += 1) {
		if (!(index in value)) throw new TypeError(`${path}[${index}] is missing: the array has a hole there`);
	}
	return value;
}

/** A string with something in it. */
export function readText(value: unknown, path: string): string {
	if (typeof value !== 'string') throw new TypeError(`${path} must be a string, got ${describeValue(value)}`);
	if (value.trim() === '') throw new RangeError(`${path} must not be blank`);
	return value;
}

export interface IntegerRange {
	min: number;
	max?: number;
	/** Names the max in the message when it comes from another field: "maxHitpoints (40)". */
	maxLabel?: string;
}

export function readInteger(value: unknown, path: string, { min, max, maxLabel }: IntegerRange): number {
	if (typeof value !== 'number') throw new TypeError(`${path} must be a number, got ${describeValue(value)}`);
	if (!Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) {
		const range = max === undefined ? `>= ${min}` : `from ${min} to ${maxLabel ?? max}`;
		throw new RangeError(`${path} must be an integer ${range}, got ${describeValue(value)}`);
	}
	return value;
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
	if (typeof value !== 'string') throw new TypeError(`${path} must be a string, got ${describeValue(value)}`);
	if (!(options as readonly string[]).includes(value)) {
		throw new RangeError(`${path} must be one of ${options.join(', ')}, got ${describeValue(value)}`);
	}
	return value as Option;
}

export function readNullable<T>(value: unknown, path: string, read: (value: unknown, path: string) => T): T | null {
	return value === null ? null : read(value, path);
}

/** Arrays and objects `freezeJson` made: checked, and frozen all the way down, so they can't have changed since. */
const frozenJson = new WeakSet<object>();

/**
 * A deep copy of a JSON value, frozen all the way down. Throws on anything
 * JSON can't hold: undefined, NaN, a class instance, a cycle. A value this
 * already made comes back as it is, so checking it again is free.
 */
export function freezeJson(value: unknown, path: string, ancestors: readonly object[] = []): JsonValue {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new RangeError(`${path} must be a finite number, got ${describeValue(value)}`);
		return value;
	}
	if (typeof value === 'object' && frozenJson.has(value)) return value as JsonValue;
	if (typeof value === 'object' && ancestors.includes(value)) throw new TypeError(`${path} contains itself`);
	let frozen: object;
	if (Array.isArray(value)) {
		const inside = [...ancestors, value];
		frozen = Object.freeze(Array.from(value, (item, index) => freezeJson(item, `${path}[${index}]`, inside)));
	} else if (isPlainObject(value)) {
		const inside = [...ancestors, value];
		frozen = Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeJson(item, `${path}.${key}`, inside)])));
	} else {
		throw new TypeError(`${path} must be JSON (null, a boolean, a number, a string, an array, or a plain object), got ${describeValue(value)}`);
	}
	frozenJson.add(frozen);
	return frozen as JsonValue;
}

/** A deep copy of a JSON value that isn't frozen, for handing out. */
export function copyJson<Value extends JsonValue>(value: Value): Value {
	if (Array.isArray(value)) return value.map(item => copyJson(item)) as Value;
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyJson(item)])) as Value;
	}
	return value;
}
