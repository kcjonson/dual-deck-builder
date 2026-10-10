import { Component, ComponentOptions } from '../../../engine/components/Component';
import type { MountContext } from '../../../engine/components/MountContext';
import type { DrawApi, RGBA, Rect, TextureHandle, Vec2 } from '../../../engine/draw';
import { dragThreshold } from '../../../engine/input/DragService';
import type { AnyUiEvent, UiKeyEvent, UiPointerEvent, UiWheelEvent } from '../../../engine/input/events';
import { ROAD_CLASSES, RoadClass } from '../../map/RoadNetwork';
import {
	COMPOUND,
	JUNCTION,
	LABEL,
	MAP_GROUND,
	MARKER,
	RIVER_STYLE,
	ROAD_PICK_DISTANCE,
	ROAD_STYLES,
	RUMORED_FADE,
	RUMORED_TOWARD,
	SELECTED_ROAD,
	UNCHARTED_STUB,
	LAND_COLOURS,
	FOG,
	roadWidthScale,
} from './areaMapStyle';
import { bakeFog } from './fogBake';
import {
	ALL_CHARTED,
	ALL_LAYERS,
	AreaMapData,
	AreaMapLayerToggles,
	AreaMapSelection,
	LandFogLayer,
	MapMarker,
	RoadKnowledgeLayer,
	drawnKnowledge,
} from './layers';
import { MapCamera } from './MapCamera';
import { RiverGeometry } from './riverGeometry';
import { RoadGeometry, dashesAlong, detailLevel, distanceToPolyline, truncatePolyline } from './roadGeometry';
import { bakeTerrain, terrainBakeSize } from './terrainBake';

/**
 * Draws a generated area map: the terrain and its lakes baked once into a
 * texture, rivers live under the roads, width by size, the drivable roads
 * live by class and knowledge, junctions, the compound, POI and stronghold
 * markers, and land fog, with pan, zoom, and selection.
 * Shared by the Map Lab (DDB-299) and the area map screen (DDB-43); the
 * inputs later generation stages fill in are in `layers.ts`.
 *
 * Everything is one component drawing through the draw API, so a map is a
 * handful of groups per road and one GPU draw per flush (R5.1, R5.20): the
 * baked terrain and fog are two images, and every road, junction, and marker
 * shares the uber shader's one program. World-space layers draw under the
 * camera's matrix, so a pan or a zoom rebuilds nothing; markers and labels
 * draw in screen space at a constant size. The drawing is clipped to the
 * view's box (R4.1).
 *
 * Input (chapter 9): a drag pans, the wheel zooms about the pointer (R9.32:
 * the view takes the wheel while it can still zoom that way), a click
 * selects the marker or road under it, and with focus the arrows pan, `+`
 * and `-` zoom, and `0` goes back to the last fit.
 *
 * A selection outlives changes to the markers, the knowledge, and the
 * layers: it's drawn whenever what it names is drawn. Only a new map clears
 * it, since its stretch ids name other roads there.
 */

export interface AreaMapViewOptions extends ComponentOptions {
	map?: AreaMapData | null;
	markers?: readonly MapMarker[];
	knowledge?: RoadKnowledgeLayer | null;
	fog?: LandFogLayer | null;
	layers?: Partial<AreaMapLayerToggles>;
	selection?: AreaMapSelection | null;
	/** Fired after a press changes the selection (R8.25); never for a property set. */
	onSelect?: ((selection: AreaMapSelection | null) => void) | null;
}

/** Zoom per logical pixel of wheel: a 100-pixel notch is about 0.86x or 1.16x. */
export const WHEEL_ZOOM_RATE = 0.0015;
/** A `+` or `-` press. */
export const KEY_ZOOM_FACTOR = 1.25;
/** An arrow press pans this share of the view's smaller side. */
export const KEY_PAN_SHARE = 0.15;

const TERRAIN_LABEL = 'area map terrain';
const FOG_LABEL = 'area map fog';
/** An uncharted stub's last dash keeps this much of its class's alpha. */
const STUB_FADE_FLOOR = 0.15;
/** Stub dashes are rebuilt at zoom steps this fine (8 a doubling), so a wheel zoom doesn't rebuild them every frame. */
const DASH_ZOOM_STEPS = 8;
const FOG_WASH: RGBA = [FOG.color[0] / 255, FOG.color[1] / 255, FOG.color[2] / 255, FOG.alpha];

/** Each class's colour on a rumored road: opaque, so its joints don't darken. */
const RUMORED_COLOURS = Object.fromEntries(
	ROAD_CLASSES.map((roadClass) => [roadClass, mixed(ROAD_STYLES[roadClass].color, RUMORED_TOWARD, RUMORED_FADE)]),
) as { readonly [Name in RoadClass]: RGBA };

/** A dash of an uncharted stub, in map space, with its faded colour. */
interface StubDash {
	readonly points: readonly Vec2[];
	readonly color: RGBA;
}

interface Press {
	pointerId: number;
	startX: number;
	startY: number;
	lastX: number;
	lastY: number;
	threshold: number;
	dragging: boolean;
}

interface Baked {
	texture: TextureHandle;
	size: number;
}

export class AreaMapView extends Component {
	private mapData: AreaMapData | null = null;
	private geometry: RoadGeometry | null = null;
	private rivers: RiverGeometry | null = null;
	/** Stretch ids in drawing order: trails, then back roads, then highways, so the widest lie on top. */
	private drawOrder: number[] = [];
	private stretchIds: string[] = [];
	private markerList: readonly MapMarker[] = [];
	private knowledgeLayer: RoadKnowledgeLayer | null = null;
	private fogLayer: LandFogLayer | null = null;
	private layerToggles: AreaMapLayerToggles = ALL_LAYERS;
	private currentSelection: AreaMapSelection | null = null;
	private selectCallback: ((selection: AreaMapSelection | null) => void) | null = null;
	private readonly mapCamera: MapCamera;

	private terrainTexture: Baked | null = null;
	private fogTexture: Baked | null = null;

	private press: Press | null = null;
	/**
	 * The press that just ended was a pan, so the click the dispatcher
	 * synthesises from it selects nothing: the dispatcher withholds a click
	 * only after a drag-service drag (its departure from R9.31, in
	 * input-dispatcher.md), and this pan is the view's own.
	 */
	private swallowClick = false;
	/** Uncharted stubs' dashes at `dashZoom`; a zoom changes their world length, a pan doesn't. */
	private readonly dashCache = new Map<number, StubDash[]>();
	private dashZoom = 0;
	private readonly labelWidths = new Map<string, number>();
	private readonly scratch: Vec2 = { x: 0, y: 0 };

	constructor({ map = null, markers = [], knowledge = null, fog = null, layers, selection = null, onSelect = null, ...options }: AreaMapViewOptions = {}) {
		super({ focusable: true, ...options });
		this.componentType = 'AreaMapView';
		this.mapCamera = new MapCamera({ radius: map?.terrain.radius ?? 1, width: this.width, height: this.height });
		this.markerList = markers;
		this.knowledgeLayer = knowledge;
		this.fogLayer = fog;
		if (layers) this.layerToggles = { ...ALL_LAYERS, ...layers };
		this.selectCallback = onSelect;
		this.rebuildGeometry(map);
		this.currentSelection = selection;
	}

	// -- inputs --------------------------------------------------------------

	public get map(): AreaMapData | null {
		return this.mapData;
	}

	/**
	 * A new map: rebuilt, rebaked if mounted, and the selection cleared. The
	 * camera fits a map of another radius whole and keeps its view of one the
	 * same size, so a regenerated map stays where it was looked at.
	 */
	public set map(map: AreaMapData | null) {
		this.rebuildGeometry(map);
		this.currentSelection = null;
		this.bakeTerrainTexture();
	}

	public get markers(): readonly MapMarker[] {
		return this.markerList;
	}

	public set markers(markers: readonly MapMarker[]) {
		this.markerList = markers;
	}

	/** Absent, every road is charted. */
	public get knowledge(): RoadKnowledgeLayer | null {
		return this.knowledgeLayer;
	}

	public set knowledge(knowledge: RoadKnowledgeLayer | null) {
		this.knowledgeLayer = knowledge;
	}

	/** Absent, nothing is fogged. Set it again after the fog changes: it's rebaked on every set. */
	public get fog(): LandFogLayer | null {
		return this.fogLayer;
	}

	public set fog(fog: LandFogLayer | null) {
		this.fogLayer = fog;
		this.bakeFogTexture();
	}

	public get layers(): AreaMapLayerToggles {
		return this.layerToggles;
	}

	/** Merged over the current toggles: `{ fog: false }` turns the fog off and leaves the rest. */
	public set layers(layers: Partial<AreaMapLayerToggles>) {
		this.layerToggles = { ...this.layerToggles, ...layers };
	}

	public get selection(): AreaMapSelection | null {
		return this.currentSelection;
	}

	/** Programmatic: fires no `onSelect`. */
	public set selection(selection: AreaMapSelection | null) {
		this.currentSelection = selection;
	}

	public get onSelect(): ((selection: AreaMapSelection | null) => void) | null {
		return this.selectCallback;
	}

	public set onSelect(callback: ((selection: AreaMapSelection | null) => void) | null) {
		this.selectCallback = callback;
	}

	/** Pan and zoom. Fit it to a world rect (`camera.fit`) to frame what's been uncovered. */
	public get camera(): MapCamera {
		this.syncCamera();
		return this.mapCamera;
	}

	private rebuildGeometry(map: AreaMapData | null): void {
		this.mapData = map;
		this.dashCache.clear();
		if (!map) {
			this.geometry = null;
			this.rivers = null;
			this.drawOrder = [];
			this.stretchIds = [];
			return;
		}
		const network = map.network;
		this.geometry = new RoadGeometry({ network });
		this.rivers = map.rivers ? new RiverGeometry({ rivers: map.rivers, radius: map.terrain.radius }) : null;
		const order = [...ROAD_CLASSES].reverse();
		this.drawOrder = order.flatMap((roadClass) => network.stretches.flatMap((stretch, id) => (stretch.roadClass === roadClass ? [id] : [])));
		const prefix = this.id ?? 'area_map';
		this.stretchIds = network.stretches.map((_stretch, id) => `${prefix}.road_${id}`);
		this.mapCamera.radius = map.terrain.radius;
	}

	// -- resources (R2.17, R5.30) -------------------------------------------

	/**
	 * Textures are made on mount, never in the constructor (R8.14); mount
	 * runs outside any frame. The fog first: the upload queue takes the
	 * oldest request first (R5.32), and land showing through a fog not yet
	 * uploaded would be land the player hasn't seen.
	 */
	protected onMount(context: MountContext): void {
		super.onMount(context);
		this.bakeFogTexture();
		this.bakeTerrainTexture();
	}

	protected onUnmount(): void {
		this.release(this.terrainTexture);
		this.release(this.fogTexture);
		this.terrainTexture = null;
		this.fogTexture = null;
		this.press = null;
		this.swallowClick = false;
		super.onUnmount();
	}

	/**
	 * Bakes the map's terrain and uploads it through the metered queue
	 * (R5.32). No CPU copy is kept (R5.33): a lost context bakes it again.
	 */
	private bakeTerrainTexture(): void {
		const draw = this.context?.draw;
		if (!draw) return;
		this.release(this.terrainTexture);
		this.terrainTexture = null;
		const map = this.mapData;
		if (!map) return;
		const terrain = map.terrain;
		const size = terrainBakeSize(terrain.radius);
		const bake = (): Uint8Array => bakeTerrain({ terrain, size });
		const texture = draw.createTexture({ width: size, height: size, label: TERRAIN_LABEL, source: bake(), reload: () => Promise.resolve(bake()) });
		this.terrainTexture = { texture, size };
	}

	private bakeFogTexture(): void {
		const draw = this.context?.draw;
		if (!draw) return;
		this.release(this.fogTexture);
		this.fogTexture = null;
		const fog = this.fogLayer;
		if (!fog) return;
		const { size, texels } = bakeFog({ fog });
		const texture = draw.createTexture({ width: size, height: size, label: FOG_LABEL, source: texels, reload: () => Promise.resolve(bakeFog({ fog }).texels) });
		this.fogTexture = { texture, size };
	}

	private release(baked: Baked | null): void {
		if (baked) this.context?.draw.destroyTexture(baked.texture);
	}

	// -- drawing -------------------------------------------------------------

	/**
	 * Unbounded for the subtree cull's ink audit, which measures each draw
	 * unclipped: roads run past the box when zoomed in, though the view
	 * clips everything it draws to the box (DDB-184).
	 */
	protected get cullInk(): Rect | null {
		return null;
	}

	public get handlesPointer(): boolean {
		return true;
	}

	/** The labels it draws itself, for the tree snapshot and the text record (DDB-206). */
	public get drawnText(): readonly string[] | null {
		if (!this.mapData) return null;
		const labels: string[] = [COMPOUND.label];
		if (this.layerToggles.markers) {
			for (const marker of this.markerList) if (marker.label) labels.push(marker.label);
		}
		return labels;
	}

	public render(draw: DrawApi): void {
		const width = this.width;
		const height = this.height;
		if (width <= 0 || height <= 0) return;
		this.syncCamera();
		const box = { x: 0, y: 0, width, height };
		draw.pushClip(box);
		draw.drawRect({ id: this.part('ground'), rect: box, fill: MAP_GROUND });
		if (this.mapData && this.geometry) {
			const layers = this.layerToggles;
			draw.pushTransform(this.mapCamera.matrix);
			if (layers.terrain) this.drawTerrain(draw);
			if (layers.water) this.drawRivers(draw);
			if (layers.fog) this.drawFog(draw);
			if (layers.roads) this.drawRoads(draw, this.geometry);
			if (layers.junctions) this.drawJunctions(draw, this.geometry);
			draw.popTransform();
			this.drawCompound(draw);
			if (layers.markers) this.drawMarkers(draw);
		}
		draw.popClip();
	}

	private part(name: string): string | undefined {
		return this.id ? `${this.id}.${name}` : undefined;
	}

	private drawTerrain(draw: DrawApi): void {
		const baked = this.terrainTexture;
		const radius = this.mapCamera.radius;
		if (baked && draw.isTextureResident(baked.texture)) {
			this.drawMapImage(draw, baked, 'terrain');
		} else {
			// R12.5's placeholder until the upload lands: the disc in middling ground's colour.
			const [red, green, blue] = LAND_COLOURS.middling;
			draw.drawCircle({ id: this.part('terrain'), center: { x: 0, y: 0 }, radius, fill: [red / 255, green / 255, blue / 255, 1] });
		}
	}

	/**
	 * Each river run at its world width, never under `RIVER_STYLE.minPixels`
	 * on screen, fainter past the rim, simplified by zoom as the roads are.
	 */
	private drawRivers(draw: DrawApi): void {
		const rivers = this.rivers;
		if (!rivers) return;
		const zoom = this.mapCamera.zoom;
		const least = RIVER_STYLE.minPixels / zoom;
		const level = detailLevel(zoom);
		const visible = this.visibleMap();
		let skipped = 0;
		rivers.runs.forEach((run, id) => {
			const width = run.width > least ? run.width : least;
			const { bounds } = run;
			if (bounds.maxX < visible.minX - width || bounds.minX > visible.maxX + width
				|| bounds.maxY < visible.minY - width || bounds.minY > visible.maxY + width) {
				skipped += 1;
				return;
			}
			draw.drawPolyline({ points: rivers.polyline(id, level), color: run.inside ? RIVER_STYLE.color : RIVER_STYLE.outside, width, cap: 'round' });
		});
		// R4.2a: what the view skipped itself still counts as asked for and culled.
		if (skipped > 0) draw.cullGroups(skipped);
	}

	private drawFog(draw: DrawApi): void {
		if (!this.fogLayer) return;
		const baked = this.fogTexture;
		if (baked && draw.isTextureResident(baked.texture)) {
			this.drawMapImage(draw, baked, 'fog');
		} else {
			// R12.5's placeholder until the upload lands: all of it fogged, so
			// nothing shows that the fog would hide.
			draw.drawCircle({ id: this.part('fog'), center: { x: 0, y: 0 }, radius: this.mapCamera.radius, fill: FOG_WASH });
		}
	}

	/**
	 * A texture over the disc's bounding square, cropped to the texels the
	 * view shows, so the quad stays inside the box however far it's zoomed.
	 */
	private drawMapImage(draw: DrawApi, baked: Baked, name: string): void {
		const radius = this.mapCamera.radius;
		const visible = this.visibleMap();
		const texel = (radius * 2) / baked.size;
		const left = Math.max(0, Math.floor((visible.minX + radius) / texel));
		const top = Math.max(0, Math.floor((visible.minY + radius) / texel));
		const right = Math.min(baked.size, Math.ceil((visible.maxX + radius) / texel));
		const bottom = Math.min(baked.size, Math.ceil((visible.maxY + radius) / texel));
		if (right <= left || bottom <= top) return;
		draw.drawImage({
			id: this.part(name),
			texture: baked.texture,
			rect: { x: -radius + left * texel, y: -radius + top * texel, width: (right - left) * texel, height: (bottom - top) * texel },
			sourceRect: { x: left, y: top, width: right - left, height: bottom - top },
		});
	}

	private drawRoads(draw: DrawApi, geometry: RoadGeometry): void {
		const map = this.mapData;
		if (!map) return;
		const network = map.network;
		const knowledge = this.knowledgeLayer ?? ALL_CHARTED;
		const zoom = this.mapCamera.zoom;
		// Local units per screen pixel of width.
		const pixel = roadWidthScale(zoom) / zoom;
		const level = detailLevel(zoom);
		const visible = this.visibleMap();
		const reach = SELECTED_ROAD.width * pixel;
		let skipped = 0;

		const selected = this.currentSelection?.kind === 'stretch' ? this.currentSelection.stretch : -1;
		if (selected >= 0 && selected < network.stretches.length) {
			const drawn = drawnKnowledge(network, knowledge, selected);
			if (drawn !== null) {
				const points = drawn === 'uncharted'
					? truncatePolyline(geometry.stretches[selected].points, UNCHARTED_STUB.length)
					: geometry.polyline(selected, level);
				draw.drawPolyline({ id: this.part('selected_road'), points, color: SELECTED_ROAD.color, width: SELECTED_ROAD.width * pixel, cap: 'round' });
			}
		}

		for (const id of this.drawOrder) {
			const drawn = drawnKnowledge(network, knowledge, id);
			if (drawn === null) continue;
			const bounds = geometry.stretches[id].bounds;
			if (bounds.maxX < visible.minX - reach || bounds.minX > visible.maxX + reach
				|| bounds.maxY < visible.minY - reach || bounds.minY > visible.maxY + reach) {
				// A stub would have asked for a group a dash.
				skipped += drawn === 'uncharted' ? this.stubDashes(id).length : 1;
				continue;
			}
			const roadClass = network.stretches[id].roadClass;
			const width = ROAD_STYLES[roadClass].width * pixel;
			if (drawn === 'uncharted') {
				for (const dash of this.stubDashes(id)) draw.drawPolyline({ id: this.stretchIds[id], points: dash.points, color: dash.color, width });
				continue;
			}
			const color = drawn === 'rumored' ? RUMORED_COLOURS[roadClass] : ROAD_STYLES[roadClass].color;
			draw.drawPolyline({ id: this.stretchIds[id], points: geometry.polyline(id, level), color, width, cap: 'round' });
		}

		// R4.2a: what the view skipped itself still counts as asked for and culled.
		if (skipped > 0) draw.cullGroups(skipped);
	}

	/** A dot at each junction whose inbound road is drawn solid, whether or not the roads layer is on. */
	private drawJunctions(draw: DrawApi, geometry: RoadGeometry): void {
		const map = this.mapData;
		if (!map) return;
		const knowledge = this.knowledgeLayer ?? ALL_CHARTED;
		const zoom = this.mapCamera.zoom;
		const radius = (JUNCTION.radius * roadWidthScale(zoom)) / zoom;
		const visible = this.visibleMap();
		let skipped = 0;
		for (const junction of geometry.junctions) {
			const inbound = drawnKnowledge(map.network, knowledge, junction.inbound);
			if (inbound === null || inbound === 'uncharted') continue;
			const at = junction.at;
			if (at.x < visible.minX - radius || at.x > visible.maxX + radius || at.y < visible.minY - radius || at.y > visible.maxY + radius) {
				skipped += 1;
				continue;
			}
			draw.drawCircle({ center: at, radius, fill: JUNCTION.color });
		}
		if (skipped > 0) draw.cullGroups(skipped);
	}

	/**
	 * An uncharted stretch's dashed stub, fading out along its first
	 * `UNCHARTED_STUB.length` world units: dashes a constant length on
	 * screen, near enough, so built again when the zoom moves a step and kept
	 * while it doesn't.
	 */
	private stubDashes(id: number): readonly StubDash[] {
		const zoom = 2 ** (Math.round(Math.log2(this.mapCamera.zoom) * DASH_ZOOM_STEPS) / DASH_ZOOM_STEPS);
		if (zoom !== this.dashZoom) {
			this.dashCache.clear();
			this.dashZoom = zoom;
		}
		let dashes = this.dashCache.get(id);
		if (!dashes) {
			const roadClass = this.mapData?.network.stretches[id].roadClass ?? 'trail';
			const color = ROAD_STYLES[roadClass].color;
			const points = this.geometry?.stretches[id].points ?? [];
			dashes = dashesAlong(points, UNCHARTED_STUB.length, UNCHARTED_STUB.dash / zoom, UNCHARTED_STUB.gap / zoom).map((dash) => ({
				points: dash.points,
				color: [color[0], color[1], color[2], color[3] * (1 - (1 - STUB_FADE_FLOOR) * dash.along)] as RGBA,
			}));
			this.dashCache.set(id, dashes);
		}
		return dashes;
	}

	private drawCompound(draw: DrawApi): void {
		const at = this.mapCamera.worldToScreen(0, 0, this.scratch);
		const half = COMPOUND.size / 2;
		draw.drawRect({
			id: this.part('compound'),
			rect: { x: at.x - half, y: at.y - half, width: COMPOUND.size, height: COMPOUND.size },
			fill: COMPOUND.fill,
			border: { color: COMPOUND.border, width: 1.5, position: 'outside' },
		});
		this.drawLabel(draw, COMPOUND.label, at.x + half + LABEL.gap, at.y, 'compound_label');
	}

	private drawMarkers(draw: DrawApi): void {
		const camera = this.mapCamera;
		const selectedId = this.currentSelection?.kind === 'marker' ? this.currentSelection.id : null;
		for (const marker of this.markerList) {
			const at = camera.worldToScreen(marker.x, marker.y, this.scratch);
			const radius = marker.kind === 'stronghold' ? MARKER.stronghold : MARKER.radius;
			const id = this.part(`marker_${marker.id}`);
			if (marker.id === selectedId) {
				draw.drawCircle({ id, center: at, radius: radius + MARKER.ring * 2, fill: [0, 0, 0, 0], border: { color: SELECTED_ROAD.color, width: MARKER.ring * 1.5 } });
			}
			if (marker.kind === 'stronghold') {
				draw.drawCircle({ id, center: at, radius, fill: MARKER.fill, border: { color: MARKER.ink, width: MARKER.ring } });
				const diamond = radius * 0.62;
				draw.drawPolygon({
					id,
					points: [{ x: at.x, y: at.y - diamond }, { x: at.x + diamond, y: at.y }, { x: at.x, y: at.y + diamond }, { x: at.x - diamond, y: at.y }],
					indices: [0, 1, 2, 0, 2, 3],
					fill: MARKER.ink,
				});
			} else {
				const state = marker.state ?? 'unvisited';
				const ink = state === 'unvisited' ? MARKER.ink : MARKER.spent;
				draw.drawCircle({ id, center: at, radius, fill: state === 'depleted' ? MARKER.spent : MARKER.fill, border: { color: ink, width: MARKER.ring } });
				if (state === 'looted') {
					const size = radius * 0.5;
					draw.drawPolyline({
						id,
						points: [{ x: at.x - size, y: at.y }, { x: at.x - size * 0.25, y: at.y + size * 0.75 }, { x: at.x + size, y: at.y - size * 0.7 }],
						color: ink,
						width: 1.75,
						cap: 'round',
					});
				}
			}
			if (marker.label) this.drawLabel(draw, marker.label, at.x + radius + LABEL.gap, at.y, `label_${marker.id}`);
		}
	}

	/** A label on a light box, its left edge at `x` and centred on `y`. */
	private drawLabel(draw: DrawApi, text: string, x: number, y: number, name: string): void {
		const width = this.labelWidth(draw, text);
		const box = { x, y: y - LABEL.height / 2, width: width + LABEL.padX * 2, height: LABEL.height };
		if (width > 0) draw.drawRect({ id: this.part(`${name}_box`), rect: box, fill: LABEL.background, radius: 2 });
		draw.drawText({
			id: this.part(name),
			text,
			box: { x: x + LABEL.padX, y: box.y, width: Math.max(width, 1), height: LABEL.height },
			font: LABEL.font,
			size: LABEL.size,
			color: LABEL.color,
			verticalAlign: 'middle',
		});
	}

	/** Measured once per string (R2.14); 0 where the backend can't measure, which draws no box. */
	private labelWidth(draw: DrawApi, text: string): number {
		const known = this.labelWidths.get(text);
		if (known !== undefined) return known;
		if (!draw.canMeasureText(LABEL.font)) return 0;
		const width = Math.ceil(draw.measureText({ text, font: LABEL.font, size: LABEL.size }).width);
		this.labelWidths.set(text, width);
		return width;
	}

	/** The map-space rect the view shows. */
	private visibleMap(): { minX: number; minY: number; maxX: number; maxY: number } {
		const world = this.mapCamera.visibleWorld;
		return { minX: world.x, minY: -(world.y + world.height), maxX: world.x + world.width, maxY: -world.y };
	}

	private syncCamera(): void {
		const camera = this.mapCamera;
		if (camera.width !== this.width || camera.height !== this.height) camera.resize(this.width, this.height);
	}

	// -- picking -------------------------------------------------------------

	/**
	 * What a press at `point`, in the view's content box, selects: the
	 * nearest marker within `MARKER.pickRadius` pixels, else the nearest
	 * drawn road within `ROAD_PICK_DISTANCE` of its edge, else null. Only
	 * what's drawn can be picked: a hidden layer, a stretch the knowledge
	 * hides, or past an uncharted stub's end picks nothing.
	 */
	public pick(point: Vec2): AreaMapSelection | null {
		const map = this.mapData;
		const geometry = this.geometry;
		if (!map || !geometry) return null;
		this.syncCamera();
		const camera = this.mapCamera;
		const layers = this.layerToggles;

		if (layers.markers) {
			let nearest: MapMarker | null = null;
			let nearestDistance: number = MARKER.pickRadius;
			const at = this.scratch;
			for (const marker of this.markerList) {
				camera.worldToScreen(marker.x, marker.y, at);
				const distance = Math.hypot(at.x - point.x, at.y - point.y);
				if (distance <= nearestDistance) {
					nearest = marker;
					nearestDistance = distance;
				}
			}
			if (nearest) return { kind: 'marker', id: nearest.id };
		}

		if (layers.roads) {
			const world = camera.screenToWorld(point.x, point.y);
			const mapX = world.x;
			const mapY = -world.y;
			const zoom = camera.zoom;
			const scale = roadWidthScale(zoom);
			const network = map.network;
			const knowledge = this.knowledgeLayer ?? ALL_CHARTED;
			let nearest = -1;
			let nearestDistance = Infinity;
			// In drawing order, a tie going to the later: the road drawn on top.
			for (const id of this.drawOrder) {
				const stretch = geometry.stretches[id];
				const reach = (ROAD_PICK_DISTANCE + (ROAD_STYLES[network.stretches[id].roadClass].width * scale) / 2) / zoom;
				const { bounds } = stretch;
				if (mapX < bounds.minX - reach || mapX > bounds.maxX + reach || mapY < bounds.minY - reach || mapY > bounds.maxY + reach) continue;
				const drawn = drawnKnowledge(network, knowledge, id);
				if (drawn === null) continue;
				const distance = distanceToPolyline(stretch.points, mapX, mapY, drawn === 'uncharted' ? UNCHARTED_STUB.length : Infinity);
				if (distance <= reach && distance <= nearestDistance) {
					nearest = id;
					nearestDistance = distance;
				}
			}
			if (nearest >= 0) return { kind: 'stretch', stretch: nearest };
		}
		return null;
	}

	// -- input (chapter 9) ---------------------------------------------------

	/** R9.32: the wheel zooms, so the view takes it while it can still zoom that way. */
	public canScroll(_deltaX: number, deltaY: number): boolean {
		if (!this.mapData || deltaY === 0) return false;
		return this.camera.canZoom(wheelFactor(deltaY));
	}

	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		if (event.consumed) return;
		switch (event.type) {
			case 'pointerdown':
				this.pointerDown(event);
				return;
			case 'pointermove':
				this.pointerMove(event);
				return;
			case 'pointerup':
			case 'pointercancel':
			case 'lostpointercapture':
				if (this.press?.pointerId === event.pointerId) {
					this.swallowClick = this.press.dragging;
					this.press = null;
				}
				return;
			case 'click':
				this.clicked(event);
				return;
			case 'wheel':
				this.wheel(event);
				return;
			case 'keydown':
				if (this.key(event)) event.consume();
				return;
		}
	}

	private pointerDown(event: UiPointerEvent): void {
		this.swallowClick = false;
		if (event.button !== 0 || !this.mapData) return;
		const local = event.local;
		if (!local) return;
		event.consume();
		event.capturePointer();
		this.press = {
			pointerId: event.pointerId,
			startX: local.x,
			startY: local.y,
			lastX: local.x,
			lastY: local.y,
			threshold: dragThreshold(event.pointerType),
			dragging: false,
		};
	}

	private pointerMove(event: UiPointerEvent): void {
		const local = event.local;
		if (!local) return;
		const press = this.press;
		if (!press || press.pointerId !== event.pointerId) {
			// Hovering: a pointer over anything a click would select.
			this.cursor = this.pick(local) ? 'pointer' : null;
			return;
		}
		event.consume();
		if (!press.dragging && Math.hypot(local.x - press.startX, local.y - press.startY) < press.threshold) return;
		press.dragging = true;
		this.camera.panBy(local.x - press.lastX, local.y - press.lastY);
		press.lastX = local.x;
		press.lastY = local.y;
	}

	/**
	 * Selects what's under a click. The click that ends a pan selects
	 * nothing (`swallowClick`), and nor does one released outside the box,
	 * where what the pick would find is clipped away.
	 */
	private clicked(event: UiPointerEvent): void {
		const local = event.local;
		if (!local || !this.mapData) return;
		event.consume();
		if (this.swallowClick) {
			this.swallowClick = false;
			return;
		}
		if (!this.containsPoint(local.x, local.y)) return;
		const picked = this.pick(local);
		if (sameSelection(picked, this.currentSelection)) return;
		this.currentSelection = picked;
		this.selectCallback?.(picked);
	}

	private wheel(event: UiWheelEvent): void {
		const local = event.local;
		if (!local || !this.mapData || event.deltaY === 0) return;
		this.camera.zoomAt(wheelFactor(event.deltaY), local.x, local.y);
		event.consume();
	}

	private key(event: UiKeyEvent): boolean {
		if (!this.mapData) return false;
		const { ctrl, meta, alt } = event.modifiers;
		if (ctrl || meta || alt) return false;
		const camera = this.camera;
		const step = Math.min(this.width, this.height) * KEY_PAN_SHARE;
		switch (event.key) {
			case 'ArrowLeft':
				camera.panBy(step, 0);
				return true;
			case 'ArrowRight':
				camera.panBy(-step, 0);
				return true;
			case 'ArrowUp':
				camera.panBy(0, step);
				return true;
			case 'ArrowDown':
				camera.panBy(0, -step);
				return true;
			case '+':
			case '=':
				camera.zoomAt(KEY_ZOOM_FACTOR, this.width / 2, this.height / 2);
				return true;
			case '-':
			case '_':
				camera.zoomAt(1 / KEY_ZOOM_FACTOR, this.width / 2, this.height / 2);
				return true;
			case '0':
				camera.restoreFit();
				return true;
		}
		return false;
	}
}

function wheelFactor(deltaY: number): number {
	return Math.exp(-deltaY * WHEEL_ZOOM_RATE);
}

function sameSelection(a: AreaMapSelection | null, b: AreaMapSelection | null): boolean {
	if (a === null || b === null) return a === b;
	if (a.kind === 'marker') return b.kind === 'marker' && a.id === b.id;
	return b.kind === 'stretch' && a.stretch === b.stretch;
}

function mixed(color: RGBA, toward: RGBA, amount: number): RGBA {
	return [
		color[0] + (toward[0] - color[0]) * amount,
		color[1] + (toward[1] - color[1]) * amount,
		color[2] + (toward[2] - color[2]) * amount,
		color[3],
	];
}

