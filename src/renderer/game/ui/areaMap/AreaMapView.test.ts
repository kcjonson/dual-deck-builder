import { Container } from '../../../engine/components/Container';
import type { MountContext } from '../../../engine/components/MountContext';
import { renderTree } from '../../../engine/components/renderTree';
import { Stack } from '../../../engine/components/Stack';
import { createTestContext } from '../../../engine/components/testing';
import { CircleCommand, DrawApi, DrawCommand, ImageCommand, PolylineCommand, RecordingBackend } from '../../../engine/draw';
import { NO_MODIFIERS } from '../../../engine/input/events';
import { click, key, pointer, send } from '../../../engine/services/testing';
import type { RiverLines } from '../../map/Rivers';
import { FOG, RIVER_STYLE, ROAD_STYLES, RUMORED_FADE, RUMORED_TOWARD, roadWidthScale } from './areaMapStyle';
import { AreaMapView, AreaMapViewOptions, WHEEL_ZOOM_RATE } from './AreaMapView';
import type { AreaMapSelection, LandFogLayer, MapMarker, RoadKnowledge } from './layers';
import { FIT_MARGIN } from './MapCamera';
import { NO_RIVERS, SMALL_NETWORK, flatTerrain } from './testing';

/**
 * The view on a mounted root, drawn through a recording backend and driven
 * through the dispatcher (R9.25): its layout and camera, the pan, zoom, and
 * selection maths, that the terrain bakes once and not per frame, and what
 * it draws with every optional layer absent.
 */

const WIDTH = 600;
const HEIGHT = 600;
const RADIUS = 600;

interface Mounted {
	view: AreaMapView;
	context: MountContext;
	backend: RecordingBackend;
	frame: () => readonly DrawCommand[];
}

function mountView(options: AreaMapViewOptions = {}): Mounted {
	const backend = new RecordingBackend();
	const context = createTestContext({ draw: new DrawApi({ backend, development: false }) });
	const root = new Container({ width: 1000, height: 800 });
	const view = new AreaMapView({
		id: 'map',
		x: 100,
		y: 50,
		width: WIDTH,
		height: HEIGHT,
		map: { terrain: flatTerrain({ radius: RADIUS }), network: SMALL_NETWORK, rivers: NO_RIVERS },
		...options,
	});
	root.addChild(view);
	root.mount(context);
	context.frame.layout();
	const frame = (): readonly DrawCommand[] => {
		context.draw.beginFrame({ viewport: { width: 1000, height: 800 } });
		renderTree(root, context.draw);
		context.draw.endFrame();
		return backend.commands;
	};
	return { view, context, backend, frame };
}

/** Where world (x, y) lands on the page, through the view's camera and its place on the root. */
function onPage(view: AreaMapView, x: number, y: number): { x: number; y: number } {
	const local = view.camera.worldToScreen(x, y);
	return { x: local.x + 100, y: local.y + 50 };
}

function roads(commands: readonly DrawCommand[]): PolylineCommand[] {
	return commands.filter((command): command is PolylineCommand => command.kind === 'polyline' && /^map\.road_\d+$/.test(command.id ?? ''));
}

function wheel(context: MountContext, x: number, y: number, deltaY: number): void {
	context.dispatcher.enqueue({ kind: 'wheel', x, y, deltaX: 0, deltaY, deltaMode: 0, modifiers: NO_MODIFIERS });
	context.dispatcher.dispatchPending();
}

describe('AreaMapView layout and camera', () => {
	it('fits the whole disc to its box, the compound at the centre, north up', () => {
		const { view } = mountView();
		const zoom = (HEIGHT - HEIGHT * FIT_MARGIN * 2) / (RADIUS * 2);
		expect(view.camera.zoom).toBeCloseTo(zoom, 12);
		expect(view.camera.worldToScreen(0, 0)).toEqual({ x: 300, y: 300 });
		expect(view.camera.worldToScreen(0, 500).y).toBeCloseTo(300 - 500 * zoom, 9);
	});

	it('refits when a fill layout gives it its size', () => {
		const backend = new RecordingBackend();
		const context = createTestContext({ draw: new DrawApi({ backend, development: false }) });
		const root = new Stack({ width: 900, height: 500 });
		const view = new AreaMapView({ widthMode: 'fill', heightMode: 'fill', map: { terrain: flatTerrain({ radius: RADIUS }), network: SMALL_NETWORK, rivers: NO_RIVERS } });
		root.addChild(view);
		root.mount(context);
		context.frame.layout();
		expect(view.width).toBe(900);
		expect(view.camera.zoom).toBeCloseTo((500 - 500 * FIT_MARGIN * 2) / (RADIUS * 2), 12);
		expect(view.camera.worldToScreen(0, 0)).toEqual({ x: 450, y: 250 });
	});

	it('draws the terrain image over the disc\'s square, cropped to the texels in view', () => {
		const { view, frame } = mountView();
		frame();
		const [whole] = frame().filter((command): command is ImageCommand => command.kind === 'image');
		expect(whole.rect).toEqual({ x: -RADIUS, y: -RADIUS, width: RADIUS * 2, height: RADIUS * 2 });
		expect(whole.sourceRect).toEqual({ x: 0, y: 0, width: whole.texture.width, height: whole.texture.height });

		view.camera.zoom = 2;
		view.camera.center = { x: 100, y: 100 };
		const [cropped] = frame().filter((command): command is ImageCommand => command.kind === 'image');
		const texel = (RADIUS * 2) / cropped.texture.width;
		// 300 world units across at zoom 2, plus at most a texel either side
		expect(cropped.rect.width).toBeGreaterThanOrEqual(300);
		expect(cropped.rect.width).toBeLessThanOrEqual(300 + texel * 2);
		expect(cropped.sourceRect?.width).toBeCloseTo(cropped.rect.width / texel, 9);
		// Its map-space top is world y 250 (north), flipped
		expect(cropped.rect.y).toBeLessThanOrEqual(-250);
		expect(cropped.rect.y).toBeGreaterThan(-250 - texel);
	});

	it('draws world layers under the camera matrix and clips everything to its box', () => {
		const { view, frame } = mountView();
		const commands = frame();
		const road = roads(commands)[0];
		const [a, b, c, d, tx, ty] = road.transform;
		const camera = view.camera.matrix;
		expect([a, b, c, d]).toEqual([camera[0], 0, 0, camera[3]]);
		expect(tx).toBeCloseTo(camera[4] + 100, 9);
		expect(ty).toBeCloseTo(camera[5] + 50, 9);
		for (const command of commands) {
			expect(command.clip).toEqual({ kind: 'rect', rect: { minX: 100, minY: 50, maxX: 700, maxY: 650 }, rounded: null });
		}
	});
});

describe('AreaMapView pan, zoom, and selection', () => {
	it('pans with a drag, keeping the world point under the pointer, and selects nothing', () => {
		const onSelect = jest.fn();
		const { view, context } = mountView({ onSelect });
		view.camera.zoom = 1;
		const grabbed = view.camera.screenToWorld(250, 260);
		send(context, [pointer('down', 350, 310), pointer('move', 380, 290), pointer('move', 420, 250), pointer('up', 420, 250)]);
		const now = view.camera.worldToScreen(grabbed.x, grabbed.y);
		expect(now.x).toBeCloseTo(320, 9);
		expect(now.y).toBeCloseTo(200, 9);
		expect(onSelect).not.toHaveBeenCalled();
	});

	it('does not pan inside the drag threshold', () => {
		const { view, context } = mountView();
		const before = view.camera.center;
		send(context, [pointer('down', 350, 310), pointer('move', 352, 311), pointer('up', 352, 311)]);
		expect(view.camera.center).toEqual(before);
	});

	it('zooms with the wheel about the pointer', () => {
		const { view, context } = mountView();
		const zoom = view.camera.zoom;
		const anchor = view.camera.screenToWorld(450 - 100, 200 - 50);
		wheel(context, 450, 200, -120);
		expect(view.camera.zoom).toBeCloseTo(zoom * Math.exp(120 * WHEEL_ZOOM_RATE), 12);
		const after = onPage(view, anchor.x, anchor.y);
		expect(after.x).toBeCloseTo(450, 9);
		expect(after.y).toBeCloseTo(200, 9);
	});

	it('takes the wheel only while it can zoom that way (R9.32)', () => {
		const { view } = mountView();
		view.camera.zoom = view.camera.minZoom;
		expect(view.canScroll(0, 100)).toBe(false);
		expect(view.canScroll(0, -100)).toBe(true);
		view.camera.zoom = view.camera.maxZoom;
		expect(view.canScroll(0, -100)).toBe(false);
		expect(view.canScroll(0, 0)).toBe(false);
	});

	it('selects a marker, a road, or nothing with a click, and reports only changes', () => {
		const selections: (AreaMapSelection | null)[] = [];
		const markers: MapMarker[] = [{ id: 'silos', kind: 'poi', x: 200, y: 400, label: 'Grain silos' }];
		const { view, context } = mountView({ markers, onSelect: (selection) => selections.push(selection) });

		const silos = onPage(view, 200, 400);
		click(context, silos.x + 5, silos.y - 4);
		expect(view.selection).toEqual({ kind: 'marker', id: 'silos' });

		// On the highway's last stretch, between the junction and its end
		const highway = onPage(view, 2, 420);
		click(context, highway.x, highway.y);
		expect(view.selection).toEqual({ kind: 'stretch', stretch: 2 });
		click(context, highway.x, highway.y);

		const empty = onPage(view, -400, -300);
		click(context, empty.x, empty.y);
		expect(view.selection).toBeNull();
		expect(selections).toEqual([{ kind: 'marker', id: 'silos' }, { kind: 'stretch', stretch: 2 }, null]);
	});

	it('picks the nearest road within the pick distance of its edge, and nothing past it', () => {
		const { view } = mountView();
		view.camera.zoom = 1;
		view.camera.center = { x: 0, y: 200 };
		const on = view.camera.worldToScreen(0, 150);
		expect(view.pick(on)).toEqual({ kind: 'stretch', stretch: 1 });
		expect(view.pick({ x: on.x + 7, y: on.y })).toEqual({ kind: 'stretch', stretch: 1 });
		expect(view.pick({ x: on.x + 12, y: on.y })).toBeNull();
	});

	it('picks only what it draws: no hidden layer, no hidden stretch', () => {
		const { view } = mountView({ markers: [{ id: 'yard', kind: 'stronghold', x: 0, y: 450 }] });
		const yard = view.camera.worldToScreen(0, 450);
		expect(view.pick(yard)).toEqual({ kind: 'marker', id: 'yard' });
		view.layers = { markers: false };
		expect(view.pick(yard)).toEqual({ kind: 'stretch', stretch: 2 });
		view.layers = { markers: false, roads: false };
		expect(view.pick(yard)).toBeNull();

		view.layers = { markers: true, roads: true };
		view.markers = [];
		const states: RoadKnowledge[] = ['charted', 'uncharted', 'uncharted', 'uncharted'];
		view.knowledge = { knowledgeOf: (stretch) => states[stretch] };
		// Stretch 2's parent is uncharted, so it's hidden; stretch 1 is a stub from the city street
		expect(view.pick(view.camera.worldToScreen(0, 450))).toBeNull();
		expect(view.pick(view.camera.worldToScreen(0, 150))).toEqual({ kind: 'stretch', stretch: 1 });
	});

	it('pans with the arrows and zooms with + and - once focused', () => {
		const { view, context } = mountView();
		view.camera.zoom = 1;
		context.focus.focus(view);
		const before = view.camera.center;
		send(context, [key('ArrowRight'), key('ArrowUp')]);
		const step = Math.min(WIDTH, HEIGHT) * 0.15;
		expect(view.camera.center.x).toBeCloseTo(before.x + step, 9);
		expect(view.camera.center.y).toBeCloseTo(before.y + step, 9);
		send(context, [key('+')]);
		expect(view.camera.zoom).toBeCloseTo(1.25, 12);
		send(context, [key('-'), key('-')]);
		expect(view.camera.zoom).toBeCloseTo(0.8, 12);
		send(context, [key('0')]);
		expect(view.camera.isFitted).toBe(true);
	});

	it('keeps a selection through marker, knowledge, and layer changes, and clears it for a new map, firing nothing', () => {
		const onSelect = jest.fn();
		const { view } = mountView({ markers: [{ id: 'a', kind: 'poi', x: 0, y: 0 }], onSelect });
		view.selection = { kind: 'marker', id: 'a' };
		view.markers = [];
		view.knowledge = { knowledgeOf: () => 'uncharted' };
		view.layers = { markers: false, roads: false };
		expect(view.selection).toEqual({ kind: 'marker', id: 'a' });
		view.map = { terrain: flatTerrain({ radius: RADIUS }), network: SMALL_NETWORK, rivers: NO_RIVERS };
		expect(view.selection).toBeNull();
		expect(onSelect).not.toHaveBeenCalled();
	});

	describe('a pan selects nothing', () => {
		/** A drag from world (x, y) by (dx, dy) on the page, past the drag threshold. */
		function pan(mounted: Mounted, x: number, y: number, dx: number, dy: number): void {
			const from = onPage(mounted.view, x, y);
			send(mounted.context, [
				pointer('down', from.x, from.y),
				pointer('move', from.x + dx / 3, from.y + dy / 3),
				pointer('move', from.x + dx, from.y + dy),
				pointer('up', from.x + dx, from.y + dy),
			]);
		}

		it('that starts on a road', () => {
			const onSelect = jest.fn();
			const mounted = mountView({ onSelect });
			mounted.view.camera.zoom = 1;
			mounted.view.camera.center = { x: 0, y: 200 };
			const before = mounted.view.camera.center;
			pan(mounted, 0, 150, 90, 40);
			expect(mounted.view.camera.center).not.toEqual(before);
			expect(mounted.view.selection).toBeNull();
			expect(onSelect).not.toHaveBeenCalled();
		});

		it('that starts on a marker, or ends on one', () => {
			const onSelect = jest.fn();
			const mounted = mountView({ markers: [{ id: 'silos', kind: 'poi', x: 200, y: 400 }], onSelect });
			pan(mounted, 200, 400, -70, 70);
			const silos = mounted.view.camera.worldToScreen(200, 400);
			const offMarker = mounted.view.camera.screenToWorld(silos.x - 80, silos.y);
			pan(mounted, offMarker.x, offMarker.y, 80, 0);
			expect(mounted.view.selection).toBeNull();
			expect(onSelect).not.toHaveBeenCalled();
		});

		it('made while something is selected, over empty ground', () => {
			const onSelect = jest.fn();
			const mounted = mountView({ onSelect, selection: { kind: 'stretch', stretch: 1 } });
			pan(mounted, -300, -200, 60, 50);
			expect(mounted.view.selection).toEqual({ kind: 'stretch', stretch: 1 });
			expect(onSelect).not.toHaveBeenCalled();
		});

		it('and the next click still selects', () => {
			const onSelect = jest.fn();
			const mounted = mountView({ onSelect });
			pan(mounted, -300, -200, 60, 50);
			const highway = onPage(mounted.view, 2, 420);
			click(mounted.context, highway.x, highway.y);
			expect(onSelect).toHaveBeenCalledWith({ kind: 'stretch', stretch: 2 });
		});
	});

	it('gives a tie to the road drawn on top', () => {
		const { view } = mountView();
		// The junction, where stretches 1, 2 (highway) and 3 (back road) meet
		expect(view.pick(view.camera.worldToScreen(0, 300))).toEqual({ kind: 'stretch', stretch: 2 });
	});

	it('merges a layer change over the current toggles', () => {
		const { view } = mountView();
		view.layers = { fog: false };
		view.layers = { markers: false };
		expect(view.layers).toMatchObject({ fog: false, markers: false, roads: true, terrain: true, junctions: true });
	});
});

describe('AreaMapView baking', () => {
	it('bakes the terrain once on mount, never per frame, whatever the camera does', () => {
		const terrain = flatTerrain({ radius: RADIUS });
		const backend = new RecordingBackend();
		const context = createTestContext({ draw: new DrawApi({ backend, development: false }) });
		const create = jest.spyOn(context.draw, 'createTexture');
		const view = new AreaMapView({ id: 'map', width: WIDTH, height: HEIGHT, map: { terrain, network: SMALL_NETWORK, rivers: NO_RIVERS } });
		// Nothing is baked before mount (R8.14)
		expect(terrain.samples).toBe(0);
		const root = new Container({ width: 800, height: 800 });
		root.addChild(view);
		root.mount(context);
		const sampled = terrain.samples;
		expect(sampled).toBeGreaterThan(0);
		expect(create).toHaveBeenCalledTimes(1);

		for (let frame = 0; frame < 5; frame++) {
			view.camera.zoomAt(1.3, 300, 300);
			view.camera.panBy(17, -9);
			context.draw.beginFrame({ viewport: { width: 800, height: 800 } });
			renderTree(root, context.draw);
			context.draw.endFrame();
		}
		expect(create).toHaveBeenCalledTimes(1);
		expect(terrain.samples).toBe(sampled);
		const image = backend.commands.find((command): command is ImageCommand => command.kind === 'image');
		expect(image?.texture.label).toBe('area map terrain');
	});

	it('bakes again for a new map and releases the old texture, and releases both on unmount', () => {
		const { view, context } = mountView({ fog: { cells: 8, isRevealed: () => true } });
		const create = jest.spyOn(context.draw, 'createTexture');
		const destroy = jest.spyOn(context.draw, 'destroyTexture');
		view.map = { terrain: flatTerrain({ radius: 400 }), network: SMALL_NETWORK, rivers: NO_RIVERS };
		expect(create).toHaveBeenCalledTimes(1);
		expect(destroy).toHaveBeenCalledTimes(1);
		expect(view.camera.radius).toBe(400);
		view.unmount();
		expect(destroy).toHaveBeenCalledTimes(3);
	});

	it('keeps its pan and zoom when a map of the same radius replaces the one shown', () => {
		const { view } = mountView();
		view.camera.zoom = 2;
		view.camera.center = { x: 120, y: -40 };
		view.map = { terrain: flatTerrain({ radius: RADIUS }), network: SMALL_NETWORK, rivers: NO_RIVERS };
		expect(view.camera.zoom).toBe(2);
		expect(view.camera.center).toEqual({ x: 120, y: -40 });
	});

	it('bakes the fog before the terrain on mount, and covers the disc in fog until the fog is resident', () => {
		const backend = new RecordingBackend();
		const context = createTestContext({ draw: new DrawApi({ backend, development: false }) });
		const create = jest.spyOn(context.draw, 'createTexture');
		const root = new Container({ width: 800, height: 800 });
		const view = new AreaMapView({ id: 'map', width: WIDTH, height: HEIGHT, map: { terrain: flatTerrain({ radius: RADIUS }), network: SMALL_NETWORK, rivers: NO_RIVERS }, fog: { cells: 8, isRevealed: () => false } });
		root.addChild(view);
		root.mount(context);
		expect(create.mock.calls.map(([options]) => options.label)).toEqual(['area map fog', 'area map terrain']);

		jest.spyOn(context.draw, 'isTextureResident').mockReturnValue(false);
		context.draw.beginFrame({ viewport: { width: 800, height: 800 } });
		renderTree(root, context.draw);
		context.draw.endFrame();
		const fog = backend.commands.find((command): command is CircleCommand => command.kind === 'circle' && command.id === 'map.fog');
		expect(fog?.radius).toBe(RADIUS);
		expect(fog?.fill).toEqual([FOG.color[0] / 255, FOG.color[1] / 255, FOG.color[2] / 255, FOG.alpha]);
		const ids = backend.commands.map((command) => command.id);
		expect(ids.indexOf('map.terrain')).toBeLessThan(ids.indexOf('map.fog'));
	});

	it('bakes the fog when it is set, and draws it over the terrain', () => {
		const { view, context, frame } = mountView();
		const create = jest.spyOn(context.draw, 'createTexture');
		const fog: LandFogLayer = { cells: 16, isRevealed: (column, row) => column === 8 && row === 8 };
		view.fog = fog;
		expect(create).toHaveBeenCalledTimes(1);
		expect(create.mock.calls[0][0].label).toBe('area map fog');
		frame();
		const images = frame().filter((command): command is ImageCommand => command.kind === 'image');
		expect(images.map((image) => image.texture.label)).toEqual(['area map terrain', 'area map fog']);
		view.fog = null;
		expect(frame().filter((command) => command.kind === 'image')).toHaveLength(1);
	});
});

describe('AreaMapView with its optional layers absent', () => {
	it('draws every road as charted, in its class\'s style, widest on top', () => {
		const { view, frame } = mountView();
		frame();
		const drawn = roads(frame());
		expect(drawn.map((road) => road.id)).toEqual(['map.road_3', 'map.road_0', 'map.road_1', 'map.road_2']);
		const zoom = view.camera.zoom;
		for (const road of drawn) {
			const stretch = SMALL_NETWORK.stretches[Number(road.id?.split('_')[1])];
			expect(road.color).toEqual(ROAD_STYLES[stretch.roadClass].color);
			expect(road.width).toBeCloseTo(ROAD_STYLES[stretch.roadClass].width * roadWidthScale(zoom) / zoom, 12);
		}
	});

	it('thickens roads gently as it zooms in, within bounds', () => {
		const { view, frame } = mountView();
		const widthAt = (zoom: number): number => {
			view.camera.zoom = zoom;
			frame();
			const highway = roads(frame()).find((road) => road.id === 'map.road_0');
			return (highway?.width ?? 0) * view.camera.zoom;
		};
		expect(widthAt(0.5)).toBeCloseTo(ROAD_STYLES.highway.width, 9);
		expect(widthAt(2)).toBeGreaterThan(widthAt(1));
		expect(widthAt(4)).toBeLessThanOrEqual(ROAD_STYLES.highway.width * 1.8 + 1e-9);
		expect(widthAt(0.1)).toBeGreaterThanOrEqual(ROAD_STYLES.highway.width * 0.8 - 1e-9);
		expect(roadWidthScale(0.5)).toBe(1);
	});

	it('draws no fog, no markers, and the compound with its label', () => {
		const { view, frame } = mountView();
		frame();
		const commands = frame();
		expect(commands.filter((command) => command.kind === 'image')).toHaveLength(1);
		expect(commands.some((command) => command.id?.startsWith('map.marker_'))).toBe(false);
		expect(commands.some((command) => command.id === 'map.compound')).toBe(true);
		expect(view.drawnText).toEqual(['Home']);
		expect(view.knowledge).toBeNull();
		expect(view.fog).toBeNull();
		expect(view.markers).toEqual([]);
	});

	it('draws the junction where its inbound road is drawn, with the roads layer off too', () => {
		const { view, frame } = mountView();
		frame();
		const circles = frame().filter((command) => command.kind === 'circle');
		expect(circles).toHaveLength(1);
		expect(circles[0]).toMatchObject({ center: { x: 0, y: -300 } });

		view.layers = { roads: false };
		expect(frame().filter((command) => command.kind === 'circle')).toHaveLength(1);
		view.layers = { roads: true, junctions: false };
		expect(frame().filter((command) => command.kind === 'circle')).toHaveLength(0);
	});

	it('draws nothing but its ground without a map', () => {
		const { view, frame } = mountView({ map: null });
		expect(frame().map((command) => command.id)).toEqual(['map.ground']);
		expect(view.pick({ x: 300, y: 300 })).toBeNull();
		expect(view.drawnText).toBeNull();
	});
});

describe('AreaMapView knowledge and markers', () => {
	it('draws rumored roads pale, uncharted ones as fading stubs where they leave known road, and hides the rest', () => {
		const states: RoadKnowledge[] = ['charted', 'rumored', 'uncharted', 'uncharted'];
		const { frame } = mountView({ knowledge: { knowledgeOf: (stretch) => states[stretch] } });
		frame();
		const drawn = roads(frame());
		const rumored = drawn.filter((road) => road.id === 'map.road_1');
		expect(rumored).toHaveLength(1);
		const pale = ROAD_STYLES.highway.color.map((channel, index) => (index < 3 ? channel + (RUMORED_TOWARD[index] - channel) * RUMORED_FADE : channel));
		rumored[0].color.forEach((channel, index) => expect(channel).toBeCloseTo(pale[index], 12));

		// Stretches 2 and 3 leave the rumored stretch 1, so both are stubs: dashes fading out
		for (const id of ['map.road_2', 'map.road_3']) {
			const dashes = drawn.filter((road) => road.id === id);
			expect(dashes.length).toBeGreaterThan(2);
			const alphas = dashes.map((dash) => dash.color[3]);
			expect(alphas[0]).toBe(1);
			for (let index = 1; index < alphas.length; index++) expect(alphas[index]).toBeLessThan(alphas[index - 1]);
		}

		// A stub's parent uncharted: hidden whole, and so is the junction it leaves
		const deeper: RoadKnowledge[] = ['charted', 'uncharted', 'uncharted', 'uncharted'];
		const second = mountView({ knowledge: { knowledgeOf: (stretch) => deeper[stretch] } });
		second.frame();
		const commands = second.frame();
		expect(roads(commands).filter((road) => road.id === 'map.road_2' || road.id === 'map.road_3')).toEqual([]);
		expect(commands.filter((command) => command.kind === 'circle')).toEqual([]);
	});

	it('draws each marker kind and state, its label, and the selection ring', () => {
		const markers: MapMarker[] = [
			{ id: 'a', kind: 'poi', x: 0, y: 500, label: 'Hospital' },
			{ id: 'b', kind: 'poi', x: 200, y: 400, state: 'looted' },
			{ id: 'c', kind: 'poi', x: -200, y: 400, state: 'depleted' },
			{ id: 'd', kind: 'stronghold', x: 300, y: -300, label: 'Rust Vulture yard' },
		];
		const { view, frame } = mountView({ markers, selection: { kind: 'marker', id: 'd' } });
		frame();
		const commands = frame();
		const kinds = (id: string): string[] => commands.filter((command) => command.id === `map.marker_${id}`).map((command) => command.kind);
		expect(kinds('a')).toEqual(['circle']);
		expect(kinds('b')).toEqual(['circle', 'polyline']);
		expect(kinds('c')).toEqual(['circle']);
		// The ring, the disc, the diamond
		expect(kinds('d')).toEqual(['circle', 'circle', 'polygon']);
		expect(commands.filter((command) => command.kind === 'text').map((command) => command.kind === 'text' && command.text)).toEqual(['Home', 'Hospital', 'Rust Vulture yard']);
		expect(view.drawnText).toEqual(['Home', 'Hospital', 'Rust Vulture yard']);
	});

	it('highlights a selected road under it', () => {
		const { frame } = mountView({ selection: { kind: 'stretch', stretch: 3 } });
		frame();
		const ids = frame().map((command) => command.id);
		expect(ids.indexOf('map.selected_road')).toBeGreaterThan(-1);
		expect(ids.indexOf('map.selected_road')).toBeLessThan(ids.indexOf('map.road_3'));
	});
});

describe('AreaMapView rivers', () => {
	// West to east south of the compound, a creek widening to a river, and out past the rim.
	const rivers: RiverLines = { points: Float64Array.of(-300, -100, 0, -100, 300, -50, 700, -50), widths: Float64Array.of(2, 2, 6, 6), offsets: Uint32Array.of(0, 4) };
	const isRiver = (color: readonly number[]) => [RIVER_STYLE.color, RIVER_STYLE.outside].some((river) => river.every((channel, index) => channel === color[index]));
	const riverCommands = (commands: readonly DrawCommand[]): PolylineCommand[] => commands.filter((command): command is PolylineCommand => command.kind === 'polyline' && isRiver(command.color));

	it('draws rivers live over the land and under the roads, at their width, never under a pixel, and fainter past the rim', () => {
		const { view, frame } = mountView({ map: { terrain: flatTerrain({ radius: RADIUS }), network: SMALL_NETWORK, rivers } });
		frame();
		const commands = frame();
		const drawn = riverCommands(commands);
		// A run for the creek, one for the river, and one past the rim.
		expect(drawn.map((command) => [...command.color])).toEqual([[...RIVER_STYLE.color], [...RIVER_STYLE.color], [...RIVER_STYLE.outside]]);
		const least = RIVER_STYLE.minPixels / view.camera.zoom;
		expect(drawn[0].width).toBeCloseTo(Math.max(2.25, least), 12);
		expect(drawn[1].width).toBeCloseTo(Math.max(6, least), 12);
		// North up: world y flips into map space.
		expect(drawn[0].points[0]).toEqual({ x: -300, y: 100 });
		const firstRiver = commands.indexOf(drawn[0]);
		expect(firstRiver).toBeGreaterThan(commands.findIndex((command) => command.kind === 'image'));
		expect(firstRiver).toBeLessThan(commands.indexOf(roads(commands)[0]));

		view.layers = { water: false };
		expect(riverCommands(frame())).toHaveLength(0);
	});

	it('draws no rivers for a map with none', () => {
		const { frame } = mountView();
		frame();
		expect(riverCommands(frame())).toHaveLength(0);
	});
});
