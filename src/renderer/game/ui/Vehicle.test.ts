/**
 * @jest-environment jsdom
 */
import { Layer } from '../../engine/components/Layer';
import { Team, TeamType } from '../mechanics/Team';
import { Vehicle as VehicleData, createDrivenVehicle } from '../mechanics/Vehicle';
import { createTestDriver } from '../ai/__tests__/test-helpers';
import { Vehicle } from './Vehicle';

const partById = (plate: Layer, id: string): Layer | undefined =>
	plate.getChildren().find(child => child.id === id);

describe('Vehicle plate', () => {
	let rig: VehicleData;
	let team: Team;
	let plate: Vehicle;

	beforeEach(() => {
		rig = createDrivenVehicle({ driver: createTestDriver('Rig Driver'), name: 'Rig' });
		team = new Team({ type: TeamType.PLAYER, vehicles: [rig, createDrivenVehicle({ driver: createTestDriver('Bike Driver'), name: 'Bike' })] });
		plate = new Vehicle({ id: 'plate', x: 0, y: 0, width: 160, height: 120, vehicleData: rig });
	});

	test('a driven vehicle shows its driver and no SPENT chip', () => {
		expect(partById(plate, 'plate_driver_hp')).toBeDefined();
		expect(partById(plate, 'plate_spent_chip')).toBeUndefined();
	});

	test('a vehicle whose driver died redraws as a spent escort, with no driver row', () => {
		rig.driver?.takeDamage(100);
		team.handleDriverDeath(rig);

		plate.data = rig;

		expect(partById(plate, 'plate_driver_hp')).toBeUndefined();
		expect(partById(plate, 'plate_driver_name')).toBeUndefined();
		expect(partById(plate, 'plate_spent_chip')?.isVisible()).toBe(true);

		rig.spent = false;
		plate.data = rig;

		expect(partById(plate, 'plate_spent_chip')?.isVisible()).toBe(false);
	});
});
