/** Anything JSON can hold. */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

export type JsonObject = { [key: string]: JsonValue };

/** How many levels arrays and objects may nest: far deeper than any JSON the game holds, and well short of the stack. */
export const MAX_JSON_DEPTH = 100;

/**
 * The problems a reader found, for one error that names them. It keeps the
 * first `limit` and only counts the rest, so a value with millions of bad
 * entries can't build a list as long.
 */
export class ProblemList {
	private readonly listed: string[] = [];
	private unlisted = 0;
	private readonly limit: number;

	constructor({ limit }: { limit: number }) {
		this.limit = limit;
	}

	public get empty(): boolean {
		return this.listed.length === 0;
	}

	public add(problem: string): void {
		if (this.listed.length < this.limit) this.listed.push(problem);
		else this.unlisted += 1;
	}

	/** The problems in one line: "a; b; and 3 more". */
	public toString(): string {
		const listed = this.listed.join('; ');
		return this.unlisted === 0 ? listed : `${listed}; and ${this.unlisted} more`;
	}
}

/**
 * A deep copy of `value` that JSON writes and reads back the same, built
 * from this realm's arrays and objects, so it shares nothing with `value`
 * and passes a plain-object check here. It takes null, booleans, strings,
 * finite numbers, arrays, and plain objects, another realm's included (a
 * test runner's, an iframe's).
 *
 * Anything else is a problem named by its path: undefined, a function, a
 * symbol, a bigint, NaN or Infinity, a class instance such as a Date, a
 * cycle, a getter that throws, or nesting past 100 levels. The first one
 * throws; given `problems`, each goes there instead and the copy carries on,
 * so a reader can report them all at once.
 */
export function copyJson<Value extends JsonValue>(value: Value, path: string): Value;
export function copyJson(value: unknown, path: string, problems?: ProblemList): JsonValue;
export function copyJson(value: unknown, path: string, problems?: ProblemList): JsonValue {
	return copyValue(value, path, [], (ErrorType, message) => {
		if (problems === undefined) throw new ErrorType(message);
		problems.add(message);
		return null;
	});
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
		// A cycle, a bigint somewhere inside, or a getter that throws.
		text = Object.prototype.toString.call(value);
	}
	return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** Throws or lists a problem; the error is only built to be thrown. */
type Report = (ErrorType: new (message: string) => Error, message: string) => null;

function copyValue(value: unknown, path: string, ancestors: readonly object[], report: Report): JsonValue {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : report(RangeError, `${path} must be a finite number, got ${describeValue(value)}`);
	}
	const isArray = Array.isArray(value);
	if (!isArray && !isPlainObject(value)) {
		return report(TypeError, `${path} must be JSON (null, a boolean, a number, a string, an array, or a plain object), got ${describeValue(value)}`);
	}
	const container = value as Record<string | number, unknown>;
	if (ancestors.includes(container)) return report(TypeError, `${path} contains itself`);
	if (ancestors.length >= MAX_JSON_DEPTH) return report(RangeError, `${path} nests more than ${MAX_JSON_DEPTH} levels deep`);
	const inside = [...ancestors, container];
	const copyAt = (key: string | number, itemPath: string): JsonValue => {
		let item: unknown;
		try {
			item = container[key];
		} catch (error) {
			return report(TypeError, `${itemPath} can't be read: ${error instanceof Error ? error.message : String(error)}`);
		}
		return copyValue(item, itemPath, inside, report);
	};
	if (isArray) return Array.from({ length: (value as unknown[]).length }, (_, index) => copyAt(index, `${path}[${index}]`));
	// fromEntries defines each key, so a "__proto__" key stays a key rather than setting the prototype.
	return Object.fromEntries(Object.keys(container).map((key) => [key, copyAt(key, `${path}.${key}`)]));
}

/**
 * An object whose prototype is null or has a null prototype of its own: a
 * plain object from any realm (its `Object.prototype` has none), or one made
 * with no prototype. A rare object built otherwise to the same shape, such as
 * an instance of a class extending null, passes too, and copies like one.
 * Anything with a class's prototype fails, a Date or another realm's Map
 * included, and so does an object made on an ordinary one
 * (`Object.create({ radius: 5000 })`), whose values it would inherit.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === null || Object.getPrototypeOf(prototype) === null;
}
