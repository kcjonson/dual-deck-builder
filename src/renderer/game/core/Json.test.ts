import { runInNewContext } from 'vm';
import { JsonObject, ProblemList, copyJson, describeValue, isPlainObject } from './Json';

class Weights {
	constructor(public wreck = 1) {}
}

const NOT_JSON = 'must be JSON (null, a boolean, a number, a string, an array, or a plain object)';

describe('copyJson', () => {
	it('copies JSON all the way down, sharing nothing', () => {
		const value: JsonObject = { trail: { wreck: [1, 2.5, 'x', true, null] }, highway: {} };
		const copy = copyJson(value, 'stopTables');
		expect(copy).toStrictEqual(value);
		expect(copy).not.toBe(value);
		expect(copy.trail).not.toBe(value.trail);
		expect((copy.trail as JsonObject).wreck).not.toBe((value.trail as JsonObject).wreck);
	});

	it('builds another realm\'s objects and arrays in this one', () => {
		const foreign: unknown = runInNewContext('({ trail: { wreck: [1, { hazard: 2 }] } })');
		expect(Object.getPrototypeOf(foreign)).not.toBe(Object.prototype);
		const copy = copyJson(foreign, 'stopTables');
		expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
		expect(copy).toStrictEqual({ trail: { wreck: [1, { hazard: 2 }] } });
	});

	it('takes an object with no prototype, and keeps a "__proto__" key as a key', () => {
		const bare = Object.assign(Object.create(null) as Record<string, unknown>, { wreck: 1 });
		expect(copyJson(bare, 'stopTables')).toStrictEqual({ wreck: 1 });
		const copy = copyJson(JSON.parse('{"__proto__": {"wreck": 1}}'), 'stopTables') as JsonObject;
		expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
		expect(Object.keys(copy)).toEqual(['__proto__']);
	});

	it('copies a value that appears twice, which isn\'t a cycle, twice', () => {
		const shared = { wreck: 1 };
		const copy = copyJson({ trail: shared, highway: shared }, 'stopTables') as JsonObject;
		expect(copy).toStrictEqual({ trail: { wreck: 1 }, highway: { wreck: 1 } });
		expect(copy.trail).not.toBe(copy.highway);
	});

	it.each([
		['NaN', { trail: { wreck: NaN } }, 'stopTables.trail.wreck must be a finite number, got NaN', RangeError],
		['Infinity in a list', { trail: [1, -Infinity] }, 'stopTables.trail[1] must be a finite number, got -Infinity', RangeError],
		['undefined in a list', { trail: [1, undefined] }, `stopTables.trail[1] ${NOT_JSON}, got undefined`, TypeError],
		['a hole in a list', { trail: [1, , 3] }, `stopTables.trail[1] ${NOT_JSON}, got undefined`, TypeError],
		['a function', { trail: () => 1 }, `stopTables.trail ${NOT_JSON}, got function`, TypeError],
		['a symbol', { trail: Symbol('wreck') }, `stopTables.trail ${NOT_JSON}, got symbol`, TypeError],
		['a bigint', { trail: BigInt(1) }, `stopTables.trail ${NOT_JSON}, got bigint`, TypeError],
		['a Date', { trail: new Date(0) }, `stopTables.trail ${NOT_JSON}, got a Date`, TypeError],
		['a class instance', { trail: new Weights() }, `stopTables.trail ${NOT_JSON}, got a Weights`, TypeError],
	])('throws on %s, naming its path', (_case, value, message, type) => {
		expect(() => copyJson(value, 'stopTables')).toThrow(type);
		expect(() => copyJson(value, 'stopTables')).toThrow(message);
	});

	it('throws on a cycle, naming where it closes', () => {
		const cyclic: Record<string, unknown> = { trail: { wreck: 1 } };
		(cyclic.trail as Record<string, unknown>).back = cyclic;
		expect(() => copyJson(cyclic, 'stopTables')).toThrow(new TypeError('stopTables.trail.back contains itself'));
	});

	it('throws on a getter that throws, naming its path', () => {
		const trail = Object.defineProperty({}, 'wreck', { enumerable: true, get: () => { throw new Error('no weights yet'); } });
		expect(() => copyJson({ trail }, 'stopTables')).toThrow(new TypeError('stopTables.trail.wreck can\'t be read: no weights yet'));
	});

	it('throws on nesting past 100 levels, naming where, rather than run out of stack', () => {
		let deep: unknown = 1;
		for (let level = 0; level < 5000; level += 1) deep = [deep];
		expect(() => copyJson(deep, 'stopTables')).toThrow(`stopTables${'[0]'.repeat(100)} nests more than 100 levels deep`);
		let fine: unknown = 1;
		for (let level = 0; level < 100; level += 1) fine = [fine];
		expect(copyJson(fine, 'stopTables')).toStrictEqual(fine);
	});

	it('lists every problem instead when given a list, and copies the rest', () => {
		const problems = new ProblemList({ limit: 10 });
		const copy = copyJson({ wreck: NaN, hazard: [undefined], raider: { ambush: Infinity }, find: 2 }, 'stopTables', problems);
		expect(String(problems)).toBe([
			'stopTables.wreck must be a finite number, got NaN',
			`stopTables.hazard[0] ${NOT_JSON}, got undefined`,
			'stopTables.raider.ambush must be a finite number, got Infinity',
		].join('; '));
		expect(copy).toMatchObject({ find: 2 });
	});

	it('lists the first problems up to the limit and counts the rest', () => {
		const problems = new ProblemList({ limit: 2 });
		copyJson({ trail: new Array(100_000) }, 'stopTables', problems);
		expect(String(problems)).toBe(`stopTables.trail[0] ${NOT_JSON}, got undefined; stopTables.trail[1] ${NOT_JSON}, got undefined; and 99998 more`);
	});
});

describe('isPlainObject', () => {
	it.each([
		['an object literal', { wreck: 1 }],
		['another realm\'s object', runInNewContext('({ wreck: 1 })')],
		['an object with no prototype', Object.create(null)],
	])('takes %s', (_case, value) => {
		expect(isPlainObject(value)).toBe(true);
	});

	it.each([
		['null', null],
		['a list', [1]],
		['another realm\'s list', runInNewContext('[1]')],
		['a Date', new Date(0)],
		['a class instance', new Weights()],
		['another realm\'s class instance', runInNewContext('new Map()')],
		['an object made on another, whose values it would inherit', Object.create({ wreck: 1 })],
		['a string', 'x'],
	])('refuses %s', (_case, value) => {
		expect(isPlainObject(value)).toBe(false);
	});
});

describe('ProblemList', () => {
	it('is empty until a problem is added, then lists it', () => {
		const problems = new ProblemList({ limit: 3 });
		expect(problems.empty).toBe(true);
		problems.add('seed is missing');
		expect(problems.empty).toBe(false);
		expect(String(problems)).toBe('seed is missing');
	});
});

describe('describeValue', () => {
	it.each([
		['a string', 'x', '"x"'],
		['a number', 2.5, '2.5'],
		['NaN', NaN, 'NaN'],
		['null', null, 'null'],
		['undefined', undefined, 'undefined'],
		['a function', () => 1, 'function'],
		['a list', [1, 2], '[1,2]'],
		['an object', { wreck: 1 }, '{"wreck":1}'],
		['a Date', new Date(0), 'a Date'],
		['an Error', new Error('x'), 'an Error'],
		['a long string, cut short', 'x'.repeat(80), `"${'x'.repeat(56)}...`],
	])('shows %s as %p', (_case, value, shown) => {
		expect(describeValue(value)).toBe(shown);
	});

	it('still says something about a value JSON can\'t write', () => {
		const loop: Record<string, unknown> = {};
		loop.self = loop;

		expect(describeValue(loop)).toBe('[object Object]');
	});
});
