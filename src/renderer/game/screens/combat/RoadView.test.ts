/**
 * @jest-environment jsdom
 */
import { DrawApi, TextCommand } from '../../../engine/draw';
import { ICON_ATLAS_ROLE } from '../../../engine/text/fontFaces';
import { createMeasuringDrawApi, MeasuringRecordingBackend } from '../../../engine/text/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import { renderTree } from '../../../engine/components/renderTree';
import { createTestContext } from '../../../engine/components/testing';
import { advance } from '../../../engine/services/testing';
import { ICON_CODE_POINTS } from '../../../engine/text/icons';
import { Vehicle } from '../../mechanics/Vehicle';
import { RoadLane, RoadRow, RoadSlot } from '../../mechanics/Road';
import { TOKEN_HEIGHT, TOKEN_WIDTH } from './CombatLayout';
import { ROAD_STYLE } from './combatStyle';
import { EnemyIntent, RoadView, SHOULDER_HATCH, SWERVE_DURATION } from './RoadView';
import { hatchTriangles } from '../../ui/stripes';

/** The road band at the 1280x720 reference: 1280 wide, 720 less the top bar and the dock. */
const ROAD_WIDTH = 1280;
const ROAD_HEIGHT = 456;

function vehicle(name: string, slot: RoadSlot | null): Vehicle {
	return new Vehicle({
		name,
		structure: 30,
		maxStructure: 30,
		armor: 5,
		maxArmor: 5,
		baseSpeed: 2,
		slot,
		flank: null,
		velocity: 0,
		driver: null,
		passenger: null,
		statusEffects: [],
	});
}

const RAIDER_SLOT: RoadSlot = { lane: RoadLane.ENEMY_INSIDE, row: RoadRow.CENTER };
const RIG_SLOT: RoadSlot = { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.CENTER };

describe('RoadView', () => {
	let backend: MeasuringRecordingBackend;
	let api: DrawApi;
	let context: MountContext;
	let road: RoadView;
	let raider: Vehicle;
	let rig: Vehicle;

	beforeEach(() => {
		({ api, backend } = createMeasuringDrawApi());
		context = createTestContext({ draw: api });
		raider = vehicle('Rust Buggy', RAIDER_SLOT);
		rig = vehicle('Apocalypse Rig', RIG_SLOT);
		road = new RoadView({ id: 'road', x: 0, y: 0, width: ROAD_WIDTH, height: ROAD_HEIGHT });
		road.showVehicles({ player: [rig], enemy: [raider] });
		road.mount(context);
	});

	function frame(): void {
		context.frame.layout();
		api.beginFrame({ viewport: { width: 1440, height: 882 } });
		renderTree(road, api);
		api.endFrame();
	}

	/** The middle of a vehicle's token, scaled, in the road's space. */
	function tokenCentre(vehicleId: string): { x: number; y: number } {
		const token = road.vehicleView(vehicleId);
		if (!token) throw new Error(`${vehicleId} has no token`);
		const scale = token.tokenScale;
		return { x: token.x + (token.width * scale) / 2, y: token.y + (token.height * scale) / 2 };
	}

	function slotCentre(slot: RoadSlot): { x: number; y: number } {
		const rect = road.slotRect(slot);
		return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
	}

	it('centres each token in its slot at the layout\'s scale', () => {
		for (const [vehicleId, slot] of [[raider.id, RAIDER_SLOT], [rig.id, RIG_SLOT]] as const) {
			const centre = tokenCentre(vehicleId);
			const expected = slotCentre(slot);
			// Placed on whole pixels
			expect(Math.abs(centre.x - expected.x)).toBeLessThanOrEqual(0.5);
			expect(Math.abs(centre.y - expected.y)).toBeLessThanOrEqual(0.5);
			expect(road.vehicleView(vehicleId)?.width).toBe(TOKEN_WIDTH);
			expect(road.vehicleView(vehicleId)?.height).toBe(TOKEN_HEIGHT);
			expect(road.vehicleView(vehicleId)?.tokenScale).toBeCloseTo(Math.max(1, road.roadLayout.tokenScale));
		}
	});

	it('puts a raider\'s plan in the strip across its token\'s top, and none on yours', () => {
		road.setVehicleIntents(raider.id, [{ type: 'attack', value: 6, description: 'Ram' }]);
		const token = road.vehicleView(raider.id);
		const row = road.intentRowOf(raider.id);
		expect(row?.parent).toBe(token);
		expect(row?.bounds.y).toBe(0);
		expect((row?.bounds.y ?? 0) + (row?.bounds.height ?? 0)).toBeLessThanOrEqual(token?.plateRect.y ?? 0);
		expect(road.intentRowOf(rig.id)?.intents).toEqual([]);
	});

	it('keeps raiders ahead of your vehicles in the tree, so focus meets them first', () => {
		const order = road.children.map((child) => child.id);
		expect(order.indexOf('enemy_vehicle_enemy_inside_center')).toBeLessThan(order.indexOf('player_vehicle_player_inside_center'));
	});

	it('names each token from the slot it arrives in', () => {
		expect(road.vehicleView(raider.id)?.id).toBe('enemy_vehicle_enemy_inside_center');
		expect(road.vehicleView(rig.id)?.id).toBe('player_vehicle_player_inside_center');
	});

	it('never moves or resizes a slot when vehicles come, go, or move', () => {
		const slots = (): unknown => road.roadLayout.lanes.map(({ lane }) => road.roadLayout.rows.map(({ row }) => road.slotRect({ lane, row })));
		const before = JSON.stringify(slots());
		const flanker = vehicle('Interceptor', { lane: RoadLane.ENEMY_SHOULDER, row: RoadRow.CENTER });
		road.showVehicles({ player: [rig, flanker], enemy: [raider] });
		raider.set({ slot: { lane: RoadLane.ENEMY_OUTSIDE, row: RoadRow.AHEAD } });
		road.showVehicles({ player: [rig, flanker], enemy: [raider] });
		road.showVehicles({ player: [flanker], enemy: [raider] });
		context.animator.settle();
		expect(JSON.stringify(slots())).toBe(before);
	});

	it('drops the token of a vehicle that leaves the road, and shows none for one that was never on it', () => {
		const offRoad = vehicle('Wreck', null);
		road.showVehicles({ player: [rig, offRoad], enemy: [] });
		expect(road.vehicleView(raider.id)).toBeNull();
		expect(road.intentRowOf(raider.id)).toBeNull();
		expect(road.vehicleView(offRoad.id)).toBeNull();
		expect(road.children.some((child) => child.id === 'enemy_vehicle_enemy_inside_center')).toBe(false);
	});

	describe('a move', () => {
		const target: RoadSlot = { lane: RoadLane.ENEMY_SHOULDER, row: RoadRow.AHEAD };

		function move(): void {
			rig.set({ slot: target });
			road.showVehicles({ player: [rig], enemy: [raider] });
		}

		it('swerves from one slot to the other on the animator, over the vehicles it passes', () => {
			const start = slotCentre(RIG_SLOT);
			const end = slotCentre(target);
			move();
			expect(road.slotOf(rig.id)).toEqual(target);
			expect(road.isSwerving(rig.id)).toBe(true);
			expect(road.vehicleView(rig.id)?.zIndex).toBe(1);

			advance(context, SWERVE_DURATION / 2);
			const midway = tokenCentre(rig.id);
			expect(midway.x).toBeGreaterThan(start.x);
			expect(midway.x).toBeLessThan(end.x);
			// The row change leads the lane change, so the path curves
			const across = (midway.x - start.x) / (end.x - start.x);
			const along = (midway.y - start.y) / (end.y - start.y);
			expect(along).toBeGreaterThan(across);

			advance(context, SWERVE_DURATION);
			expect(road.isSwerving(rig.id)).toBe(false);
			expect(road.vehicleView(rig.id)?.zIndex).toBe(0);
			expect(tokenCentre(rig.id).x).toBeCloseTo(end.x);
			expect(tokenCentre(rig.id).y).toBeCloseTo(end.y);
		});

		it('lands at once under reduced motion', () => {
			context.animator.reducedMotion = true;
			move();
			advance(context, 16);
			expect(road.isSwerving(rig.id)).toBe(false);
			const end = slotCentre(target);
			expect(tokenCentre(rig.id).x).toBeCloseTo(end.x);
			expect(tokenCentre(rig.id).y).toBeCloseTo(end.y);
		});

		it('lands in the new slot when the road is resized mid-swerve', () => {
			move();
			advance(context, SWERVE_DURATION / 3);
			road.setSize(1440, 520);
			expect(road.isSwerving(rig.id)).toBe(false);
			const end = slotCentre(target);
			expect(tokenCentre(rig.id).x).toBeCloseTo(end.x);
			expect(tokenCentre(rig.id).y).toBeCloseTo(end.y);
		});
	});

	describe('the ground', () => {
		function rectsFilled(fill: readonly number[]): { x: number; y: number; width: number; height: number }[] {
			return backend.commands
				.filter((command) => command.kind === 'rect' && command.fill !== null && command.fill.every((value, index) => Math.abs(value - fill[index]) < 1e-6))
				.map((command) => (command.kind === 'rect' ? command.rect : { x: 0, y: 0, width: 0, height: 0 }));
		}

		/** Empty slots drawn, from where their outline's top-left dash starts. */
		function outlinedSlots(): number {
			const outlines = [...rectsFilled(ROAD_STYLE.slotOutline), ...rectsFilled(ROAD_STYLE.raiderSlotOutline)];
			const corners = new Set<string>();
			for (const slot of road.roadLayout.lanes.flatMap(({ lane }) => road.roadLayout.rows.map(({ row }) => road.slotRect({ lane, row })))) {
				if (outlines.some((dash) => Math.abs(dash.x - (slot.x + 6)) < 1e-6 && Math.abs(dash.y - (slot.y + 4)) < 1e-6)) corners.add(`${slot.x}:${slot.y}`);
			}
			return corners.size;
		}

		it('outlines every slot nobody is in', () => {
			frame();
			expect(outlinedSlots()).toBe(16);
			road.showVehicles({ player: [], enemy: [] });
			frame();
			expect(outlinedSlots()).toBe(18);
		});

		it('draws the centre line between the two inside lanes, dashed and twice as wide as the others', () => {
			frame();
			const centreX = road.roadLayout.lanes[3].x;
			const dashes = rectsFilled(ROAD_STYLE.centreLine);
			expect(dashes.length).toBeGreaterThan(1);
			for (const dash of dashes) {
				expect(dash.x + dash.width / 2).toBeCloseTo(centreX);
				expect(dash.width).toBe(4);
				expect(dash.y).toBeGreaterThanOrEqual(road.roadLayout.headerHeight);
			}
		});

		it('tints the raiders\' lanes and the shoulder their flankers use red, and your flank bone', () => {
			frame();
			const lanes = road.roadLayout.lanes;
			const red = rectsFilled(ROAD_STYLE.raiderLaneTint).map((rect) => rect.x);
			expect(red.sort((a, b) => a - b)).toEqual([lanes[0].x, lanes[3].x, lanes[4].x]);
			expect(rectsFilled(ROAD_STYLE.playerShoulderTint).map((rect) => rect.x)).toEqual([lanes[5].x]);
		});

		it('runs the shoulders and the header past its sides by the bleed', () => {
			road.bleed = 160;
			frame();
			const header = rectsFilled(ROAD_STYLE.header);
			expect(header).toEqual([{ x: -160, y: 0, width: ROAD_WIDTH + 320, height: 26 }]);
			const shoulders = rectsFilled(ROAD_STYLE.shoulderGround);
			expect(shoulders[0].x).toBe(-160);
			expect(shoulders[1].x + shoulders[1].width).toBe(ROAD_WIDTH + 160);
		});

		it('hatches a shoulder in triangles that stay inside it', () => {
			const rect = { x: -40, y: 0, width: 240, height: 456 };
			const points = hatchTriangles(rect, SHOULDER_HATCH);
			expect(points.length % 3).toBe(0);
			expect(points.length).toBeGreaterThan(0);
			for (const point of points) {
				expect(point.x).toBeGreaterThanOrEqual(rect.x - 1e-9);
				expect(point.x).toBeLessThanOrEqual(rect.x + rect.width + 1e-9);
				expect(point.y).toBeGreaterThanOrEqual(-1e-9);
				expect(point.y).toBeLessThanOrEqual(rect.height + 1e-9);
			}
		});
	});

	describe('intent pills', () => {
		/**
		 * The icon glyphs drawn in one frame, by name, once pills have grown in
		 * and any a changed plan dropped have shrunk out and detached.
		 */
		async function iconsDrawn(): Promise<string[]> {
			context.animator.settle();
			await Promise.resolve();
			await Promise.resolve();
			frame();
			const names = new Map(Object.entries(ICON_CODE_POINTS).map(([name, codePoint]) => [String.fromCodePoint(codePoint), name]));
			return backend.commands
				.filter((command): command is TextCommand => command.kind === 'text' && command.font === ICON_ATLAS_ROLE)
				.map((command) => names.get(command.text) ?? command.text);
		}

		/** The token's own icons, drawn before its intents: the speed chevrons and the driver's heart. */
		const TOKEN_ICONS = ['keyboard_double_arrow_right', 'favorite'];

		function intent(type: EnemyIntent['type'], value?: number): EnemyIntent {
			return { type, value, description: type };
		}

		beforeEach(() => road.showVehicles({ player: [], enemy: [raider] }));

		it('shows a shield for defend and a wrench for repair, in the token\'s intents row', async () => {
			road.setVehicleIntents(raider.id, [intent('defend', 6)]);
			expect(await iconsDrawn()).toEqual([...TOKEN_ICONS, 'shield']);

			road.setVehicleIntents(raider.id, [intent('repair', 4)]);
			expect(await iconsDrawn()).toEqual([...TOKEN_ICONS, 'build']);
		});

		it('shows the crosshair and the value for an attack', async () => {
			road.setVehicleIntents(raider.id, [intent('attack', 15)]);
			expect(await iconsDrawn()).toEqual([...TOKEN_ICONS, 'gps_fixed']);
			expect(backend.commands.some((command) => command.kind === 'text' && command.text === '15')).toBe(true);
		});

		it('hides the icon with the pill when the intent clears', async () => {
			road.setVehicleIntents(raider.id, [intent('defend', 6)]);
			road.setVehicleIntents(raider.id, []);
			expect(await iconsDrawn()).toEqual(TOKEN_ICONS);
		});

		it('keeps a plan set before the raider reaches the road', async () => {
			const late = vehicle('Late Raider', { lane: RoadLane.ENEMY_OUTSIDE, row: RoadRow.BEHIND });
			road.setVehicleIntents(late.id, [intent('defend', 6)]);
			road.showVehicles({ player: [], enemy: [raider, late] });
			expect(road.intentRowOf(late.id)?.intents.map((shown) => shown.type)).toEqual(['defend']);
		});
	});
});
