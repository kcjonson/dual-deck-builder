/**
 * @jest-environment jsdom
 */
import type { Component } from '../../engine/components/Component';
import { createTestContext } from '../../engine/components/testing';
import type { MountContext } from '../../engine/components/MountContext';
import { CombatModel } from '../screens/combat/CombatModel';
import { Team, TeamType } from '../mechanics/Team';
import { Vehicle as VehicleData, createDrivenVehicle } from '../mechanics/Vehicle';
import { createTestDriver } from '../ai/__tests__/test-helpers';
import { Vehicle } from './Vehicle';

function partById(plate: Component, id: string): Component {
	const part = plate.getChildren().find(child => child.id === id);
	if (!part) throw new Error(`no ${id}`);
	return part;
}

describe('Vehicle plate', () => {
	let rig: VehicleData;
	let team: Team;
	let plate: Vehicle;
	let context: MountContext;

	beforeEach(() => {
		rig = createDrivenVehicle({ driver: createTestDriver('Rig Driver'), name: 'Rig' });
		team = new Team({ type: TeamType.PLAYER, vehicles: [rig, createDrivenVehicle({ driver: createTestDriver('Bike Driver'), name: 'Bike' })] });
		plate = new Vehicle({ id: 'plate', x: 0, y: 0, width: 160, height: 120, vehicleData: rig });
		context = createTestContext();
	});

	test('a driven vehicle shows its driver and no SPENT chip', () => {
		expect(partById(plate, 'plate_driver_hp').isVisible()).toBe(true);
		expect(partById(plate, 'plate_spent_chip').isVisible()).toBe(false);
	});

	test('a vehicle whose driver died shows as a spent escort, with no driver row, and keeps its parts', () => {
		const partsBefore = [...plate.getChildren()];
		rig.driver?.takeDamage(100);
		team.handleDriverDeath(rig);

		plate.data = rig;

		expect(plate.getChildren()).toEqual(partsBefore);
		expect(partById(plate, 'plate_driver_hp').isVisible()).toBe(false);
		expect(partById(plate, 'plate_driver_name').isVisible()).toBe(false);
		expect(partById(plate, 'plate_spent_chip').isVisible()).toBe(true);

		rig.spent = false;
		plate.data = rig;

		expect(partById(plate, 'plate_spent_chip').isVisible()).toBe(false);
	});

	test('a resize moves and sizes the same parts in the layout phase instead of rebuilding them', () => {
		plate.mount(context);
		context.frame.layout();
		const partsBefore = [...plate.getChildren()];
		const portrait = partById(plate, 'plate_portrait');
		const track = partById(plate, 'plate_structure_track');
		expect(portrait.getHeight()).toBe(Math.floor(120 * 0.65));

		plate.setSize(200, 160);
		context.frame.layout();

		expect(plate.getChildren()).toEqual(partsBefore);
		expect(portrait.getWidth()).toBe(200);
		expect(portrait.getHeight()).toBe(Math.floor(160 * 0.65));
		expect(track.getY()).toBe(Math.floor(160 * 0.68));
		expect(track.getWidth()).toBe(Math.floor(200 * 0.8));
	});

	test('subscribes to the combat model while mounted, and again after a remount', () => {
		const model = new CombatModel();
		model.targetableVehicleIds = [rig.id];
		const targeted = new Vehicle({ id: 'target', x: 0, y: 0, width: 160, height: 120, vehicleData: rig, combatData: model });
		const border = (): unknown => partById(targeted, 'target_portrait').resolvedColors?.border;
		const resting = border();

		// Nothing hears the model before mount (R8.14)
		model.focusVehicle(rig.id);
		expect(border()).toEqual(resting);

		// Mount reads the state it missed
		targeted.mount(context);
		const focused = border();
		expect(focused).not.toEqual(resting);

		targeted.unmount();
		model.focusVehicle(null);
		targeted.mount(context);
		expect(border()).toEqual(resting);
		model.focusVehicle(rig.id);
		expect(border()).toEqual(focused);
	});
});
