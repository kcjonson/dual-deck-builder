import { copyJson, describeValue, freezeJson, readFields } from './JsonReader';

describe('JsonReader', () => {
	describe('describeValue', () => {
		it.each([
			['a string', 'sleeping', '"sleeping"'],
			['undefined', undefined, 'undefined'],
			['NaN', NaN, 'NaN'],
			['a function', () => 1, 'function'],
			['an object', { escorts: [] }, '{"escorts":[]}']
		])('shows %s as an error message would', (_label, value, shown) => {
			expect(describeValue(value)).toBe(shown);
		});

		it('cuts a long value short', () => {
			const shown = describeValue('x'.repeat(100));

			expect(shown).toHaveLength(60);
			expect(shown.endsWith('...')).toBe(true);
		});

		it('still says something about a value JSON can\'t write', () => {
			const loop: Record<string, unknown> = {};
			loop.self = loop;

			expect(describeValue(loop)).toBe('[object Object]');
		});
	});

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
		});
	});

	it('copyJson hands out a copy that can change without touching the original', () => {
		const frozen = freezeJson({ roads: [{ id: 'r1' }] }, 'map');
		const copy = copyJson(frozen) as { roads: { id: string }[] };

		copy.roads[0].id = 'r2';

		expect(frozen).toEqual({ roads: [{ id: 'r1' }] });
	});

	it('readFields refuses a field it doesn\'t know, and one that\'s missing', () => {
		expect(() => readFields({ a: 1 }, 'thing', ['a', 'b'])).toThrow('thing.b is missing');
		expect(() => readFields({ a: 1, c: 2 }, 'thing', ['a', 'b'])).toThrow('thing has an unknown field "c"');
	});
});
