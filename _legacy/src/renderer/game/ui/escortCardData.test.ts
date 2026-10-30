import { DRIVER_CONFIGS } from '../mechanics/Driver';
import { ESCORT_CONFIGS, EscortType, convertToEscort, createEscort } from '../mechanics/Escort';
import { Vehicle } from '../mechanics/Vehicle';
import { escortCardData, escortCardDataOf, sameEscortCardData } from './escortCardData';

const TYPES = Object.keys(ESCORT_CONFIGS) as EscortType[];

/** The Road Warrior's rig with nobody aboard, as its driver's death leaves it. */
function emptyRig(): Vehicle {
	const { metadata, vehicleStats } = DRIVER_CONFIGS.road_warrior;
	return new Vehicle({
		name: metadata.vehicleName,
		armor: vehicleStats.armor,
		maxArmor: vehicleStats.armor,
		structure: vehicleStats.maxStructure,
		maxStructure: vehicleStats.maxStructure,
		baseSpeed: vehicleStats.speed,
		slot: null,
		flank: null,
		velocity: 0,
		driver: null,
		passenger: null,
		statusEffects: [],
	});
}

describe('escortCardData', () => {
	it('builds a fresh escort of a type from its config', () => {
		expect(escortCardData({ type: 'fuel_hauler' })).toEqual({
			name: 'Fuel Hauler',
			type: 'fuel_hauler',
			role: 'hauler',
			structure: 40,
			maxStructure: 40,
			armor: 5,
			speed: 2,
			gunnery: 1,
			evade: 1,
			ramming: 3,
			signatureCard: 'top_off',
			dividend: { kind: 'fuel', amount: 1 },
		});
	});

	it('takes what the caller\'s model says over the config, and copies the dividend rather than sharing the config\'s', () => {
		const data = escortCardData({ type: 'outrider', structure: 9, name: 'Outrider 2' });
		expect(data).toMatchObject({ name: 'Outrider 2', structure: 9, maxStructure: 25, signatureCard: 'run_ahead', dividend: null });
		const hauler = escortCardData({ type: 'med_truck' });
		expect(hauler.dividend).toEqual(ESCORT_CONFIGS.med_truck.dividend);
		expect(hauler.dividend).not.toBe(ESCORT_CONFIGS.med_truck.dividend);
		expect(escortCardData({ type: 'med_truck', signatureCard: 'top_off', dividend: null })).toMatchObject({ signatureCard: 'top_off', dividend: null });
	});

	it('maps a convoy escort as it stands between fights, its armor full and its structure what the fight left', () => {
		for (const type of TYPES) {
			const escort = createEscort({ type });
			escort.structure = 7;
			escort.armor = 0;
			expect(escortCardDataOf(escort)).toEqual({ ...escortCardData({ type }), structure: 7 });
		}
	});

	it('refuses a driven vehicle carrying on unmanned, which the convoy never holds', () => {
		const rig = emptyRig();
		convertToEscort(rig);
		expect(() => escortCardDataOf(rig)).toThrow('Apocalypse Rig isn\'t a hired escort with a signature card');
	});

	it('refuses a vehicle that isn\'t an escort', () => {
		expect(() => escortCardDataOf(emptyRig())).toThrow('Apocalypse Rig isn\'t an escort');
	});
});

describe('sameEscortCardData', () => {
	it('holds for equal data in new objects, a screen mapping its model afresh', () => {
		expect(sameEscortCardData(escortCardData({ type: 'med_truck' }), escortCardData({ type: 'med_truck' }))).toBe(true);
	});

	it('tells apart a change in anything the card or its view shows', () => {
		const base = escortCardData({ type: 'med_truck' });
		const changes = [
			{ name: 'Med Truck 2' },
			{ structure: 1 },
			{ maxStructure: 50 },
			{ armor: 0 },
			{ speed: 3 },
			{ gunnery: 9 },
			{ evade: 9 },
			{ ramming: 9 },
			{ signatureCard: 'top_off' },
			{ dividend: null },
			{ dividend: { kind: 'heal' as const, amount: 4 } },
			{ role: 'gun' as const },
		];
		for (const change of changes) {
			expect([change, sameEscortCardData(base, { ...base, ...change })]).toEqual([change, false]);
		}
		expect(sameEscortCardData(base, { ...base, type: 'fuel_hauler' })).toBe(false);
	});
});
