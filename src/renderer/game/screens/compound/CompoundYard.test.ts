/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { Container } from '../../../engine/components/Container';
import type { MountContext } from '../../../engine/components/MountContext';
import { renderTree } from '../../../engine/components/renderTree';
import { createTestContext } from '../../../engine/components/testing';
import type { DrawCommand, PolygonCommand, RectCommand, TextCommand } from '../../../engine/draw';
import { click, key, send } from '../../../engine/services/testing';
import { createMeasuringDrawApi, MeasuringRecordingBackend } from '../../../engine/text/testing';
import { themes } from '../../../engine/theme/tokens';
import { BUILDING_IDS, BuildingId } from '../../campaign/Buildings';
import { CompoundYard } from './CompoundYard';

const atlas = themes.atlas.color;
const NAMES: Record<BuildingId, string> = { bunkhouse: 'Bunkhouse', radio_mast: 'Radio mast', infirmary: 'Infirmary', map_room: 'Map room', garage: 'Garage', stores: 'Stores' };
const NUMBERS = Object.fromEntries(BUILDING_IDS.map((id, index) => [id, String(index + 1)])) as Record<BuildingId, string>;

let context: MountContext;
let backend: MeasuringRecordingBackend;
let root: Container;
let chosen: BuildingId[];

beforeEach(() => {
	const measuring = createMeasuringDrawApi();
	backend = measuring.backend;
	context = createTestContext({ draw: measuring.api, clock: new Clock() });
	root = new Container({ id: 'root', width: 1024, height: 900, theme: 'atlas' });
	root.mount(context);
	chosen = [];
});

afterEach(() => root.unmount());

function yardOf({ width, height }: { width: number; height: number }): CompoundYard {
	const yard = new CompoundYard({ id: 'yard', width, height, names: NAMES, numbers: NUMBERS, gate: { name: 'Gate', road: 'to the area map' }, onChoose: (id) => chosen.push(id) });
	for (const id of BUILDING_IDS) yard.setBuilt({ building: id, built: id === 'bunkhouse', state: id === 'bunkhouse' ? 'BUILT' : 'not built' });
	root.addChild(yard);
	context.frame.layout();
	return yard;
}

function draws(): readonly DrawCommand[] {
	const api = context.draw;
	api.beginFrame({ viewport: { width: 1024, height: 900 } });
	renderTree(root, api);
	api.endFrame();
	return backend.commands;
}

/** The plate's rust hatch, drawn once per unbuilt plot. */
function hatches(): number {
	const [r, g, b] = atlas.hatch_rust;
	return draws().filter((command): command is PolygonCommand => command.kind === 'polygon')
		.filter((command) => command.fill !== null && command.fill[0] === r && command.fill[1] === g && command.fill[2] === b).length;
}

describe('CompoundYard', () => {
	it('fits the 920 by 760 plate whole and centred, each building over its plot', () => {
		const yard = yardOf({ width: 920, height: 760 });
		expect(yard.spot('bunkhouse').screenBounds).toMatchObject({ x: 120, y: 126, width: 270, height: 140 });
		yard.width = 920;
		yard.height = 380;
		context.frame.layout();
		// Half the height: half the scale, centred across
		expect(yard.spot('bunkhouse').screenBounds).toMatchObject({ x: Math.round(230 + 60), y: 63, width: 135, height: 70 });
	});

	it('draws a building that stands as a roof with its shadow to the south-east, and one that doesn\'t as a staked-out plot over the rust hatch', () => {
		const yard = yardOf({ width: 920, height: 760 });
		expect(hatches()).toBe(5);
		const shadowed = draws().filter((command): command is RectCommand => command.kind === 'rect');
		expect(draws().some((command) => command.kind === 'shadow')).toBe(true);
		expect(shadowed.length).toBeGreaterThan(0);
		yard.setBuilt({ building: 'infirmary', built: true, state: 'BUILT' });
		context.frame.layout();
		expect(hatches()).toBe(4);
		expect(yard.isBuilt('infirmary')).toBe(true);
		expect(yard.spot('infirmary').state).toBe('BUILT');
	});

	it('labels each building with its number, its name in a paper halo, and its state, and the gate and the road', () => {
		yardOf({ width: 920, height: 760 });
		const texts = draws().filter((command): command is TextCommand => command.kind === 'text');
		const shown = new Set(texts.map((command) => command.text));
		for (const id of BUILDING_IDS) for (const text of [NUMBERS[id], NAMES[id]]) expect(shown.has(text)).toBe(true);
		expect(['BUILT', 'not built', 'Gate', 'to the area map'].every((text) => shown.has(text))).toBe(true);
		const halos = texts.filter((command) => command.text === 'Infirmary' && command.blur > 0);
		expect(halos.length).toBeGreaterThan(0);
		expect(halos.every((command) => command.color.every((channel, index) => channel === atlas.bg_panel[index]))).toBe(true);
		expect(texts.find((command) => command.text === 'Infirmary' && command.blur === 0 && command.color[3] === 1)?.color).toEqual(atlas.text);
	});

	it('keeps its labels readable on a small plate: they shrink with it only to three quarters', () => {
		yardOf({ width: 460, height: 380 });
		const name = draws().find((command): command is TextCommand => command.kind === 'text' && command.text === 'Infirmary' && command.blur === 0);
		expect(name?.size).toBe(22 * 0.75);
		const road = draws().find((command): command is TextCommand => command.kind === 'text' && command.text === 'to the area map' && command.blur === 0);
		expect((road?.box?.x ?? 0) + (road?.box?.width ?? Infinity)).toBeLessThanOrEqual(460);
	});

	it('leaves the rig and the bike out of the yard while they are out on a run', () => {
		const yard = yardOf({ width: 920, height: 760 });
		const rigBody = (): boolean => draws().some((command) => command.kind === 'rect' && command.rect.width === 70 && command.rect.height === 34);
		expect(rigBody()).toBe(true);
		yard.parked = false;
		expect(rigBody()).toBe(false);
	});

	it('chooses a building by press or by focus, and loops the chosen one in grease pencil', () => {
		const yard = yardOf({ width: 920, height: 760 });
		const { x, y, width, height } = yard.spot('garage').screenBounds;
		click(context, x + width / 2, y + height / 2);
		expect(chosen.at(-1)).toBe('garage');
		yard.chosenBuilding = 'garage';
		expect(yard.loop?.target).toBe(yard.spot('garage'));
		expect(yard.spot('garage').selected).toBe(true);
		send(context, [key('ArrowRight')]);
		expect(chosen.at(-1)).toBe('stores');
		yard.chosenBuilding = 'stores';
		expect(yard.handLayer.marks).toHaveLength(1);
		expect(yard.loop?.variant).toBe(1);
	});
});
