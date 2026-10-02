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
import { layoutLint } from '../../engine/debug/layoutLint';
import { treeSnapshot } from '../../engine/debug/treeSnapshot';

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
		// Nothing measures here, so the structure row is the track's 10: the
		// armor row (16) and three 2 px gaps under the portrait.
		expect(plate.portraitRect.height).toBe(120 - 16 - 10 - 2 * 3);

		plate.setSize(200, 160);
		context.frame.layout();

		expect(plate.getChildren()).toEqual(partsBefore);
		expect(plate.portraitRect.width).toBe(200);
		expect(plate.portraitRect.height).toBe(160 - 16 - 10 - 2 * 3);
		expect(plate.structureTrackRect.y).toBe(160 - 16 - 10 - 2 * 2);
		expect(plate.structureTrackRect.width).toBe(200 - 6 * 2);
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
		const border = (): unknown => targeted.resolvedColors.border;
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

describe('Vehicle plate layout lint (DDB-91)', () => {
	// The plate sizes the battlefield gives at 1440x882 and at the 0.8 floor
	it.each([[160, 198], [160, 185], [140, 104], [140, 97]])('lints clean at %ix%i, driven and as an escort', (width, height) => {
		const context = createTestContext({ draw: createMeasuringDrawApi().api });
		const driven = createDrivenVehicle({ driver: createTestDriver('Wasteland Raider'), name: 'Rust Buggy' });
		const plate = new Vehicle({ id: 'plate', x: 0, y: 0, width, height, vehicleData: driven });
		plate.mount(context);
		context.frame.layout();
		const lint = (): unknown[] => layoutLint(treeSnapshot([plate], { width, height })).violations;
		expect(lint()).toEqual([]);

		const team = new Team({ type: TeamType.PLAYER, vehicles: [driven, createDrivenVehicle({ driver: createTestDriver('Other'), name: 'Other' })] });
		driven.driver?.takeDamage(100);
		team.handleDriverDeath(driven);
		plate.data = driven;
		context.frame.layout();
		expect(lint()).toEqual([]);
	});

	it('draws its portrait panel and structure bar itself, with the value beside the bar', () => {
		const context = createTestContext({ draw: createMeasuringDrawApi().api });
		const rig = createDrivenVehicle({ driver: createTestDriver('Rig Driver'), name: 'Rig' });
		const plate = new Vehicle({ id: 'plate', x: 0, y: 0, width: 160, height: 198, vehicleData: rig });
		plate.mount(context);
		context.frame.layout();
		const ids = plate.getChildren().map((child) => child.id);
		expect(ids).not.toContain('plate_portrait');
		expect(ids).not.toContain('plate_structure_track');
		const value = plate.getChildren().find((child) => child.id === 'plate_structure_value');
		const track = plate.structureTrackRect;
		expect(value).toBeDefined();
		expect((value?.y ?? 0) + (value?.height ?? 0) / 2).toBeCloseTo(track.y + track.height / 2, 5);
		expect(value?.x ?? 0).toBeGreaterThan(track.x + track.width);
	});
});
