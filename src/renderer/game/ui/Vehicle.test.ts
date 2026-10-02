/**
 * @jest-environment jsdom
 */
import type { AnyUiEvent } from '../../engine/input/events';
import { createTestContext } from '../../engine/components/testing';
import { createMeasuringDrawApi } from '../../engine/text/testing';
import { renderTree } from '../../engine/components/renderTree';
import type { PolygonCommand, TextCommand } from '../../engine/draw';
import type { Text } from '../../engine/components/Text';
import { ICON_ATLAS_ROLE } from '../../engine/text/fontFaces';
import type { MountContext } from '../../engine/components/MountContext';
import { CombatModel } from '../screens/combat/CombatModel';
import { Team, TeamType } from '../mechanics/Team';
import { Vehicle as VehicleData, createDrivenVehicle } from '../mechanics/Vehicle';
import { createEscort } from '../mechanics/Escort';
import { createTestDriver } from '../ai/__tests__/test-helpers';
import { TOKEN_HEIGHT, TOKEN_PASSENGER_HEIGHT, TOKEN_WIDTH, Vehicle, slotScale } from './Vehicle';
import type { StatusChip } from './StatusChip';
import { layoutLint } from '../../engine/debug/layoutLint';
import { treeSnapshot } from '../../engine/debug/treeSnapshot';

function part<T = Text>(token: Vehicle, suffix: string): T {
	const found = token.children.find(child => child.id === `${token.id}_${suffix}`);
	if (!found) throw new Error(`no ${suffix}`);
	return found as unknown as T;
}

function chips(token: Vehicle): StatusChip[] {
	return token.children.filter(child => child.id?.includes('_status_') && child.visible) as unknown as StatusChip[];
}

function measured(): { context: MountContext; api: ReturnType<typeof createMeasuringDrawApi>['api']; backend: ReturnType<typeof createMeasuringDrawApi>['backend'] } {
	const { api, backend } = createMeasuringDrawApi();
	return { context: createTestContext({ draw: api }), api, backend };
}

function lintOf(token: Vehicle, context: MountContext): unknown[] {
	token.mount(context);
	context.frame.layout();
	return layoutLint(treeSnapshot([token], { width: 400, height: 300 })).violations;
}

const seats = (vehicle: VehicleData) => (driver: unknown) => (driver === vehicle.driver ? 1 : 2) as 1 | 2;

describe('Vehicle token geometry', () => {
	let rig: VehicleData;

	beforeEach(() => {
		rig = createDrivenVehicle({ driver: createTestDriver('Rig Driver'), name: 'Rig' });
	});

	test('is 196x117, and 135 with a passenger aboard', () => {
		const token = new Vehicle({ id: 'token', vehicleData: rig });
		expect([token.width, token.height]).toEqual([TOKEN_WIDTH, TOKEN_HEIGHT]);
		expect(token.plateRect).toEqual({ x: 64, y: 26, width: 132, height: 68 });

		rig.passenger = createTestDriver('Rider');
		token.data = rig;
		expect(token.height).toBe(TOKEN_PASSENGER_HEIGHT);
		expect(token.plateRect.height).toBe(86);
		expect(part(token, 'passenger_hp').visible).toBe(true);
	});

	test('gives structure and the driver\'s HP bars of the same width', () => {
		const token = new Vehicle({ id: 'token', vehicleData: rig });
		expect(token.hpTrackRect.width).toBe(token.structureTrackRect.width);
		expect(token.hpTrackRect.x).toBe(token.structureTrackRect.x);
		expect(token.hpTrackRect.height).toBeGreaterThanOrEqual(14);
	});

	test('scales x1 to x1.25 to fill a slot and centres in it, never below x1', () => {
		const token = new Vehicle({ id: 'token', vehicleData: rig });
		expect(token.fitToSlot({ x: 10, y: 20, width: 205, height: 141 })).toBe(true);
		const scale = Math.min((205 - 6) / 196, (141 - 4) / 117);
		expect(token.tokenScale).toBeCloseTo(scale, 5);
		expect(token.x).toBeCloseTo(10 + (205 - 196 * scale) / 2, 5);

		token.fitToSlot({ x: 0, y: 0, width: 400, height: 400 });
		expect(token.tokenScale).toBe(1.25);

		expect(token.fitToSlot({ x: 0, y: 0, width: 150, height: 100 })).toBe(false);
		expect(token.tokenScale).toBe(1);

		// One scale for the whole road, still held to x1 to x1.25
		token.fitToSlot({ x: 0, y: 0, width: 300, height: 300 }, 1.1);
		expect(token.tokenScale).toBe(1.1);
		expect(slotScale({ width: 202, height: 121 })).toBeCloseTo(1, 5);
		expect(slotScale({ width: 202, height: 121, tokenHeight: TOKEN_PASSENGER_HEIGHT })).toBeLessThan(1);

		// A road-wide scale a passenger's taller token can't take shrinks to its slot
		const rider = createDrivenVehicle({ driver: createTestDriver('Rider Driver'), name: 'Rider' });
		rider.passenger = createTestDriver('Passenger');
		const tall = new Vehicle({ id: 'tall', vehicleData: rider });
		tall.fitToSlot({ x: 0, y: 0, width: 260, height: 160 }, 1.25);
		expect(tall.tokenScale).toBeCloseTo((160 - 4) / 135, 5);
	});

	test('refits to its slot when a passenger joins, and reuses its transform every call', () => {
		const token = new Vehicle({ id: 'token', vehicleData: rig });
		token.fitToSlot({ x: 0, y: 0, width: 260, height: 160 });
		const transform = token.transform;
		token.fitToSlot({ x: 0, y: 0, width: 260, height: 160 });
		expect(token.transform).toBe(transform);
		const alone = token.tokenScale;

		rig.passenger = createTestDriver('Rider');
		token.data = rig;
		expect(token.tokenScale).toBeLessThan(alone);
		expect(token.tokenScale).toBeCloseTo((160 - 4) / 135, 5);
	});
});

describe('Vehicle token content', () => {
	test('marks the plate with its driver\'s seat, an escort with its square, and a raider not at all', () => {
		const rig = createDrivenVehicle({ driver: createTestDriver('Rig Driver'), name: 'Rig' });
		expect(new Vehicle({ id: 'a', vehicleData: rig, seatOf: () => 1 }).mark).toBe('driver1');
		expect(new Vehicle({ id: 'b', vehicleData: rig, seatOf: () => 2 }).mark).toBe('driver2');
		expect(new Vehicle({ id: 'c', vehicleData: createEscort({ type: 'outrider' }) }).mark).toBe('escort');
		expect(new Vehicle({ id: 'd', vehicleData: rig, side: 'raider', seatOf: () => 1 }).mark).toBeNull();
	});

	test('an escort has no driver HP row, and SPENT leads its statuses once it has acted', () => {
		const escort = createEscort({ type: 'outrider' });
		escort.spent = true;
		escort.applyStatusEffect({ name: 'vulnerable', duration: 2 });
		const token = new Vehicle({ id: 'token', vehicleData: escort });
		expect(part(token, 'driver_hp').visible).toBe(false);
		expect(token.height).toBe(TOKEN_HEIGHT);
		const [first, second] = chips(token);
		expect(first.chip).toMatchObject({ kind: 'label', text: 'SPENT' });
		expect(second.chip).toMatchObject({ kind: 'status', icon: 'gpp_bad', count: 2 });
	});

	test('a driver who dies leaves a player vehicle as an escort, with the same parts', () => {
		const rig = createDrivenVehicle({ driver: createTestDriver('Rig Driver'), name: 'Rig' });
		const team = new Team({ type: TeamType.PLAYER, vehicles: [rig, createDrivenVehicle({ driver: createTestDriver('Bike Driver'), name: 'Bike' })] });
		const token = new Vehicle({ id: 'token', vehicleData: rig });
		const partsBefore = [...token.children];
		rig.driver?.takeDamage(100);
		team.handleDriverDeath(rig);
		token.data = rig;
		expect(token.children).toEqual(partsBefore);
		expect(part(token, 'driver_hp').visible).toBe(false);
		expect(chips(token)[0].chip).toMatchObject({ kind: 'label', text: 'SPENT' });
	});

	test('shows five chips whole, and past five keeps four and a +N naming the rest', () => {
		const rig = createDrivenVehicle({ driver: createTestDriver('Rig Driver'), name: 'Rig' });
		const names = ['vulnerable', 'burn', 'stunned', 'speed_reduction', 'death_mark'];
		rig.statusEffects = names.map(name => ({ name, duration: 1 }));
		const token = new Vehicle({ id: 'token', vehicleData: rig });
		expect(chips(token).map(chip => chip.chip?.kind)).toEqual(['status', 'status', 'status', 'status', 'status']);

		rig.statusEffects = [...names, 'triple_damage', 'speed_boost'].map(name => ({ name, duration: 1 }));
		token.data = rig;
		const shown = chips(token);
		expect(shown.map(chip => chip.chip?.kind)).toEqual(['status', 'status', 'status', 'status', 'more']);
		expect(shown[4].chip).toMatchObject({ kind: 'more', count: 3 });
		const last = shown[4];
		expect(last.x + last.width).toBeLessThanOrEqual(TOKEN_WIDTH);
	});

	test('greys a wreck under a WRECKED stamp, and an unmanned raider under NO DRIVER', () => {
		const buggy = createDrivenVehicle({ driver: createTestDriver('Raider'), name: 'Buggy' });
		const token = new Vehicle({ id: 'token', vehicleData: buggy, side: 'raider' });
		const stamp = part<{ visible: boolean; label: string }>(token, 'stamp');
		expect(stamp.visible).toBe(false);

		buggy.destroy();
		token.data = buggy;
		expect(token.isWrecked).toBe(true);
		expect(stamp.visible).toBe(true);
		expect(stamp.label).toBe('WRECKED');

		const crawler = createDrivenVehicle({ driver: createTestDriver('Crawler'), name: 'Crawler' });
		crawler.driver = null;
		const unmanned = new Vehicle({ id: 'unmanned', vehicleData: crawler, side: 'raider' });
		expect(part<{ label: string }>(unmanned, 'stamp').label).toBe('NO DRIVER');
		expect(part(unmanned, 'driver_hp').text).toBe('0');
	});

	test('cuts a long name with an ellipsis inside the plate and keeps the full name for the tooltip', () => {
		const { context, api, backend } = measured();
		const long = createDrivenVehicle({ driver: createTestDriver('Driver'), name: 'Apocalypse Rig Mark Seven Deluxe' });
		const token = new Vehicle({ id: 'token', vehicleData: long });
		token.mount(context);
		context.frame.layout();
		api.beginFrame({ viewport: { width: 400, height: 300 } });
		renderTree(token, api);
		api.endFrame();

		const name = part(token, 'name');
		expect(name.overflowOutcome).toBe('ellipsis');
		expect(name.x + name.width).toBeLessThanOrEqual(TOKEN_WIDTH);
		expect(token.tooltip?.title).toBe('Apocalypse Rig Mark Seven Deluxe');
		const run = backend.commands.find((command): command is TextCommand => command.kind === 'text' && command.id === 'token_name');
		expect(run).toBeDefined();
	});

	test('draws the armor shield as a polygon of its own, never as a glyph the text atlas lacks (DDB-165)', () => {
		const { context, api, backend } = measured();
		const rig = createDrivenVehicle({ driver: createTestDriver('Rig Driver'), name: 'Rig' });
		const token = new Vehicle({ id: 'token', vehicleData: rig });
		token.mount(context);
		context.frame.layout();
		api.beginFrame({ viewport: { width: 400, height: 300 } });
		renderTree(token, api);
		api.endFrame();

		const runs = backend.commands.filter((command): command is TextCommand => command.kind === 'text' && command.font !== ICON_ATLAS_ROLE);
		for (const run of runs) expect(run.text).toMatch(/^[\x20-\x7e]*$/);
		expect(runs.map(run => run.text)).toContain(`${rig.armor}`);
		const shield = backend.commands.filter((command): command is PolygonCommand => command.kind === 'polygon')
			.find(command => command.points.every(point => point.x >= 64 && point.x <= 64 + 6 + 9 + 26));
		expect(shield).toBeDefined();
	});
});

describe('Vehicle token layout lint', () => {
	const states: [string, () => VehicleData][] = [
		['driven', () => createDrivenVehicle({ driver: createTestDriver('Wasteland Raider'), name: 'Rust Buggy' })],
		['with a passenger', () => {
			const vehicle = createDrivenVehicle({ driver: createTestDriver('Interceptor'), name: 'Lightning Bike' });
			vehicle.passenger = createTestDriver('Road Warrior');
			return vehicle;
		}],
		['an escort, spent, with statuses past the row', () => {
			const escort = createEscort({ type: 'med_truck' });
			escort.spent = true;
			escort.shield = 3;
			escort.statusEffects = ['vulnerable', 'burn', 'stunned', 'speed_reduction', 'death_mark'].map(name => ({ name, duration: 2 }));
			return escort;
		}],
		['wrecked', () => {
			const vehicle = createDrivenVehicle({ driver: createTestDriver('Raider'), name: 'Apocalypse Rig Mark Seven Deluxe' });
			vehicle.destroy();
			return vehicle;
		}],
	];

	it.each(states)('lints clean %s', (_label, make) => {
		const { context } = measured();
		const vehicle = make();
		const token = new Vehicle({ id: 'token', vehicleData: vehicle, seatOf: seats(vehicle) });
		token.intents = [
			{ type: 'attack', value: 8, description: 'Ram', target: 'driver1' },
			{ type: 'attack', value: 6, description: 'Shoot', target: 'both' },
			{ type: 'defend', value: 10, description: 'Brace' },
		];
		token.fitToSlot({ x: 0, y: 0, width: 205, height: 141 });
		expect(lintOf(token, context)).toEqual([]);
	});
});

describe('Vehicle token targeting', () => {
	it('keeps its onClick option, the target choice, out of the component callback', () => {
		const rig = createDrivenVehicle({ driver: createTestDriver('Rig Driver'), name: 'Rig' });
		const chosen = jest.fn();
		const token = new Vehicle({ id: 'token', vehicleData: rig, onClick: chosen });
		expect(token.onClick).toBeNull();

		token.handleEvent({ type: 'click', consume: () => undefined } as unknown as AnyUiEvent);
		expect(chosen).toHaveBeenCalledWith(rig);
	});

	it('subscribes to the combat model while mounted, outlines a target, and dims what is out of reach', () => {
		const context = createTestContext();
		const rig = createDrivenVehicle({ driver: createTestDriver('Rig Driver'), name: 'Rig' });
		const other = createDrivenVehicle({ driver: createTestDriver('Other'), name: 'Other' });
		const model = new CombatModel();
		model.targetableVehicleIds = [rig.id];
		const targeted = new Vehicle({ id: 'target', vehicleData: rig, side: 'raider', combatData: model });
		const outOfReach = new Vehicle({ id: 'out', vehicleData: other, side: 'raider', combatData: model });
		const border = (): unknown => targeted.resolvedColors.border;
		const resting = border();

		// Nothing hears the model before mount (R8.14)
		model.focusVehicle(rig.id);
		expect(border()).toEqual(resting);

		targeted.mount(context);
		outOfReach.mount(context);
		const focused = border();
		expect(focused).not.toEqual(resting);

		model.isTargeting = true;
		expect(outOfReach.opacity).toBeLessThan(1);
		expect(targeted.opacity).toBe(1);

		targeted.unmount();
		model.focusVehicle(null);
		model.isTargeting = false;
		targeted.mount(context);
		expect(border()).toEqual(resting);
	});
});

describe('Vehicle token while a card is aimed (DDB-138)', () => {
	interface Command {
		kind: string;
		border?: { width: number } | null;
		rect?: { x: number; y: number; width: number; height: number };
		points?: readonly { x: number; y: number }[];
	}

	function frame(token: Vehicle): Command[] {
		const { context, api, backend } = measured();
		token.mount(context);
		context.frame.layout();
		api.beginFrame({ viewport: { width: 400, height: 300 } });
		renderTree(token, api);
		api.endFrame();
		const commands = [...backend.commands] as unknown as Command[];
		token.unmount();
		return commands;
	}

	function aimed(): { model: CombatModel; buggy: VehicleData; token: Vehicle } {
		const buggy = createDrivenVehicle({ driver: createTestDriver('Raider'), name: 'Buggy' });
		const model = new CombatModel();
		model.isTargeting = true;
		model.targetableVehicleIds = [buggy.id];
		const token = new Vehicle({ id: 'token', vehicleData: buggy, side: 'raider', combatData: model });
		return { model, buggy, token };
	}

	const isDashes = (command: Command): boolean => command.kind === 'polygon' && (command.points?.length ?? 0) > 60;
	const isSolidOutline = (command: Command): boolean => command.kind === 'rect' && command.border?.width === 3;

	it('outlines a legal target in dashes drawn as one triangle list, built once, and the hovered one solid with a glow', () => {
		const { model, buggy, token } = aimed();
		const dashed = frame(token);
		expect(dashed.filter(isSolidOutline)).toEqual([]);
		const dashes = dashed.filter(isDashes);
		expect(dashes).toHaveLength(1);
		expect((dashes[0].points?.length ?? 0) % 3).toBe(0);
		const built = token['dashPoints'];
		const firstPoint = built[0];
		frame(token);
		expect(token['dashPoints'][0]).toBe(firstPoint);

		model.focusVehicle(buggy.id);
		const solid = frame(token);
		expect(solid.filter(isSolidOutline)).toHaveLength(1);
		expect(solid.some(command => command.kind === 'shadow')).toBe(true);
		expect(solid.filter(isDashes)).toEqual([]);
	});

	it('dims a vehicle the card can\'t reach to the mock\'s 35%', () => {
		const { model, token } = aimed();
		model.targetableVehicleIds = [];
		token.mount(createTestContext());
		expect(token.opacity).toBeCloseTo(0.35, 6);
		token.unmount();
	});

	it('shows its range chip at the top left, red-edged where the card can land', () => {
		const { token } = aimed();
		const chip = part<{ visible: boolean; x: number; width: number; drawnText: readonly string[] | null }>(token, 'range');
		expect(chip.visible).toBe(false);
		token.rangeLabel = { text: 'R1', legal: true };
		expect(chip.visible).toBe(true);
		expect(chip.x).toBe(0);
		expect(chip.drawnText).toEqual(['R1']);
		const narrow = chip.width;
		token.rangeLabel = { text: 'OUT', legal: false };
		expect(chip.width).toBeGreaterThan(narrow);
		token.rangeLabel = null;
		expect(chip.visible).toBe(false);
	});

	it('lints clean with its widest range chip beside a full intents row', () => {
		const { context } = measured();
		const { token } = aimed();
		token.intents = [
			{ type: 'attack', value: 15, description: 'Ram', target: 'driver1' },
			{ type: 'attack', value: 15, description: 'Shoot', target: 'both' },
			{ type: 'defend', value: 10, description: 'Brace' },
		];
		token.rangeLabel = { text: 'OUT', legal: false };
		token.fitToSlot({ x: 0, y: 0, width: 205, height: 141 });
		expect(lintOf(token, context)).toEqual([]);
	});

	it('puts a striped ghost over the end of the bar the hit takes from, and nowhere else', () => {
		const { buggy, token } = aimed();
		const driver = buggy.driver;
		if (!driver) throw new Error('the buggy should have a driver');
		driver.set({ hitpoints: 20, maxHitpoints: 20 });
		token.data = buggy;
		token.damageGhost = { structure: 0, driver: 5, passenger: 0 };
		const hp = token.hpTrackRect;
		const structure = token.structureTrackRect;
		const ghostOn = (commands: Command[], bar: Readonly<{ x: number; y: number; width: number }>, share: number): Command | undefined =>
			commands.find(command => command.kind === 'rect' && command.rect?.y === bar.y && Math.abs(command.rect.x - (bar.x + Math.round(bar.width * share))) < 0.5);

		const commands = frame(token);
		const ghost = ghostOn(commands, hp, 0.75);
		expect(ghost?.rect?.width).toBeCloseTo(Math.round(hp.width) - Math.round(hp.width * 0.75), 0);
		// The stripes over it, as one triangle list
		expect(commands.some(command => command.kind === 'polygon' && (command.points ?? []).every(point => point.y >= hp.y - 1e-6 && point.y <= hp.y + hp.height + 1e-6) && (command.points?.length ?? 0) > 0)).toBe(true);
		// Structure has no ghost: nothing starts inside its track
		expect(commands.some(command => command.kind === 'rect' && command.rect?.y === structure.y && command.rect.x > structure.x)).toBe(false);

		token.damageGhost = null;
		expect(ghostOn(frame(token), hp, 0.75)).toBeUndefined();
	});
});
