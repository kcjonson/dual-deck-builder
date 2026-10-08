/** Anything JSON can hold. */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

export type JsonObject = { [key: string]: JsonValue };

/**
 * A deep copy of `value` that JSON writes and reads back the same, built
 * from this realm's arrays and objects, so it shares nothing with `value`
 * and passes a plain-object check here. It takes null, booleans, strings,
 * finite numbers, arrays, and plain objects, another realm's included (a
 * test runner's, an iframe's).
 *
 * Anything else is a problem named by its path: undefined, a function, a
 * symbol, a bigint, NaN or Infinity, a class instance such as a Date, or a
 * cycle. The first one throws; given `problems`, each is pushed there
 * instead and the copy carries on, so a reader can report them all at once.
 */
export function copyJson<Value extends JsonValue>(value: Value, path: string): Value;
export function copyJson(value: unknown, path: string, problems?: string[]): JsonValue;
export function copyJson(value: unknown, path: string, problems?: string[]): JsonValue {
	const report = (problem: Error): null => {
		if (problems === undefined) throw problem;
		problems.push(problem.message);
		return null;
	};
	return copyValue(value, path, [], report);
}

/** A value as an error message shows it: what JSON holds as JSON, cut short, and anything else by its kind. */
export function describeValue(value: unknown): string {
	if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return typeof value;
	if (typeof value === 'number') return String(value);
	if (typeof value === 'object' && value !== null && !Array.isArray(value) && !isPlainObject(value)) {
		const name: unknown = Object.getPrototypeOf(value)?.constructor?.name;
		return typeof name === 'string' && name !== '' ? `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}` : 'an object';
	}
	let text: string;
	try {
		// A toJSON can return undefined, which stringifies to nothing.
		text = JSON.stringify(value) ?? String(value);
	} catch {
		// A cycle, or a bigint somewhere inside.
		text = Object.prototype.toString.call(value);
	}
	return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function copyValue(value: unknown, path: string, ancestors: readonly object[], report: (problem: Error) => null): JsonValue {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : report(new RangeError(`${path} must be a finite number, got ${describeValue(value)}`));
	}
	if (typeof value === 'object' && ancestors.includes(value)) return report(new TypeError(`${path} contains itself`));
	if (Array.isArray(value)) {
		const inside = [...ancestors, value];
		return Array.from({ length: value.length }, (_, index) => copyValue(value[index], `${path}[${index}]`, inside, report));
	}
	if (isPlainObject(value)) {
		const inside = [...ancestors, value];
		// fromEntries defines each key, so a "__proto__" key stays a key rather than setting the prototype.
		return Object.fromEntries(Object.keys(value).map((key) => [key, copyValue(value[key], `${path}.${key}`, inside, report)]));
	}
	return report(new TypeError(`${path} must be JSON (null, a boolean, a number, a string, an array, or a plain object), got ${describeValue(value)}`));
}

/** An object with no prototype, or with a realm's `Object.prototype` (whose own prototype is null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === null || Object.getPrototypeOf(prototype) === null;
}
