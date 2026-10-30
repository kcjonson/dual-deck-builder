import { createTestDriver } from '../ai/__tests__/test-helpers';
import { ReaderRangeError } from '../core/JsonReader';
import { Convoy } from '../mechanics/Convoy';
import { ESCORT_CONFIGS, EscortType, createEscort } from '../mechanics/Escort';
import { RoadLane, RoadRow } from '../mechanics/Road';
import { Vehicle } from '../mechanics/Vehicle';
import { ConvoyJson, EscortJson, convoyToJson, escortToJson, readConvoy } from './ConvoyJson';

/** The convoy's JSON through JSON text and back, as a save does it. */
const throughText = (convoy: Convoy): unknown => JSON.parse(JSON.stringify(convoyToJson(convoy)));

/** A convoy of these types, as JSON to damage. */
const convoyJson = (...types: EscortType[]): ConvoyJson => convoyToJson(new Convoy({ escorts: types.map(type => createEscort({ type })) }));

describe('the convoy in a save', () => {
	it('keeps escorts in roster order, with their ids, damage, and mods, and the counter the ids come from', () => {
		const hauler = createEscort({ type: 'fuel_hauler' });
		hauler.set({ structure: 31, mods: [{ name: 'Reinforced Tank', kind: 'defense' }] });
		const outrider = createEscort({ type: 'outrider' });
		const convoy = new Convoy({ escorts: [hauler, outrider] });

		const loaded = readConvoy(throughText(convoy), 'convoy');

		expect(loaded.escorts.map(escort => [escort.name, escort.convoyId])).toEqual([['Fuel Hauler', 'escort-1'], ['Outrider', 'escort-2']]);
		expect(loaded.nextEscortNumber).toBe(3);
		expect(loaded.escorts[0].structure).toBe(31);
		expect(loaded.escorts[0].mods).toEqual([{ name: 'Reinforced Tank', kind: 'defense' }]);
		expect(convoyToJson(loaded)).toEqual(convoyToJson(convoy));
	});

	it.each(Object.keys(ESCORT_CONFIGS) as EscortType[])('reads back the %s stat block createEscort makes', (type) => {
		const escort = createEscort({ type });
		const convoy = new Convoy({ escorts: [escort] });

		const [loaded] = readConvoy(throughText(convoy), 'convoy').escorts;

		expect(loaded.escort).toEqual(escort.escort);
		expect([loaded.armor, loaded.maxArmor, loaded.structure, loaded.maxStructure, loaded.baseSpeed])
			.toEqual([escort.armor, escort.maxArmor, escort.structure, escort.maxStructure, escort.baseSpeed]);
	});

	it('refuses an escort with no type: a driven vehicle that carried on unmanned is its driver\'s, never the convoy\'s', () => {
		const json = convoyJson('fuel_hauler');
		(json.escorts[0].escort as { type: string | null }).type = null;

		expect(() => readConvoy(json, 'convoy')).toThrow('convoy.escorts[0].escort.type must be a string, got null');
	});

	it('refuses more escorts than a convoy holds, as a damaged save rather than a bug', () => {
		const json = convoyJson('outrider', 'pilot_car', 'fuel_hauler', 'med_truck');
		json.escorts.push({ ...json.escorts[0], id: 'escort-5' });
		json.nextEscortNumber = 6;

		expect(() => readConvoy(json, 'convoy')).toThrow(ReaderRangeError);
		expect(() => readConvoy(json, 'convoy')).toThrow('convoy.escorts holds 5 escorts, and a convoy holds 4 at most');
	});

	it.each([
		['the counter at an id it has already handed out', (json: ConvoyJson) => { json.nextEscortNumber = 2; }, 'convoy.escorts[1].id must come before escort-2, the next id to hand out, got escort-2'],
		['two escorts with one id', (json: ConvoyJson) => { json.escorts[1].id = 'escort-1'; }, 'convoy.escorts[1].id escort-1 belongs to an earlier escort'],
		['an id that isn\'t escort-<n>', (json: ConvoyJson) => { json.escorts[0].id = 'escort-0'; }, 'convoy.escorts[0].id must look like escort-1, got "escort-0"']
	])('refuses %s, so a load never hands an id out twice', (_label, damage, message) => {
		const json = convoyJson('fuel_hauler', 'outrider');
		damage(json);

		expect(() => readConvoy(json, 'convoy')).toThrow(ReaderRangeError);
		expect(() => readConvoy(json, 'convoy')).toThrow(message);
	});

	it('leaves a fight\'s state behind: a loaded escort is off the road, empty, and ready', () => {
		const truck = createEscort({ type: 'med_truck' });
		const convoy = new Convoy({ escorts: [truck] });
		truck.set({
			slot: { lane: RoadLane.PLAYER_OUTSIDE, row: RoadRow.BEHIND },
			statusEffects: [{ name: 'oil_slick', duration: 2 }],
			shield: 4,
			spent: true
		});
		truck.addPassenger(createTestDriver('Passenger'));

		const [loaded] = readConvoy(throughText(convoy), 'convoy').escorts;

		expect(loaded.slot).toBeNull();
		expect(loaded.flank).toBeNull();
		expect(loaded.statusEffects).toEqual([]);
		expect(loaded.shield ?? 0).toBe(0);
		expect(loaded.passenger).toBeNull();
		expect(loaded.driver).toBeNull();
		expect(loaded.isReady).toBe(true);
	});

	it.each([
		['armor over max', (json: EscortJson) => { json.armor = 6; }, 'convoy.escorts[0].armor must be an integer from 0 to maxArmor (5), got 6'],
		['structure over max', (json: EscortJson) => { json.structure = 41; }, 'convoy.escorts[0].structure must be an integer from 1 to maxStructure (40), got 41'],
		['no structure left, a wreck the convoy never keeps', (json: EscortJson) => { json.structure = 0; }, 'convoy.escorts[0].structure must be an integer from 1 to maxStructure (40), got 0'],
		['no max structure', (json: EscortJson) => { json.maxStructure = 0; }, 'convoy.escorts[0].maxStructure must be an integer >= 1, got 0'],
		['an unknown type', (json: EscortJson) => { (json.escort as { type: string }).type = 'tank'; }, 'convoy.escorts[0].escort.type must be one of outrider, pilot_car, fuel_hauler, med_truck, got "tank"'],
		['an unknown role', (json: EscortJson) => { (json.escort as { role: string }).role = 'scout'; }, 'convoy.escorts[0].escort.role must be one of gun, hauler, got "scout"'],
		['a shoulder for a preferred slot', (json: EscortJson) => { (json.escort.preferredSlot as { lane: string }).lane = 'shoulder'; }, 'convoy.escorts[0].escort.preferredSlot.lane must be one of inside, outside, got "shoulder"'],
		['a signature card that isn\'t a card type', (json: EscortJson) => { json.escort.signatureCard = 'Top Off'; }, 'convoy.escorts[0].escort.signatureCard must be a card type in lower snake case, got "Top Off"'],
		['an unknown dividend', (json: EscortJson) => { json.escort.dividend = { kind: 'water' as 'fuel', amount: 1 }; }, 'convoy.escorts[0].escort.dividend.kind must be one of fuel, scrap, heal, got "water"'],
		['an unknown mod kind', (json: EscortJson) => { json.mods = [{ name: 'Spikes', kind: 'melee' as 'offense' }]; }, 'convoy.escorts[0].mods[0].kind must be one of offense, defense, utility, got "melee"'],
		['a set piece flag', (json: EscortJson) => { (json.escort as unknown as Record<string, unknown>).setPiece = true; }, 'convoy.escorts[0].escort has an unknown field "setPiece"'],
		['its id in the profile', (json: EscortJson) => { (json.escort as unknown as Record<string, unknown>).id = json.id; }, 'convoy.escorts[0].escort has an unknown field "id"'],
		['a saved slot', (json: EscortJson) => { (json as unknown as Record<string, unknown>).slot = null; }, 'convoy.escorts[0] has an unknown field "slot"']
	])('rejects an escort with %s', (_label, damage, message) => {
		const json = convoyJson('fuel_hauler');
		damage(json.escorts[0]);

		expect(() => readConvoy(json, 'convoy')).toThrow(message);
	});

	it('only writes escorts that have joined a convoy', () => {
		const rig = new Vehicle({
			name: 'Apocalypse Rig',
			armor: 10,
			maxArmor: 10,
			structure: 80,
			maxStructure: 80,
			baseSpeed: 1,
			slot: null,
			flank: null,
			velocity: 0,
			driver: createTestDriver('Road Warrior'),
			passenger: null,
			statusEffects: []
		});

		expect(() => escortToJson(rig)).toThrow('Apocalypse Rig is not an escort');
		expect(() => escortToJson(createEscort({ type: 'outrider' }))).toThrow('Outrider has no id, so it hasn\'t joined a convoy');
	});

	it('rejects a convoy that isn\'t an object with a list of escorts', () => {
		expect(() => readConvoy([], 'convoy')).toThrow('convoy must be an object, got []');
		expect(() => readConvoy({ nextEscortNumber: 1, escorts: {} }, 'convoy')).toThrow('convoy.escorts must be an array, got {}');
	});
});
