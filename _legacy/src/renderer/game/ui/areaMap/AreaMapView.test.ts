import { Container } from '../../../engine/components/Container';
import type { MountContext } from '../../../engine/components/MountContext';
import { renderTree } from '../../../engine/components/renderTree';
import { Stack } from '../../../engine/components/Stack';
import { createTestContext } from '../../../engine/components/testing';
import { CircleCommand, DrawApi, DrawCommand, ImageCommand, LineCommand, PolygonCommand, PolylineCommand, RecordingBackend, RectCommand, TextCommand } from '../../../engine/draw';
import { NO_MODIFIERS } from '../../../engine/input/events';
import { click, key, pointer, send } from '../../../engine/services/testing';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import type { Places } from '../../map/Places';
import { POI_TUNING } from '../../map/PoiData';
import type { RiverLines } from '../../map/Rivers';
import type { RoadNetwork } from '../../map/RoadNetwork';
import {
	BRIDGE,
	BROKEN_SPAN,
	DAM_STYLE,
	FOG,
	LABELS,
	LABEL_LAYOUT,
	MARKER,
	NIGHT_RING,
	PASS_MARK,
	POI_GLYPHS,
	RIVER_STYLE,
	ROAD_DETAIL_ZOOM,
	ROAD_STYLES,
	ROUTE_BAND,
	RUMORED_FADE,
	RUMORED_TOWARD,
	roadWidthScale,
} from './areaMapStyle';
import { AreaMapView, AreaMapViewOptions, DASH_ZOOM_STEPS, WHEEL_ZOOM_RATE } from './AreaMapView';
import { AreaMapSelection, LandFogLayer, MapMarker, MapRoute, RoadKnowledge, stubEnd } from './layers';
import { FIT_MARGIN } from './MapCamera';
import * as roadGeometry from './roadGeometry';
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

/** Mounted over a recording backend, or one that measures text where a test places labels. */
function mountView(options: AreaMapViewOptions = {}, { measuring = false }: { measuring?: boolean } = {}): Mounted {
	const measured = measuring ? createMeasuringDrawApi() : null;
	const backend = measured?.backend ?? new RecordingBackend();
	const context = createTestContext({ draw: measured?.api ?? new DrawApi({ backend, development: false }) });
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

/** The roads' fills: every road polyline but the casings, which are wider than their class's fill. */
function fills(commands: readonly DrawCommand[], zoom: number): PolylineCommand[] {
	const pixel = roadWidthScale(zoom) / zoom;
	return roads(commands).filter((road) => !Object.values(ROAD_STYLES).some((style) => style.casing && Math.abs(road.width - style.casing.width * pixel) < 1e-9));
}

/** The text a frame drew, its labels' halos left out: each label's halo is a blurred run before it (R3.17). */
function texts(commands: readonly DrawCommand[]): string[] {
	return commands.filter((command): command is TextCommand => command.kind === 'text' && command.blur === 0).map((command) => command.text);
}

function sameColour(a: readonly number[], b: readonly number[]): boolean {
	return a.every((channel, index) => channel === b[index]);
}

function labelOf(commands: readonly DrawCommand[], text: string): TextCommand | undefined {
	return commands.find((command): command is TextCommand => command.kind === 'text' && command.blur === 0 && command.text === text);
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
		// Stretch 2 leaves a node where nothing's known, so it's hidden; stretch 1 is a stub from the city street
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
		expect(view.layers).toMatchObject({ fog: false, markers: false, roads: true, terrain: true, places: true });
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
	it('draws every road as charted, in its class\'s style, each class\'s casings under its fills, widest on top', () => {
		const { view, frame } = mountView();
		frame();
		const drawn = roads(frame());
		const zoom = view.camera.zoom;
		const pixel = roadWidthScale(zoom) / zoom;
		const { backRoad, highway } = ROAD_STYLES;
		// The back road's pale edge, its fill, then the highways' dark casings, then their fills.
		expect(drawn.map((road) => [road.id, [...road.color], road.width])).toEqual([
			['map.road_3', [...(backRoad.casing?.color ?? [])], (backRoad.casing?.width ?? 0) * pixel],
			['map.road_3', [...backRoad.color], backRoad.width * pixel],
			...[0, 1, 2].map((id) => [`map.road_${id}`, [...(highway.casing?.color ?? [])], (highway.casing?.width ?? 0) * pixel]),
			...[0, 1, 2].map((id) => [`map.road_${id}`, [...highway.color], highway.width * pixel]),
		]);
	});

	it('dashes trails along their whole length, under the other classes', () => {
		const network: RoadNetwork = {
			...SMALL_NETWORK,
			stretches: [...SMALL_NETWORK.stretches, { roadClass: 'trail', from: 4, to: 3, length: Math.hypot(200, 100), points: [200, 400, 0, 500], bridges: [], street: false }],
		};
		const { view, frame } = mountView({ map: { terrain: flatTerrain({ radius: RADIUS }), network, rivers: NO_RIVERS } });
		frame();
		const drawn = roads(frame());
		const trail = drawn.filter((road) => road.id === 'map.road_4');
		const zoom = view.camera.zoom;
		const pattern = ROAD_STYLES.trail.dash ?? { dash: 0, gap: 0 };
		// Dashes and gaps a constant length on screen, near enough (a zoom step's rounding), from end to end.
		expect(trail.length).toBeGreaterThan(Math.floor((Math.hypot(200, 100) * zoom) / (pattern.dash + pattern.gap) * 0.9));
		for (const dash of trail) expect([...dash.color]).toEqual([...ROAD_STYLES.trail.color]);
		expect(drawn.indexOf(trail[trail.length - 1])).toBeLessThan(drawn.findIndex((road) => road.id === 'map.road_3'));
	});

	it('thickens roads gently as it zooms in, within bounds', () => {
		const { view, frame } = mountView();
		const widthAt = (zoom: number): number => {
			view.camera.zoom = zoom;
			frame();
			const highway = fills(frame(), view.camera.zoom).find((road) => road.id === 'map.road_0');
			return (highway?.width ?? 0) * view.camera.zoom;
		};
		expect(widthAt(0.5)).toBeCloseTo(ROAD_STYLES.highway.width, 9);
		expect(widthAt(2)).toBeGreaterThan(widthAt(1));
		expect(widthAt(4)).toBeLessThanOrEqual(ROAD_STYLES.highway.width * 1.8 + 1e-9);
		expect(widthAt(0.1)).toBeGreaterThanOrEqual(ROAD_STYLES.highway.width * 0.8 - 1e-9);
		expect(roadWidthScale(0.5)).toBe(1);
	});

	it('draws no fog, no markers, and the compound as a star on a halo, with its label', () => {
		const { view, frame } = mountView();
		frame();
		const commands = frame();
		expect(commands.filter((command) => command.kind === 'image')).toHaveLength(1);
		expect(commands.some((command) => command.id?.startsWith('map.marker_'))).toBe(false);
		const star = commands.filter((command): command is PolygonCommand => command.id === 'map.compound');
		expect(star.map((command) => command.points.length)).toEqual([10, 10]);
		const home = view.camera.worldToScreen(0, 0);
		// Pointing up, its top tip straight above Home.
		expect(star[1].points[0].x).toBeCloseTo(home.x, 9);
		expect(star[1].points[0].y).toBeLessThan(home.y);
		expect(view.drawnText).toEqual(['Home']);
		expect(view.knowledge).toBeNull();
		expect(view.fog).toBeNull();
		expect(view.markers).toEqual([]);
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
		// Its casing and its fill, both paler.
		expect(rumored).toHaveLength(2);
		const pale = (color: readonly number[]) => color.map((channel, index) => (index < 3 ? channel + (RUMORED_TOWARD[index] - channel) * RUMORED_FADE : channel));
		rumored[0].color.forEach((channel, index) => expect(channel).toBeCloseTo(pale(ROAD_STYLES.highway.casing?.color ?? [])[index], 12));
		rumored[1].color.forEach((channel, index) => expect(channel).toBeCloseTo(pale(ROAD_STYLES.highway.color)[index], 12));

		// Stretches 2 and 3 leave the rumored stretch 1, so both are stubs: dashes fading out
		for (const id of ['map.road_2', 'map.road_3']) {
			const dashes = drawn.filter((road) => road.id === id);
			expect(dashes.length).toBeGreaterThan(2);
			const alphas = dashes.map((dash) => dash.color[3]);
			expect(alphas[0]).toBe(1);
			for (let index = 1; index < alphas.length; index++) expect(alphas[index]).toBeLessThan(alphas[index - 1]);
		}

		// Nothing known where a stub would leave: hidden whole
		const deeper: RoadKnowledge[] = ['charted', 'uncharted', 'uncharted', 'uncharted'];
		const second = mountView({ knowledge: { knowledgeOf: (stretch) => deeper[stretch] } });
		second.frame();
		const commands = second.frame();
		expect(roads(commands).filter((road) => road.id === 'map.road_2' || road.id === 'map.road_3')).toEqual([]);
		expect(commands.filter((command) => command.kind === 'circle')).toEqual([]);
	});

	it('draws an uncharted stub from whichever end leaves known road', () => {
		// Only the highway's last stretch, from the junction north, is known.
		const states: RoadKnowledge[] = ['uncharted', 'uncharted', 'charted', 'uncharted'];
		const knowledge = { knowledgeOf: (stretch: number) => states[stretch] };
		expect(stubEnd(SMALL_NETWORK, knowledge, 1)).toBe('to');
		expect(stubEnd(SMALL_NETWORK, knowledge, 3)).toBe('from');
		expect(stubEnd(SMALL_NETWORK, knowledge, 0)).toBe('from');
		const { frame } = mountView({ knowledge });
		frame();
		const drawn = roads(frame());
		// Stretch 1 runs from the metro's edge up to the junction, and its stub starts at the junction, (0, 300) in world space.
		const stub = drawn.filter((road) => road.id === 'map.road_1');
		expect(stub.length).toBeGreaterThan(2);
		expect(stub[0].points[0]).toEqual({ x: 0, y: -300 });
		expect(drawn.filter((road) => road.id === 'map.road_3')[0].points[0]).toEqual({ x: 0, y: -300 });
	});

	it('draws each marker kind and state, its label, and the selection ring', () => {
		const markers: MapMarker[] = [
			{ id: 'a', kind: 'poi', x: 0, y: 500, label: 'Hospital', type: 'hospital' },
			{ id: 'b', kind: 'poi', x: 200, y: 400, state: 'looted', type: 'farm' },
			{ id: 'c', kind: 'poi', x: -200, y: 400, state: 'depleted' },
			{ id: 'd', kind: 'stronghold', x: 300, y: -300, label: 'Rust Vulture yard', type: 'hospital' },
		];
		const { view, frame } = mountView({ markers, selection: { kind: 'marker', id: 'd' } });
		frame();
		const commands = frame();
		const of = (id: string) => commands.filter((command) => command.id === `map.marker_${id}`);
		expect(of('a').map((command) => command.kind)).toEqual(['circle']);
		expect(of('b').map((command) => command.kind)).toEqual(['circle']);
		// A depleted POI is filled grey and struck through.
		expect(of('c').map((command) => command.kind)).toEqual(['circle', 'line']);
		expect((of('c')[0] as CircleCommand).fill).toEqual(MARKER.spent);
		// The ring, then the diamond on its paper edge; a stronghold has no glyph.
		expect(of('d').map((command) => command.kind)).toEqual(['circle', 'polygon', 'polygon']);
		expect((of('d')[2] as PolygonCommand).fill).toEqual(MARKER.stronghold.fill);
		// Glyphs by type: ink while unvisited, grey once looted.
		const glyphs = commands.filter((command): command is TextCommand => command.kind === 'text' && (command.id ?? '').startsWith('map.glyph_'));
		expect(glyphs.map((command) => [command.id, command.text, [...command.color]])).toEqual([
			['map.glyph_a', POI_GLYPHS.hospital, [...MARKER.ink]],
			['map.glyph_b', POI_GLYPHS.farm, [...MARKER.spent]],
		]);
		// Home's label is placed first, then the selected marker's.
		expect(texts(commands).filter((text) => text.length > 1)).toEqual(['Home', 'Rust Vulture yard', 'Hospital']);
		expect(view.drawnText).toEqual([POI_GLYPHS.hospital, POI_GLYPHS.farm, 'Home', 'Rust Vulture yard', 'Hospital']);
		// Each label in its kind's style, on a paper halo: a blurred run of it just before.
		const yard = labelOf(commands, 'Rust Vulture yard');
		expect([yard?.font, yard?.size, [...(yard?.color ?? [])]]).toEqual([LABELS.stronghold.font, LABELS.stronghold.size, [...LABELS.stronghold.color]]);
		const halo = commands[commands.indexOf(yard as DrawCommand) - 1] as TextCommand;
		expect([halo.text, [...halo.color], halo.blur > 0]).toEqual(['Rust Vulture yard', [...LABEL_LAYOUT.halo.color], true]);
	});

	it('highlights a selected road under it', () => {
		const { frame } = mountView({ selection: { kind: 'stretch', stretch: 3 } });
		frame();
		const ids = frame().map((command) => command.id);
		expect(ids.indexOf('map.selected_road')).toBeGreaterThan(-1);
		expect(ids.indexOf('map.selected_road')).toBeLessThan(ids.indexOf('map.road_3'));
	});
});

describe('AreaMapView places', () => {
	const places: Places = {
		metro: { id: 0, kind: 'metro', x: 0, y: 0, radius: 90 },
		towns: [
			{ id: 1, kind: 'town', x: 300, y: 200, radius: 30, name: 'Ashford', suitability: 2 },
			{ id: 2, kind: 'town', x: -300, y: -250, radius: 30, name: 'Cold Springs', suitability: 1.9 },
		],
		villages: [{ id: 3, kind: 'village', x: -100, y: 350, radius: 10, name: 'Elkdale', suitability: 1.5 }],
		crossroads: [{ id: 4, kind: 'crossroads', x: 150, y: -300 }],
		exits: [{ id: 5, kind: 'exit', x: 0, y: 590, bearing: 90, highway: true }, { id: 6, kind: 'exit', x: -590, y: 0, bearing: 180, highway: false }],
	};
	const withPlaces = (): AreaMapViewOptions => ({ map: { terrain: flatTerrain({ radius: RADIUS }), network: SMALL_NETWORK, rivers: NO_RIVERS, places } });

	it('names a place on its left where its right would run past the view\'s edge', () => {
		const east: Places = { ...places, towns: [{ id: 7, kind: 'town', x: 580, y: 0, radius: 30, name: 'Eastport', suitability: 2 }], villages: [] };
		const { view, frame } = mountView({ map: { terrain: flatTerrain({ radius: RADIUS }), network: SMALL_NETWORK, rivers: NO_RIVERS, places: east } }, { measuring: true });
		frame();
		const label = labelOf(frame(), 'Eastport');
		expect((label?.box?.x ?? Infinity) + (label?.box?.width ?? 0)).toBeLessThan(view.camera.worldToScreen(580, 0).x);
	});

	it('names a place on its left where its right would cover a marker, above or below where both sides would, and not at all where all four would (DDB-43)', () => {
		const measured = (options: AreaMapViewOptions) => mountView({ ...withPlaces(), ...options }, { measuring: true });
		// Ashford at (300, 200): a POI just east of it, then west, north, and south as well
		const east: MapMarker = { id: 'east', kind: 'poi', x: 330, y: 200 };
		const west: MapMarker = { id: 'west', kind: 'poi', x: 270, y: 200 };
		const north: MapMarker = { id: 'north', kind: 'poi', x: 300, y: 230 };
		const south: MapMarker = { id: 'south', kind: 'poi', x: 300, y: 170 };
		const one = measured({ markers: [east] });
		one.frame();
		const dot = one.view.camera.worldToScreen(300, 200);
		const left = labelOf(one.frame(), 'Ashford')?.box;
		expect((left?.x ?? 0) + (left?.width ?? 0) - 100).toBeLessThan(dot.x);
		one.view.markers = [east, west];
		const above = labelOf(one.frame(), 'Ashford')?.box;
		expect((above?.y ?? Infinity) + (above?.height ?? 0) - 50).toBeLessThan(dot.y);
		one.view.markers = [east, west, north, south];
		expect(texts(one.frame())).not.toContain('Ashford');
		expect(one.view.drawnText).not.toContain('Ashford');
		expect(one.view.drawnText).toContain('Cold Springs');
	});

	it('names towns and villages beside their built-up patches, which the terrain bakes, biggest first, in their own styles', () => {
		const { view, frame } = mountView(withPlaces());
		frame();
		const commands = frame();
		// No dots or rings: towns and villages are patches in the bake, and crossroads and exits aren't drawn.
		expect(commands.some((command) => /^map\.place_\d+$/.test(command.id ?? ''))).toBe(false);
		expect(texts(commands)).toEqual(['Home', 'Ashford', 'Cold Springs', 'Elkdale']);
		expect(view.drawnText).toEqual(['Home', 'Ashford', 'Cold Springs', 'Elkdale']);
		const ashford = labelOf(commands, 'Ashford');
		expect([ashford?.font, ashford?.size]).toEqual([LABELS.town.font, LABELS.town.size]);
		expect(ashford?.id).toBe('map.place_1_label');
		expect(ashford?.box?.x).toBeGreaterThan(onPage(view, 300, 200).x - 100);
		const elkdale = labelOf(commands, 'Elkdale');
		expect([elkdale?.font, elkdale?.size]).toEqual([LABELS.village.font, LABELS.village.size]);
	});

	it('sets the metro\'s name in spaced capitals over Home, when the map has one', () => {
		const { view, frame } = mountView({ map: { terrain: flatTerrain({ radius: RADIUS }), network: SMALL_NETWORK, rivers: NO_RIVERS, places, metroName: 'Halcyon' } }, { measuring: true });
		expect(view.drawnText).toContain('HALCYON');
		frame();
		const metro = labelOf(frame(), 'HALCYON');
		expect([metro?.font, metro?.letterSpacing]).toEqual([LABELS.metro.font, LABELS.metro.letterSpacing]);
		expect((metro?.box?.y ?? Infinity) + (metro?.box?.height ?? 0)).toBeLessThan(view.camera.worldToScreen(0, 0).y);
	});

	it('draws none with the places layer off, and none the fog hides', () => {
		const { view, frame } = mountView(withPlaces());
		view.layers = { places: false };
		frame();
		expect(frame().some((command) => command.id?.startsWith('map.place_'))).toBe(false);
		expect(view.drawnText).toEqual(['Home']);

		// Only the south-west quarter is revealed: Cold Springs is, the rest aren't.
		const fog: LandFogLayer = { cells: 4, isRevealed: (column, row) => column < 2 && row < 2 };
		const fogged = mountView({ ...withPlaces(), fog });
		fogged.frame();
		const drawn = fogged.frame().filter((command) => command.kind === 'text' && /^map\.place_\d+_label$/.test(command.id ?? '')).map(({ id }) => id);
		expect([...new Set(drawn)]).toEqual(['map.place_2_label']);
		expect(fogged.view.drawnText).toEqual(['Home', 'Cold Springs']);
		fogged.view.layers = { fog: false };
		expect(fogged.view.drawnText).toEqual(['Home', 'Ashford', 'Cold Springs', 'Elkdale']);
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

describe('AreaMapView labels, glyphs, and the night ring', () => {
	it('places labels by priority, the selected first, on the right, the left, above, or below, and leaves out one with no side clear until the zoom makes room', () => {
		// Eighteen pixels apart at the fit zoom: Alpha has Bravo on its right, Delta on its left, and an unnamed POI above and below.
		const markers: MapMarker[] = [
			{ id: 'a', kind: 'poi', x: 0, y: 400, label: 'Alpha station', priority: 2 },
			{ id: 'b', kind: 'poi', x: 40, y: 400, label: 'Bravo yard', priority: 1 },
			{ id: 'd', kind: 'poi', x: -40, y: 400, label: 'Delta camp', priority: 3 },
			{ id: 'e', kind: 'poi', x: 0, y: 440 },
			{ id: 'f', kind: 'poi', x: 0, y: 360 },
			{ id: 'c', kind: 'poi', x: -400, y: -300, label: 'Charlie mine' },
		];
		const { view, frame } = mountView({ markers }, { measuring: true });
		frame();
		let commands = frame();
		// Home first; Bravo on its right; Alpha boxed in, left out; Delta's right would cover Alpha, so its left.
		expect(texts(commands)).toEqual(['Home', 'Charlie mine', 'Bravo yard', 'Delta camp']);
		expect(view.drawnText).toEqual(['Home', 'Charlie mine', 'Bravo yard', 'Delta camp']);
		// Text boxes are in the view's own space, as the camera's points are.
		const delta = labelOf(commands, 'Delta camp')?.box;
		expect((delta?.x ?? Infinity) + (delta?.width ?? 0)).toBeLessThan(view.camera.worldToScreen(-40, 400).x);

		// Chosen, Alpha goes first, on its right though nothing's clear; Bravo then has no side clear.
		view.selection = { kind: 'marker', id: 'a' };
		commands = frame();
		expect(texts(commands)).toEqual(['Home', 'Alpha station', 'Charlie mine', 'Delta camp']);
		expect(labelOf(commands, 'Alpha station')?.box?.x ?? -Infinity).toBeGreaterThan(view.camera.worldToScreen(0, 400).x);

		view.selection = null;
		view.camera.zoom = 4;
		view.camera.center = { x: 0, y: 400 };
		// Room for all three; Home and Charlie are out of view, left out.
		expect(texts(frame())).toEqual(['Bravo yard', 'Alpha station', 'Delta camp']);
	});

	it('keeps labels off the picked route\'s stops, and draws the stops over the labels', () => {
		// A stop about 25 pixels east of the chosen POI at the fit zoom, where its label would go.
		const markers: MapMarker[] = [{ id: 'p', kind: 'poi', x: 0, y: 300, label: 'Pumping station' }];
		const routes: MapRoute[] = [{ id: 'picked', points: [0, 0, 0, 300], picked: true, stops: [{ x: 54, y: 300, fight: true }] }];
		const { view, frame } = mountView({ markers, routes, selection: { kind: 'marker', id: 'p' } }, { measuring: true });
		frame();
		const commands = frame();
		const label = labelOf(commands, 'Pumping station');
		expect((label?.box?.x ?? Infinity) + (label?.box?.width ?? 0)).toBeLessThan(view.camera.worldToScreen(0, 300).x);
		const ids = commands.map((command) => command.id);
		expect(ids.indexOf('map.route_picked_stop_0')).toBeGreaterThan(ids.indexOf('map.label_p'));
	});

	it('sets a marker\'s label over the fog light on the fog\'s dark, and the rest dark on paper', () => {
		const markers: MapMarker[] = [
			{ id: 'seen', kind: 'poi', x: -300, y: -300, label: 'Seen camp' },
			{ id: 'hidden', kind: 'stronghold', x: 300, y: 300, label: 'Rust Vulture yard' },
		];
		// Only the south-west quarter is revealed.
		const fog: LandFogLayer = { cells: 4, isRevealed: (column, row) => column < 2 && row < 2 };
		const { frame } = mountView({ markers, fog });
		frame();
		const commands = frame();
		const halo = (text: string) => commands[commands.indexOf(labelOf(commands, text) as DrawCommand) - 1] as TextCommand;
		expect([...(labelOf(commands, 'Rust Vulture yard')?.color ?? [])]).toEqual([...LABEL_LAYOUT.fogged.color]);
		expect([...halo('Rust Vulture yard').color]).toEqual([...LABEL_LAYOUT.fogged.halo]);
		expect([...(labelOf(commands, 'Seen camp')?.color ?? [])]).toEqual([...LABELS.poi.color]);
		expect([...halo('Seen camp').color]).toEqual([...LABEL_LAYOUT.halo.color]);
	});

	it('draws a POI\'s glyph centred in its disc and a night ring round one with no route home by dark', () => {
		const markers: MapMarker[] = [
			{ id: 'near', kind: 'poi', x: 0, y: 300, type: 'clinic' },
			{ id: 'far', kind: 'poi', x: 300, y: -300, type: 'waterPlant', pastDark: true },
			{ id: 'odd', kind: 'poi', x: -300, y: -300, type: 'no such type' },
		];
		const { view, frame } = mountView({ markers });
		frame();
		const commands = frame();
		const circles = (id: string) => commands.filter((command): command is CircleCommand => command.kind === 'circle' && command.id === `map.marker_${id}`);
		expect(circles('near')).toHaveLength(1);
		const [ring, disc] = circles('far');
		expect(ring.border?.color).toEqual(NIGHT_RING.color);
		expect(ring.radius).toBeGreaterThan(disc.radius);
		const glyphs = commands.filter((command): command is TextCommand => command.kind === 'text' && (command.id ?? '').startsWith('map.glyph_'));
		expect(glyphs.map((command) => [command.id, command.text, command.align])).toEqual([['map.glyph_near', POI_GLYPHS.clinic, 'center'], ['map.glyph_far', POI_GLYPHS.waterPlant, 'center']]);
		const at = view.camera.worldToScreen(0, 300);
		expect(glyphs[0].box?.x).toBeCloseTo(at.x - (glyphs[0].box?.width ?? 0) / 2, 9);
		expect(view.drawnText).toEqual([POI_GLYPHS.clinic, POI_GLYPHS.waterPlant, 'Home']);
	});

	it('names every POI type with a glyph of its own', () => {
		expect(Object.keys(POI_GLYPHS).sort()).toEqual(Object.keys(POI_TUNING.types).sort());
		const glyphs = Object.values(POI_GLYPHS);
		expect(new Set(glyphs.map((glyph) => glyph.toUpperCase())).size).toBe(glyphs.length);
	});
});

describe('AreaMapView routes', () => {
	const routes: MapRoute[] = [
		{ id: 'picked', points: [0, 0, 0, 300, 200, 400], picked: true, stops: [{ x: 0, y: 150, fight: true }, { x: 100, y: 350, fight: false }] },
		{ id: 'other', points: [0, 0, 0, 500], picked: false, stops: [{ x: 0, y: 250, fight: true }] },
	];

	it('draws a POI\'s routes as bands under the roads, the picked one over the others, north up', () => {
		const { view, frame } = mountView({ routes });
		frame();
		const commands = frame();
		const ids = commands.map((command) => command.id);
		const picked = commands.find((command): command is PolylineCommand => command.id === 'map.route_picked') as PolylineCommand;
		const other = commands.find((command): command is PolylineCommand => command.id === 'map.route_other') as PolylineCommand;
		expect(ids.indexOf('map.route_other')).toBeLessThan(ids.indexOf('map.route_picked'));
		expect(ids.indexOf('map.route_picked')).toBeLessThan(commands.indexOf(roads(commands)[0]));
		expect(picked.points).toEqual([{ x: 0, y: -0 }, { x: 0, y: -300 }, { x: 200, y: -400 }]);
		const pixel = roadWidthScale(view.camera.zoom) / view.camera.zoom;
		expect(picked.width).toBeCloseTo(ROUTE_BAND.picked.width * pixel, 12);
		expect(other.width).toBeCloseTo(ROUTE_BAND.other.width * pixel, 12);
		expect([...picked.color]).toEqual([...ROUTE_BAND.picked.color]);
		expect(view.routes).toEqual(routes);
	});

	it('marks the picked route\'s stops on screen, a fight as a diamond and anything else as a square, and no other route\'s', () => {
		const { view, frame } = mountView({ routes });
		frame();
		const commands = frame();
		const stops = commands.filter((command) => (command.id ?? '').includes('_stop_'));
		expect(stops.map((command) => [command.id, command.kind])).toEqual([['map.route_picked_stop_0', 'polygon'], ['map.route_picked_stop_1', 'rect']]);
		const diamond = stops[0] as PolygonCommand;
		const at = view.camera.worldToScreen(0, 150);
		expect(diamond.points[1].x - diamond.points[3].x).toBeGreaterThan(0);
		expect((diamond.points[0].x + diamond.points[2].x) / 2).toBeCloseTo(at.x, 9);
		const square = stops[1] as RectCommand;
		expect(square.rect.width).toBe(square.rect.height);

		view.routes = [];
		expect(frame().some((command) => (command.id ?? '').startsWith('map.route_'))).toBe(false);
	});
});

describe('AreaMapView road details', () => {
	// The highway's middle stretch bridged 50 to 60 units along, a collapsed span east of the compound, a pass, and a dam.
	const network: RoadNetwork = {
		...SMALL_NETWORK,
		stretches: SMALL_NETWORK.stretches.map((stretch, id) => (id === 1 ? { ...stretch, bridges: [{ start: 50, end: 60 }] } : stretch)),
		broken: [{ roadClass: 'highway', from: 0, to: 4, length: 300, points: [100, 0, 400, 0], bridges: [], street: false }],
		passes: [{ x: -200, y: 200 }],
	};
	const dams = [{ x: -300, y: -100, towardX: 1, towardY: 0 }];
	const detailed = (options: AreaMapViewOptions = {}) => mountView({ map: { terrain: flatTerrain({ radius: RADIUS }), network, rivers: NO_RIVERS, dams }, ...options });

	it('draws a bridge\'s parapets either side of its deck, flared, over the road, once zoomed in far enough', () => {
		const { view, frame } = detailed();
		view.camera.zoom = 1;
		view.camera.center = { x: 0, y: 150 };
		frame();
		const commands = frame();
		const parapets = commands.filter((command): command is PolylineCommand => command.kind === 'polyline' && command.id === 'map.road_1' && sameColour(command.color, BRIDGE.color));
		expect(parapets).toHaveLength(2);
		const pixel = roadWidthScale(1);
		const offset = ((ROAD_STYLES.highway.casing?.width ?? 0) / 2 + BRIDGE.gap + BRIDGE.width / 2) * pixel;
		// The deck runs north from world y 150 to 160, map space y -150 to -160: a parapet each side, flared out at both ends.
		const xs = parapets.map((parapet) => parapet.points[1].x).sort((a, b) => a - b);
		expect(xs[0]).toBeCloseTo(-offset, 9);
		expect(xs[1]).toBeCloseTo(offset, 9);
		for (const parapet of parapets) {
			expect(parapet.points).toHaveLength(4);
			expect(Math.abs(parapet.points[0].x)).toBeGreaterThan(offset);
			expect(parapet.points[1].y).toBeCloseTo(-150, 9);
			expect(parapet.points[2].y).toBeCloseTo(-160, 9);
		}
		const ids = commands.map((command) => command.id);
		expect(ids.lastIndexOf('map.road_1')).toBeGreaterThan(ids.lastIndexOf('map.road_2'));

		// A map large enough to zoom out past the detail zoom: no bridges there.
		const large = mountView({ map: { terrain: flatTerrain({ radius: 1600 }), network, rivers: NO_RIVERS } });
		expect(large.view.camera.zoom).toBeLessThan(ROAD_DETAIL_ZOOM);
		large.frame();
		expect(large.frame().filter((command) => command.kind === 'polyline' && sameColour(command.color, BRIDGE.color))).toHaveLength(0);
	});

	it('draws a collapsed span as highway either side of a gap, with a red cross over it, and not under the fog', () => {
		const { view, frame } = detailed();
		frame();
		const commands = frame();
		const span = commands.filter((command) => command.id === 'map.broken_0');
		// Casing, casing, fill, fill, and the cross's two strokes.
		expect(span.map((command) => command.kind)).toEqual(['polyline', 'polyline', 'polyline', 'polyline', 'line', 'line']);
		const [west, east] = span.slice(0, 2) as PolylineCommand[];
		// Cut at the zoom step the dashes are built at, as wide as the gap on screen near enough.
		const step = 2 ** (Math.round(Math.log2(view.camera.zoom) * DASH_ZOOM_STEPS) / DASH_ZOOM_STEPS);
		const gap = BROKEN_SPAN.gap * roadWidthScale(step) / step;
		expect(west.points[west.points.length - 1].x).toBeCloseTo(250 - gap / 2, 9);
		expect(east.points[0].x).toBeCloseTo(250 + gap / 2, 9);
		const cross = span[4] as LineCommand;
		expect([...cross.color]).toEqual([...BROKEN_SPAN.cross.color]);
		expect((cross.from.x + cross.to.x) / 2).toBeCloseTo(250, 9);

		// Fogged at its middle: not drawn.
		view.fog = { cells: 2, isRevealed: (column) => column === 0 };
		expect(frame().some((command) => command.id === 'map.broken_0')).toBe(false);
	});

	it('marks each pass with a chevron and each dam across its river, neither under the fog', () => {
		const { view, frame } = detailed();
		frame();
		const commands = frame();
		const [pass] = commands.filter((command): command is PolylineCommand => command.id === 'map.pass_0');
		const at = view.camera.worldToScreen(-200, 200);
		expect(pass.points.map(({ x, y }) => [x - at.x, y - at.y])).toEqual([
			[-PASS_MARK.half, PASS_MARK.rise / 2],
			[0, -PASS_MARK.rise / 2],
			[PASS_MARK.half, PASS_MARK.rise / 2],
		]);
		const dam = commands.find((command): command is LineCommand => command.kind === 'line' && sameColour(command.color, DAM_STYLE.color));
		// The river leaves east, so the dam runs north and south across it, in map space.
		expect(dam?.from.x).toBeCloseTo(-300, 9);
		expect(dam?.to.x).toBeCloseTo(-300, 9);
		expect(Math.abs((dam?.to.y ?? 0) - (dam?.from.y ?? 0))).toBeCloseTo(DAM_STYLE.length / view.camera.zoom, 9);

		view.fog = { cells: 2, isRevealed: () => false };
		const fogged = frame();
		expect(fogged.some((command) => command.id === 'map.pass_0')).toBe(false);
		expect(fogged.some((command) => command.kind === 'line' && sameColour(command.color, DAM_STYLE.color))).toBe(false);
	});
});

/**
 * The QA probes from the view's first PR (#176), each pinning a behaviour
 * no other test would catch a change to.
 */
describe('AreaMapView probes', () => {
	it('selects nothing for a click released outside its box, though pressed inside', () => {
		const onSelect = jest.fn();
		// A POI at the view's right edge, 597 pixels into its 600.
		const mounted = mountView({ onSelect });
		const edge = mounted.view.camera.screenToWorld(597, 300);
		mounted.view.markers = [{ id: 'edge', kind: 'poi', x: edge.x, y: edge.y }];
		// Pressed on the marker, released 3 pixels right, outside the box but inside the drag threshold.
		send(mounted.context, [pointer('down', 697, 350), pointer('up', 700.5, 350)]);
		expect(mounted.view.selection).toBeNull();
		expect(onSelect).not.toHaveBeenCalled();
		// The same press released inside selects it.
		send(mounted.context, [pointer('down', 697, 350), pointer('up', 698, 350)]);
		expect(mounted.view.selection).toEqual({ kind: 'marker', id: 'edge' });
	});

	it('counts what it culls itself as the groups it would have drawn, so drawn and culled add up wherever the camera is', () => {
		// Every kind of road group: cased stretches, a stub's dashes, a trail's dashes, a bridge's parapets, and a collapsed span.
		const network: RoadNetwork = {
			...SMALL_NETWORK,
			stretches: [
				...SMALL_NETWORK.stretches.map((stretch, id) => (id === 1 ? { ...stretch, bridges: [{ start: 50, end: 60 }] } : stretch)),
				{ roadClass: 'trail', from: 4, to: 3, length: Math.hypot(200, 100), points: [200, 400, 0, 500], bridges: [], street: false },
			],
			broken: [{ roadClass: 'highway', from: 3, to: 4, length: 200, points: [-200, 450, 0, 450], bridges: [], street: false }],
		};
		const states: RoadKnowledge[] = ['charted', 'charted', 'charted', 'uncharted', 'charted'];
		const { view, context, frame } = mountView({ map: { terrain: flatTerrain({ radius: RADIUS }), network, rivers: NO_RIVERS }, knowledge: { knowledgeOf: (stretch) => states[stretch] } });
		const culled = jest.spyOn(context.draw, 'cullGroups');
		view.camera.zoom = 1;
		expect(view.camera.zoom).toBeGreaterThanOrEqual(ROAD_DETAIL_ZOOM);
		view.camera.center = { x: 0, y: 300 };
		const asked = (): number => {
			culled.mockClear();
			const drawn = frame().filter((command) => /^map\.(road|broken)_\d+$/.test(command.id ?? '')).length;
			return drawn + culled.mock.calls.reduce((sum, [groups]) => sum + groups, 0);
		};
		const whole = asked();
		expect(culled).not.toHaveBeenCalled();
		// Panned south at the same zoom: the bridge, the stub, the trail, and the span are all out of view.
		view.camera.center = { x: 0, y: -250 };
		expect(asked()).toBe(whole);
		expect(culled).toHaveBeenCalled();
	});

	it('builds dashes again only when the zoom crosses a step, DASH_ZOOM_STEPS a doubling', () => {
		const states: RoadKnowledge[] = ['charted', 'charted', 'uncharted', 'uncharted'];
		const { view, frame } = mountView({ knowledge: { knowledgeOf: (stretch) => states[stretch] } });
		const built = jest.spyOn(roadGeometry, 'dashesAlong');
		const stub = () => roads(frame()).filter((road) => road.id === 'map.road_2');
		view.camera.zoom = 2 ** (-8 / DASH_ZOOM_STEPS);
		const first = stub();
		const builds = built.mock.calls.length;
		expect(builds).toBeGreaterThan(0);
		// Within the step, the same dashes, not built again.
		view.camera.zoom *= 2 ** (0.3 / DASH_ZOOM_STEPS);
		expect(stub().map((dash) => dash.points)).toEqual(first.map((dash) => dash.points));
		expect(built.mock.calls.length).toBe(builds);
		// Past it, rebuilt shorter in the world, the same length on screen.
		view.camera.zoom = 2 ** (-7 / DASH_ZOOM_STEPS);
		const next = stub();
		expect(built.mock.calls.length).toBeGreaterThan(builds);
		const length = (dash: PolylineCommand) => Math.hypot(dash.points[1].x - dash.points[0].x, dash.points[1].y - dash.points[0].y);
		expect(length(next[0]) * 2 ** (-7 / DASH_ZOOM_STEPS)).toBeCloseTo(length(first[0]) * 2 ** (-8 / DASH_ZOOM_STEPS), 9);
		built.mockRestore();
	});

	it('goes back to the last fit with the 0 key, a framed rect rather than the whole disc', () => {
		const { view, context } = mountView();
		context.focus.focus(view);
		view.camera.fit({ x: 0, y: 0, width: 200, height: 200 });
		const framed = view.camera.zoom;
		const restore = jest.spyOn(view.camera, 'restoreFit');
		view.camera.zoom = framed * 3;
		view.camera.panBy(40, 40);
		send(context, [key('0')]);
		expect(restore).toHaveBeenCalledTimes(1);
		expect(view.camera.zoom).toBeCloseTo(framed, 12);
		expect(view.camera.center).toEqual({ x: 100, y: 100 });
	});

	it('draws nothing in a box of no area, and keeps a zoom under 0.75 a box of no area is given', () => {
		const { view, frame } = mountView({ width: 0 });
		expect(frame()).toEqual([]);
		view.camera.zoom = 0.4;
		expect(view.camera.zoom).toBe(0.4);
		view.camera.fit({ x: -100, y: -100, width: 200, height: 200 });
		// No area to fit to: the zoom stays where it was.
		expect(view.camera.zoom).toBe(0.4);
		// A rect of no area fits at zoom 1, not at a zoom its size can't give.
		const sized = mountView();
		sized.view.camera.zoom = 0.6;
		sized.view.camera.fit({ x: 50, y: 50, width: 0, height: 0 });
		expect(sized.view.camera.zoom).toBe(1);
		expect(sized.view.camera.center).toEqual({ x: 50, y: 50 });
	});
});
