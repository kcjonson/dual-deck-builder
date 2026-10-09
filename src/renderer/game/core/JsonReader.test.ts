import { runInNewContext } from 'vm';
import { MAX_JSON_DEPTH, copyJson } from './Json';
import { ReaderRangeError, ReaderTypeError, freezeJson, isReaderError, readArray, readFields, readInteger, readObject } from './JsonReader';

class Weights {
	public wreck = 1;

	public get hazard(): number {
		return 2;
	}
}

/** Objects nested `levels` deep, the outermost counting as one. */
const nested = (levels: number): unknown => {
	let value: unknown = 1;
	for (let level = 0; level < levels; level += 1) value = { a: value };
	return value;
};

describe('JsonReader', () => {
	describe('freezeJson', () => {
		it('copies a value and freezes it all the way down', () => {
			const value = { roads: [{ id: 'r1', stops: [1, 2] }], seed: 7 };

			const frozen = freezeJson(value, 'map') as { roads: { stops: number[] }[] };

			expect(frozen).toEqual(value);
			expect(frozen).not.toBe(value);
			expect(Object.isFrozen(frozen.roads[0].stops)).toBe(true);
		});

		it('hands back a value it already froze, unchanged', () => {
			const frozen = freezeJson({ fog: [1] }, 'map');

			expect(freezeJson(frozen, 'map')).toBe(frozen);
		});

		it('rejects a class instance, even one JSON could write', () => {
			expect(() => freezeJson({ found: new Date(0) }, 'map')).toThrow('map.found must be JSON');
			expect(() => freezeJson(new Map(), 'map')).toThrow(TypeError);
			expect(() => freezeJson({ stops: new Weights() }, 'map')).toThrow(ReaderTypeError);
			expect(() => freezeJson({ stops: new Weights() }, 'map')).toThrow('map.stops must be JSON (null, a boolean, a number, a string, an array, or a plain object), got a Weights');
		});

		it('takes another realm\'s plain objects and arrays, and copies them into this one', () => {
			const foreign: unknown = runInNewContext('({ roads: [{ id: "r1", stops: [1, 2] }], seed: 7 })');
			expect(Object.getPrototypeOf(foreign)).not.toBe(Object.prototype);

			const frozen = freezeJson(foreign, 'map') as { roads: { stops: number[] }[] };

			expect(Object.getPrototypeOf(frozen)).toBe(Object.prototype);
			expect(Array.isArray(frozen.roads) && frozen.roads instanceof Array).toBe(true);
			expect(frozen).toStrictEqual({ roads: [{ id: 'r1', stops: [1, 2] }], seed: 7 });
			expect(Object.isFrozen(frozen.roads[0].stops)).toBe(true);
		});

		it('rejects another realm\'s class instance', () => {
			expect(() => freezeJson({ found: runInNewContext('new Map()') }, 'map')).toThrow('map.found must be JSON');
		});

		it('takes nesting as deep as copyJson does, and refuses one level more as a reader error', () => {
			expect(() => freezeJson(nested(MAX_JSON_DEPTH), 'map')).not.toThrow();
			expect(() => copyJson(nested(MAX_JSON_DEPTH), 'map')).not.toThrow();

			expect(() => freezeJson(nested(MAX_JSON_DEPTH + 1), 'map')).toThrow(ReaderRangeError);
			expect(() => freezeJson(nested(MAX_JSON_DEPTH + 1), 'map')).toThrow(`nests more than ${MAX_JSON_DEPTH} levels deep`);
			expect(() => copyJson(nested(MAX_JSON_DEPTH + 1), 'map')).toThrow(`nests more than ${MAX_JSON_DEPTH} levels deep`);
		});

		it('refuses nesting far past the stack\'s depth as a reader error, not a stack overflow', () => {
			const deep = JSON.parse(`${'{"a":'.repeat(20000)}1${'}'.repeat(20000)}`);

			expect(() => freezeJson(deep, 'map')).toThrow(ReaderRangeError);
		});

		it('counts the levels of a value it already froze when it\'s nested again', () => {
			const frozen = freezeJson(nested(MAX_JSON_DEPTH - 1), 'map');

			expect(freezeJson([frozen], 'map')).toEqual([frozen]);
			expect(() => freezeJson({ inner: [frozen] }, 'map')).toThrow(ReaderRangeError);
			expect(() => freezeJson({ inner: [nested(MAX_JSON_DEPTH - 1)] }, 'map')).toThrow(ReaderRangeError);
		});
	});

	it('readArray refuses an array with a hole, which map and forEach would skip over', () => {
		const holes: unknown[] = Array(2);
		holes[1] = 'north';

		expect(() => readArray(holes, 'list')).toThrow(ReaderTypeError);
		expect(() => readArray(holes, 'list')).toThrow(TypeError);
		expect(() => readArray(holes, 'list')).toThrow('list[0] is missing: the array has a hole there');
		expect(readArray([undefined, null], 'list')).toEqual([undefined, null]);
	});

	it('readFields refuses a field it doesn\'t know, and one that\'s missing', () => {
		expect(() => readFields({ a: 1 }, 'thing', ['a', 'b'])).toThrow('thing.b is missing');
		expect(() => readFields({ a: 1, c: 2 }, 'thing', ['a', 'b'])).toThrow('thing has an unknown field "c"');
	});

	it('readFields refuses a field the object only inherits, required or optional', () => {
		const bare = Object.assign(Object.create(null) as object, { a: 1, b: 2 });
		const onBare = Object.assign(Object.create(bare) as object, { c: 3 });

		expect(() => readFields(onBare, 'thing', ['a', 'c'])).toThrow(ReaderTypeError);
		expect(() => readFields(onBare, 'thing', ['a', 'c'])).toThrow('thing.a is inherited, not its own');
		expect(() => readFields(onBare, 'thing', ['c'], ['b'])).toThrow('thing.b is inherited, not its own');
		expect(readFields(onBare, 'thing', ['c'], ['d'])).toBe(onBare);
	});

	it('readObject and readFields take another realm\'s plain object', () => {
		const foreign: unknown = runInNewContext('({ a: 1, b: { c: 2 } })');

		expect(readObject(foreign, 'thing')).toBe(foreign);
		expect(readFields(foreign, 'thing', ['a', 'b']).a).toBe(1);
		expect(readObject(Object.create(null), 'thing')).toEqual({});
	});

	it.each([
		['a class instance', new Weights(), 'thing must be a plain object, got a Weights'],
		['another realm\'s class instance', runInNewContext('new Map()'), 'thing must be a plain object, got a Map'],
		['an object made on another', Object.create({ a: 1 }), 'thing must be a plain object, got an Object'],
		['an array', [], 'thing must be an object, got []'],
		['null', null, 'thing must be an object, got null'],
	])('readObject refuses %s', (_case, value, message) => {
		expect(() => readObject(value, 'thing')).toThrow(ReaderTypeError);
		expect(() => readObject(value, 'thing')).toThrow(message);
	});

	it('throws errors of its own, still TypeErrors and RangeErrors, so a bad value can be told from a bug', () => {
		const caught = (read: () => unknown): unknown => {
			try {
				read();
			} catch (error) {
				return error;
			}
			return null;
		};
		const wrongKind = caught(() => readInteger('7', 'count', { min: 0 }));
		const outOfRange = caught(() => readInteger(-1, 'count', { min: 0 }));
		const bug = caught(() => (null as unknown as { day: number }).day);

		expect([wrongKind instanceof ReaderTypeError, wrongKind instanceof TypeError]).toEqual([true, true]);
		expect([outOfRange instanceof ReaderRangeError, outOfRange instanceof RangeError]).toEqual([true, true]);
		expect([isReaderError(wrongKind), isReaderError(outOfRange), isReaderError(bug)]).toEqual([true, true, false]);
	});
});
