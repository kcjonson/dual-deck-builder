import { createTestDriver } from '../ai/__tests__/test-helpers';
import { Convoy } from '../mechanics/Convoy';
import { ESCORT_CONFIGS, EscortType, convertToEscort, createEscort } from '../mechanics/Escort';
import { RoadLane, RoadRow } from '../mechanics/Road';
import { Vehicle } from '../mechanics/Vehicle';
import { EscortJson, convoyToJson, escortToJson, readConvoy, readEscort } from './ConvoyJson';

/** The convoy's JSON through JSON text and back, as a save does it. */
const throughText = (convoy: Convoy): unknown => JSON.parse(JSON.stringify(convoyToJson(convoy)));

/** A driven vehicle whose driver died with nobody to take the wheel, carrying on as an escort, off the road again. */
function unmannedBike(): Vehicle {
	const bike = new Vehicle({
		name: 'Lightning Bike',
		armor: 0,
		maxArmor: 0,
		structure: 22,
		maxStructure: 50,
		baseSpeed: 5,
		slot: { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.BEHIND },
		flank: null,
		velocity: 0,
		driver: null,
		passenger: null,
		statusEffects: []
	});
	convertToEscort(bike);
	bike.leaveRoad();
	return bike;
}

describe('the convoy in a save', () => {
	it('keeps escorts in roster order, with their damage and mods', () => {
		const hauler = createEscort({ type: 'fuel_hauler' });
		hauler.set({ structure: 31, mods: [{ name: 'Reinforced Tank', kind: 'defense' }] });
		const outrider = createEscort({ type: 'outrider' });
		const convoy = new Convoy({ escorts: [hauler, outrider] });

		const loaded = readConvoy(throughText(convoy), 'convoy');

		expect(loaded.escorts.map(escort => escort.name)).toEqual(['Fuel Hauler', 'Outrider']);
		expect(loaded.escorts[0].structure).toBe(31);
		expect(loaded.escorts[0].mods).toEqual([{ name: 'Reinforced Tank', kind: 'defense' }]);
		expect(convoyToJson(loaded)).toEqual(convoyToJson(convoy));
	});

	it.each(Object.keys(ESCORT_CONFIGS) as EscortType[])('reads back the %s stat block createEscort makes', (type) => {
		const escort = createEscort({ type });

		const loaded = readEscort(JSON.parse(JSON.stringify(escortToJson(escort))), 'escort');

		expect(loaded.escort).toEqual(escort.escort);
		expect([loaded.armor, loaded.maxArmor, loaded.structure, loaded.maxStructure, loaded.baseSpeed])
			.toEqual([escort.armor, escort.maxArmor, escort.structure, escort.maxStructure, escort.baseSpeed]);
	});

	it('keeps a driven vehicle that carried on unmanned, which has no type to look its stats up by', () => {
		const convoy = new Convoy({ escorts: [unmannedBike()] });

		const [bike] = readConvoy(throughText(convoy), 'convoy').escorts;

		expect(bike.escort).toEqual({
			type: null,
			role: 'gun',
			gunnery: 4,
			evade: 3,
			ramming: 2,
			preferredSlot: { lane: 'inside', row: RoadRow.BEHIND },
			signatureCard: null,
			dividend: null,
			setPiece: false
		});
		expect([bike.name, bike.structure, bike.maxStructure, bike.baseSpeed]).toEqual(['Lightning Bike', 22, 50, 5]);
	});

	it('leaves a fight\'s state behind: a loaded escort is off the road, empty, and ready', () => {
		const truck = createEscort({ type: 'med_truck' });
		truck.set({
			slot: { lane: RoadLane.PLAYER_OUTSIDE, row: RoadRow.BEHIND },
			statusEffects: [{ name: 'oil_slick', duration: 2 }],
			shield: 4,
			spent: true
		});
		truck.addPassenger(createTestDriver('Passenger'));

		const loaded = readEscort(JSON.parse(JSON.stringify(escortToJson(truck))), 'escort');

		expect(loaded.slot).toBeNull();
		expect(loaded.flank).toBeNull();
		expect(loaded.statusEffects).toEqual([]);
		expect(loaded.shield ?? 0).toBe(0);
		expect(loaded.passenger).toBeNull();
		expect(loaded.driver).toBeNull();
		expect(loaded.isReady).toBe(true);
	});

	it.each([
		['armor over max', (json: EscortJson) => { json.armor = 6; }, 'convoy[0].armor must be an integer from 0 to maxArmor (5), got 6'],
		['structure over max', (json: EscortJson) => { json.structure = 41; }, 'convoy[0].structure must be an integer from 1 to maxStructure (40), got 41'],
		['no structure left, a wreck the convoy never keeps', (json: EscortJson) => { json.structure = 0; }, 'convoy[0].structure must be an integer from 1 to maxStructure (40), got 0'],
		['no max structure', (json: EscortJson) => { json.maxStructure = 0; }, 'convoy[0].maxStructure must be an integer >= 1, got 0'],
		['an unknown type', (json: EscortJson) => { (json.escort as { type: string }).type = 'tank'; }, 'convoy[0].escort.type must be one of outrider, pilot_car, fuel_hauler, med_truck, got "tank"'],
		['an unknown role', (json: EscortJson) => { (json.escort as { role: string }).role = 'scout'; }, 'convoy[0].escort.role must be one of gun, hauler, got "scout"'],
		['a shoulder for a preferred slot', (json: EscortJson) => { (json.escort.preferredSlot as { lane: string }).lane = 'shoulder'; }, 'convoy[0].escort.preferredSlot.lane must be one of inside, outside, got "shoulder"'],
		['a signature card that isn\'t a card type', (json: EscortJson) => { json.escort.signatureCard = 'Top Off'; }, 'convoy[0].escort.signatureCard must be a card type in lower snake case, got "Top Off"'],
		['an unknown dividend', (json: EscortJson) => { json.escort.dividend = { kind: 'water' as 'fuel', amount: 1 }; }, 'convoy[0].escort.dividend.kind must be one of fuel, scrap, heal, got "water"'],
		['an unknown mod kind', (json: EscortJson) => { json.mods = [{ name: 'Spikes', kind: 'melee' as 'offense' }]; }, 'convoy[0].mods[0].kind must be one of offense, defense, utility, got "melee"'],
		['a set piece flag', (json: EscortJson) => { (json.escort as unknown as Record<string, unknown>).setPiece = true; }, 'convoy[0].escort has an unknown field "setPiece"'],
		['a saved slot', (json: EscortJson) => { (json as unknown as Record<string, unknown>).slot = null; }, 'convoy[0] has an unknown field "slot"']
	])('rejects an escort with %s', (_label, damage, message) => {
		const json = convoyToJson(new Convoy({ escorts: [createEscort({ type: 'fuel_hauler' })] }));
		damage(json[0]);

		expect(() => readConvoy(json, 'convoy')).toThrow(message);
	});

	it('only writes escorts', () => {
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
	});

	it('rejects a convoy that isn\'t a list', () => {
		expect(() => readConvoy({}, 'convoy')).toThrow('convoy must be an array, got {}');
	});
});
