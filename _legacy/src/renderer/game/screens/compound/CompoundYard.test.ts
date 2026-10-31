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

	it('keeps its labels readable on a small plate: names shrink with it only to three quarters, mono no smaller than 11 px, in full ink on paper tags', () => {
		yardOf({ width: 460, height: 380 });
		const drawn = draws();
		const text = (label: string) => drawn.find((command): command is TextCommand => command.kind === 'text' && command.text === label && command.blur === 0);
		expect(text('Infirmary')?.size).toBe(22 * 0.75);
		for (const label of ['not built', 'to the area map']) {
			expect(text(label)?.size).toBe(11);
			expect(text(label)?.color).toEqual(atlas.text);
		}
		const road = text('to the area map');
		expect((road?.position?.x ?? Infinity) + 15 * 0.6 * 11).toBeLessThanOrEqual(460);
		const tags = drawn.filter((command): command is RectCommand => command.kind === 'rect' && command.fill !== null && command.fill.every((channel, index) => channel === atlas.bg_panel[index]));
		expect(tags.length).toBeGreaterThanOrEqual(6);
	});

	it.each([{ width: 920, height: 760 }, { width: 460, height: 380 }])('loops the chosen roof and its label together, the loop through the corners of both, so it never crosses the label ($width wide)', (size) => {
		const yard = yardOf(size);
		for (const id of BUILDING_IDS) {
			yard.chosenBuilding = id;
			context.frame.layout();
			const spot = yard.spot(id);
			const box = spot.screenBounds;
			const label = spot.labelBox;
			const loop = yard.loopBounds;
			// The hand layer's loop runs 12 px outside its target: an ellipse with these radii.
			const rx = loop.width / 2 + 12;
			const ry = loop.height / 2 + 12;
			const cx = loop.x + loop.width / 2;
			const cy = loop.y + loop.height / 2;
			const inside = (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0001;
			const corners = [[box.x, box.y], [box.x + box.width, box.y + box.height], [box.x + label.x, box.y + label.y], [box.x + label.x + label.width, box.y + label.y + label.height]];
			expect(corners.every(([x, y]) => inside(x, y))).toBe(true);
		}
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
		context.frame.layout();
		expect(yard.loop?.target?.id).toBe('compound_yard_loop');
		expect(yard.spot('garage').selected).toBe(true);
		send(context, [key('ArrowRight')]);
		expect(chosen.at(-1)).toBe('stores');
		yard.chosenBuilding = 'stores';
		expect(yard.handLayer.marks).toHaveLength(1);
		expect(yard.loop?.variant).toBe(1);
	});
});
