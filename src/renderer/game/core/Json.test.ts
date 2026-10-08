import { runInNewContext } from 'vm';
import { JsonObject, copyJson, describeValue } from './Json';

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

	it('lists every problem instead when given a list, and copies the rest', () => {
		const problems: string[] = [];
		const copy = copyJson({ wreck: NaN, hazard: [undefined], raider: { ambush: Infinity }, find: 2 }, 'stopTables', problems);
		expect(problems).toEqual([
			'stopTables.wreck must be a finite number, got NaN',
			`stopTables.hazard[0] ${NOT_JSON}, got undefined`,
			'stopTables.raider.ambush must be a finite number, got Infinity',
		]);
		expect(copy).toMatchObject({ find: 2 });
	});
});

describe('describeValue', () => {
	it.each([
		['a string', 'x', '"x"'],
		['a number', 2.5, '2.5'],
		['NaN', NaN, 'NaN'],
		['null', null, 'null'],
		['undefined', undefined, 'undefined'],
		['a list', [1, 2], '[1,2]'],
		['an object', { wreck: 1 }, '{"wreck":1}'],
		['a Date', new Date(0), 'a Date'],
		['an Error', new Error('x'), 'an Error'],
		['a long string, cut short', 'x'.repeat(80), `"${'x'.repeat(56)}...`],
	])('shows %s as %p', (_case, value, shown) => {
		expect(describeValue(value)).toBe(shown);
	});
});
