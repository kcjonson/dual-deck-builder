/**
 * @jest-environment jsdom
 */
import type { Component } from '../../engine/components/Component';
import { createTestContext } from '../../engine/components/testing';
import { createMeasuringDrawApi } from '../../engine/text/testing';
import { tokens } from '../../engine/theme/tokens';
import { renderTree } from '../../engine/components/renderTree';
import type { TextCommand } from '../../engine/draw';
import type { Text } from '../../engine/components/Text';
import { ICON_ATLAS_ROLE } from '../../engine/text/fontFaces';
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
		// Nothing measures here, so the structure row is the track's 10: the
		// armor row (16) and three 2 px gaps under the portrait.
		expect(portrait.getHeight()).toBe(120 - 16 - 10 - 2 * 3);

		plate.setSize(200, 160);
		context.frame.layout();

		expect(plate.getChildren()).toEqual(partsBefore);
		expect(portrait.getWidth()).toBe(200);
		expect(portrait.getHeight()).toBe(160 - 16 - 10 - 2 * 3);
		expect(track.getY()).toBe(160 - 16 - 10 - 2 * 2);
		expect(track.getWidth()).toBe(200 - 6 * 2);
	});

	test('sets every run on the token scale and keeps the rows apart on the smallest plate (R6.4a)', () => {
		const { api, backend } = createMeasuringDrawApi();
		const measuring = createTestContext({ draw: api });
		// An enemy plate on the combat stage, the smallest the game draws
		const enemy = new Vehicle({ id: 'enemy', x: 0, y: 0, width: 140, height: 91, vehicleData: rig });
		enemy.mount(measuring);
		measuring.frame.layout();
		api.beginFrame({ viewport: { width: 400, height: 200 } });
		renderTree(enemy, api);
		api.endFrame();

		// The badge's shield is an icon glyph, not text
		const runs = backend.commands.filter((command): command is TextCommand => command.kind === 'text' && command.font !== ICON_ATLAS_ROLE);
		// Driver name, HP, vehicle name, structure value, and the armor badge's value
		expect(runs.map(run => run.text)).toEqual(['Rig Driver', `HP: ${rig.driver?.hitpoints}/${rig.driver?.maxHitpoints}`, 'Rig', `${rig.structure}/${rig.maxStructure}`, `${rig.armor}`]);
		for (const run of runs) expect(run.size).toBe(tokens.fontSize.fs_xs);

		// Each line inside the plate, and no two lines sharing a row of pixels
		// unless they sit side by side
		const lines = runs.map(run => {
			const box = run.box ?? { x: NaN, y: NaN, width: NaN, height: NaN };
			return { x: box.x + run.transform[4], y: box.y + run.transform[5], width: box.width, height: box.height };
		});
		for (const line of lines) {
			expect(line.y).toBeGreaterThanOrEqual(0);
			expect(line.y + line.height).toBeLessThanOrEqual(91);
			expect(line.x + line.width).toBeLessThanOrEqual(140);
		}
		lines.forEach((line, index) => {
			for (const other of lines.slice(index + 1)) {
				const sameRows = line.y < other.y + other.height && other.y < line.y + line.height;
				const sameColumns = line.x < other.x + other.width && other.x < line.x + line.width;
				expect(sameRows && sameColumns).toBe(false);
			}
		});
	});

	test('cuts names too long for the smallest plate with an ellipsis, inside the plate', () => {
		const { api, backend } = createMeasuringDrawApi();
		const measuring = createTestContext({ draw: api });
		const long = createDrivenVehicle({ driver: createTestDriver('THE ROAD WARRIOR OF THE WASTELAND'), name: 'Apocalypse Rig Mark Seven Deluxe' });
		const enemy = new Vehicle({ id: 'enemy', x: 0, y: 0, width: 140, height: 91, vehicleData: long });
		enemy.mount(measuring);
		measuring.frame.layout();
		api.beginFrame({ viewport: { width: 400, height: 200 } });
		renderTree(enemy, api);
		api.endFrame();

		for (const id of ['enemy_driver_name', 'enemy_name']) {
			const text = partById(enemy, id) as Text;
			expect(text.overflowOutcome).toBe('ellipsis');
			const run = backend.commands.find((command): command is TextCommand => command.kind === 'text' && command.id === id);
			if (!run?.box) throw new Error(`no run for ${id}`);
			expect(run.box.x + run.transform[4] + run.box.width).toBeLessThanOrEqual(140);
			expect(text.inkRect.x + text.getX() + text.inkRect.width).toBeLessThanOrEqual(140);
		}
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
