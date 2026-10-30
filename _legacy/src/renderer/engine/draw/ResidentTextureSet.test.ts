import { ResidentTextureSet } from './ResidentTextureSet';

describe('ResidentTextureSet (R5.20)', () => {
	const body = { name: 'body' };
	const mono = { name: 'mono' };
	const art = { name: 'art' };
	const art2 = { name: 'art2' };

	it('puts resident textures on fixed units in the order given', () => {
		const set = new ResidentTextureSet({ units: 4, resident: [body, mono] });
		expect(set.slotOf(body)).toBe(0);
		expect(set.slotOf(mono)).toBe(1);
		expect(set.residentUnits).toBe(2);
		expect(set.dynamicUnits).toBe(2);
		expect(set.isResident(mono)).toBe(true);
		expect(set.isResident(art)).toBe(false);
	});

	it('binds a non-resident texture to the lowest free dynamic unit, once', () => {
		const set = new ResidentTextureSet({ units: 3, resident: [body] });
		expect(set.slotOf(art)).toBe(-1);
		expect(set.bind(art)).toBe(1);
		expect(set.bind(art)).toBe(1);
		expect(set.bind(art2)).toBe(2);
		expect(set.hasFreeUnit).toBe(false);
		expect(set.bind(mono)).toBe(-1);
	});

	it('releases dynamic units and leaves resident ones', () => {
		const set = new ResidentTextureSet({ units: 2, resident: [body] });
		set.bind(art);
		set.releaseDynamic();
		expect(set.bindings).toEqual([body, null]);
		expect(set.hasFreeUnit).toBe(true);
	});

	it('refuses a resident set larger than the unit count or listing a texture twice', () => {
		expect(() => new ResidentTextureSet({ units: 1, resident: [body, mono] })).toThrow(/do not fit/);
		expect(() => new ResidentTextureSet({ units: 3, resident: [body, body] })).toThrow(/twice/);
		expect(() => new ResidentTextureSet({ units: 0 })).toThrow(/positive integer/);
	});

	it('replaces the resident set between frames and drops dynamic bindings with it', () => {
		const set = new ResidentTextureSet({ units: 3, resident: [body] });
		set.bind(art);
		set.resident = [mono, body];
		expect(set.bindings).toEqual([mono, body, null]);
		expect(set.resident).toEqual([mono, body]);
	});
});
