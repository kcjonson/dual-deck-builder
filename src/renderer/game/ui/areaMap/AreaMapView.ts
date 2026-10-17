import { Component, ComponentOptions } from '../../../engine/components/Component';
import type { MountContext } from '../../../engine/components/MountContext';
import { DrawApi, RGBA, Rect, TextureHandle, Vec2, triangulatePolygon } from '../../../engine/draw';
import { dragThreshold } from '../../../engine/input/DragService';
import type { AnyUiEvent, UiKeyEvent, UiPointerEvent, UiWheelEvent } from '../../../engine/input/events';
import { Settlement, ruinsOf } from '../../map/Places';
import { ROAD_CLASSES, RoadClass } from '../../map/RoadNetwork';
import {
	BRIDGE,
	BROKEN_SPAN,
	COMPOUND,
	DAM_STYLE,
	FOG,
	LABELS,
	LABEL_LAYOUT,
	LAND_COLOURS,
	LabelStyle,
	MAP_GROUND,
	MARKER,
	NIGHT_RING,
	PASS_MARK,
	POI_GLYPH,
	POI_GLYPHS,
	RIVER_STYLE,
	ROAD_DETAIL_ZOOM,
	ROAD_PICK_DISTANCE,
	ROAD_STYLES,
	ROUTE_BAND,
	ROUTE_STOP,
	RUMORED_FADE,
	RUMORED_TOWARD,
	SELECTED_ROAD,
	UNCHARTED_STUB,
	roadReach,
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
	MapRoute,
	MapRouteStop,
	RoadKnowledge,
	RoadKnowledgeLayer,
	drawnKnowledge,
	stubEnd,
} from './layers';
import { MapCamera } from './MapCamera';
import { BESIDE, LabelBox, LabelLayout, LabelSide } from './mapLabels';
import { RiverGeometry } from './riverGeometry';
import { RoadGeometry, dashesAlong, detailLevel, distanceToPolyline, lengthOf, offsetPolyline, slicePolyline, truncatePolyline } from './roadGeometry';
import { bakeTerrain, terrainBakeSize } from './terrainBake';

/**
 * Draws a generated area map as a page of a road atlas (Area Map
 * Generation, Rendering: the road atlas; area-map-atlas-style.md): the
 * terrain, its lakes, and the towns' built-up patches baked once into a
 * texture over paper; rivers live under the roads, width by size, and the
 * reservoirs' dams; a POI's routes as bands under the roads; the roads live
 * by class and knowledge, cased, with their bridges, collapsed spans, and
 * passes; Home's star, POIs' circled glyphs, and strongholds' diamonds; then
 * every name on a paper halo, placed by priority clear of the symbols and of
 * each other, and dropped where none fits; and land fog, with pan, zoom, and
 * selection. Shared by the Map Lab (DDB-299), the area map screen (DDB-43),
 * and the run route screen; the inputs later generation stages fill in are
 * in `layers.ts`.
 *
 * Everything is one component drawing through the draw API, so a map is a
 * few groups per road and one GPU draw per flush (R5.1, R5.20): the baked
 * terrain and fog are two images, and every road, symbol, and label shares
 * the uber shader's one program. World-space layers draw under the camera's
 * matrix, so a pan or a zoom rebuilds nothing; symbols and labels draw in
 * screen space at a constant size. The drawing is clipped to the view's box
 * (R4.1).
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
	routes?: readonly MapRoute[];
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
/** Dashes, trails' and stubs', are rebuilt at zoom steps this fine (8 a doubling), so a wheel zoom doesn't rebuild them every frame. */
export const DASH_ZOOM_STEPS = 8;

const TERRAIN_LABEL = 'area map terrain';
const FOG_LABEL = 'area map fog';
/** An uncharted stub's last dash keeps this much of its class's alpha. */
const STUB_FADE_FLOOR = 0.15;
const FOG_WASH: RGBA = [FOG.color[0] / 255, FOG.color[1] / 255, FOG.color[2] / 255, FOG.alpha];
const CLEAR: RGBA = [0, 0, 0, 0];
/** Drawing order: trails, then back roads, then highways, so the widest lie on top. */
const CLASS_ORDER: readonly RoadClass[] = [...ROAD_CLASSES].reverse();
/** Home's star, outer and inner points alternating from the top, about the origin. */
const STAR = starPoints(COMPOUND.outer, COMPOUND.inner);
const STAR_HALO = starPoints(COMPOUND.outer + COMPOUND.haloOuter, COMPOUND.inner + COMPOUND.haloInner);
const HOME_SIDES: readonly LabelSide[] = ['below', 'right', 'left', 'above'];
const METRO_SIDES: readonly LabelSide[] = ['above', 'below'];
const STAR_INDICES = triangulatePolygon(STAR);

/** Each class's fill and casing on a rumored road: opaque, so its joints don't darken. */
const RUMORED_STYLES = Object.fromEntries(
	ROAD_CLASSES.map((roadClass) => {
		const style = ROAD_STYLES[roadClass];
		return [roadClass, {
			color: mixed(style.color, RUMORED_TOWARD, RUMORED_FADE),
			casing: style.casing ? mixed(style.casing.color, RUMORED_TOWARD, RUMORED_FADE) : null,
		}];
	}),
) as { readonly [Name in RoadClass]: { readonly color: RGBA; readonly casing: RGBA | null } };

/** A dash in map space, with its colour: a trail's, or an uncharted stub's fading out. */
interface Dash {
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

/** A route as drawn: its line in map space and the box round it. */
interface RouteLine {
	readonly route: MapRoute;
	readonly points: readonly Vec2[];
	readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** A bridge's deck: its stretch, and the piece of road it spans in map space. */
interface Deck {
	readonly stretch: number;
	readonly points: readonly Vec2[];
}

/** A label this frame places: its text, style, and box, and the name its draws go by. Kept from frame to frame and refilled. */
interface PlacedLabel {
	text: string;
	style: LabelStyle;
	box: LabelBox;
	part: string;
	/** Over the fog: set light on a dark halo. */
	fogged: boolean;
}

/** A collapsed span's length and middle, worked out once a map. */
interface BrokenSpan {
	readonly length: number;
	readonly middle: Vec2 | null;
}

export class AreaMapView extends Component {
	private mapData: AreaMapData | null = null;
	private geometry: RoadGeometry | null = null;
	private rivers: RiverGeometry | null = null;
	/** Per class, its stretch ids. */
	private classStretches: { readonly [Name in RoadClass]: readonly number[] } = { highway: [], backRoad: [], trail: [] };
	/** Every stretch id in drawing order, for picking: a tie goes to the road drawn on top. */
	private drawOrder: number[] = [];
	private stretchIds: string[] = [];
	/** Every bridge's deck, worked out once a map. */
	private decks: readonly Deck[] = [];
	/** Each deck's two parapets at `dashZoom`, built when first drawn there. */
	private parapets: (readonly (readonly Vec2[])[] | undefined)[] = [];
	private brokenSpans: readonly BrokenSpan[] = [];
	/** Each collapsed span's two pieces either side of its gap at `dashZoom`. */
	private brokenPieces: (readonly (readonly Vec2[])[] | undefined)[] = [];
	/** Towns and villages biggest first, the order their names are placed in. */
	private settlementOrder: { readonly towns: readonly Settlement[]; readonly villages: readonly Settlement[] } = { towns: [], villages: [] };
	private markerList: readonly MapMarker[] = [];
	/** The markers' labels in the order they're placed, worked out when the markers or the selection change. */
	private labelOrder: readonly MapMarker[] | null = null;
	/** The labels the last frame placed, for `drawnText`; stale (`textPlaced` false) until a frame after anything that moves them. */
	private readonly placedText: string[] = [];
	private textPlaced = false;
	private readonly labelLayout = new LabelLayout();
	/** This frame's labels, placed before any is drawn: the first `planned` of them. */
	private readonly labelPlan: PlacedLabel[] = [];
	private planned = 0;
	private routeLines: readonly RouteLine[] = [];
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
	/** Trails' and uncharted stubs' dashes at `dashZoom`; a zoom changes their world length, a pan doesn't. */
	private readonly dashCache = new Map<number, Dash[]>();
	private dashZoom = 0;
	/** Measured label widths, by style, then text. */
	private readonly labelWidths = new Map<LabelStyle, Map<string, number>>();
	private readonly scratch: Vec2 = { x: 0, y: 0 };
	private readonly homeScratch: Vec2 = { x: 0, y: 0 };

	constructor({ map = null, markers = [], routes = [], knowledge = null, fog = null, layers, selection = null, onSelect = null, ...options }: AreaMapViewOptions = {}) {
		super({ focusable: true, ...options });
		this.componentType = 'AreaMapView';
		this.mapCamera = new MapCamera({ radius: map?.terrain.radius ?? 1, width: this.width, height: this.height });
		this.markerList = markers;
		this.routes = routes;
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
		this.labelOrder = null;
		this.textPlaced = false;
		this.bakeTerrainTexture();
	}

	public get markers(): readonly MapMarker[] {
		return this.markerList;
	}

	public set markers(markers: readonly MapMarker[]) {
		this.markerList = markers;
		this.labelOrder = null;
		this.textPlaced = false;
	}

	/** A POI's routes, drawn under the roads; none when empty. */
	public get routes(): readonly MapRoute[] {
		return this.routeLines.map(({ route }) => route);
	}

	public set routes(routes: readonly MapRoute[]) {
		this.routeLines = routes.map((route) => routeLine(route));
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
		this.textPlaced = false;
		this.bakeFogTexture();
	}

	public get layers(): AreaMapLayerToggles {
		return this.layerToggles;
	}

	/** Merged over the current toggles: `{ fog: false }` turns the fog off and leaves the rest. */
	public set layers(layers: Partial<AreaMapLayerToggles>) {
		this.layerToggles = { ...this.layerToggles, ...layers };
		this.textPlaced = false;
	}

	public get selection(): AreaMapSelection | null {
		return this.currentSelection;
	}

	/** Programmatic: fires no `onSelect`. */
	public set selection(selection: AreaMapSelection | null) {
		this.currentSelection = selection;
		this.labelOrder = null;
		this.textPlaced = false;
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
			this.classStretches = { highway: [], backRoad: [], trail: [] };
			this.drawOrder = [];
			this.stretchIds = [];
			this.decks = [];
			this.parapets = [];
			this.brokenSpans = [];
			this.brokenPieces = [];
			this.settlementOrder = { towns: [], villages: [] };
			return;
		}
		const network = map.network;
		const geometry = new RoadGeometry({ network });
		this.geometry = geometry;
		this.rivers = new RiverGeometry({ rivers: map.rivers, radius: map.terrain.radius });
		const ofClass = (roadClass: RoadClass) => network.stretches.flatMap((stretch, id) => (stretch.roadClass === roadClass ? [id] : []));
		this.classStretches = { highway: ofClass('highway'), backRoad: ofClass('backRoad'), trail: ofClass('trail') };
		this.drawOrder = CLASS_ORDER.flatMap((roadClass) => this.classStretches[roadClass]);
		const prefix = this.id ?? 'area_map';
		this.stretchIds = network.stretches.map((_stretch, id) => `${prefix}.road_${id}`);
		this.decks = network.stretches.flatMap((stretch, id) => stretch.bridges.map(({ start, end }) => ({ stretch: id, points: slicePolyline(geometry.stretches[id].points, start, end) })))
			.filter((deck) => deck.points.length >= 2);
		this.parapets = [];
		this.brokenSpans = geometry.broken.map(({ points }) => {
			const length = lengthOf(points);
			return { length, middle: slicePolyline(points, length / 2, length)[0] ?? null };
		});
		this.brokenPieces = [];
		this.settlementOrder = { towns: bySize(map.places?.towns ?? []), villages: bySize(map.places?.villages ?? []) };
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
		const ruins = map.places ? ruinsOf(map.places) : [];
		const bake = (): Uint8Array => bakeTerrain({ terrain, size, ruins });
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

	/**
	 * The text it draws itself, for the tree snapshot and the text record
	 * (DDB-206): POIs' glyphs, and the labels the last frame placed, or
	 * before the first every label it might place.
	 */
	public get drawnText(): readonly string[] | null {
		if (!this.mapData) return null;
		const labels: string[] = [];
		if (this.layerToggles.markers) {
			for (const marker of this.markerList) {
				const glyph = glyphOf(marker);
				if (glyph) labels.push(glyph);
			}
		}
		if (this.textPlaced) {
			labels.push(...this.placedText);
			return labels;
		}
		labels.push(COMPOUND.label);
		if (this.layerToggles.markers) for (const marker of this.markerList) if (marker.label) labels.push(marker.label);
		const { places, metroName } = this.mapData;
		if (this.layerToggles.places) {
			if (metroName) labels.push(capitals(metroName, LABELS.metro));
			if (places) for (const settlement of [...places.towns, ...places.villages]) if (!this.fogged(settlement.x, settlement.y)) labels.push(settlement.name);
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
			this.drawRoutes(draw);
			if (layers.roads) this.drawRoads(draw, this.geometry);
			draw.popTransform();
			if (layers.roads && this.mapCamera.zoom >= ROAD_DETAIL_ZOOM) this.drawPasses(draw);
			// Every label is placed before any is drawn, so the gameplay's go first.
			this.planLabels(draw);
			this.drawCompound(draw);
			if (layers.markers) this.drawMarkers(draw);
			this.drawLabels(draw);
			// Over the labels, so no label hides a stop.
			this.drawRouteStops(draw);
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
	 * on screen, faint past the rim, simplified by zoom as the roads are;
	 * then each reservoir's dam across its river.
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
		const pixel = 1 / zoom;
		for (const dam of this.mapData?.dams ?? []) {
			if (this.fogged(dam.x, dam.y)) continue;
			// Square across the river, in map space (y down).
			const half = (DAM_STYLE.length / 2) * pixel;
			const acrossX = dam.towardY * half;
			const acrossY = dam.towardX * half;
			draw.drawLine({ from: { x: dam.x - acrossX, y: -dam.y - acrossY }, to: { x: dam.x + acrossX, y: -dam.y + acrossY }, color: DAM_STYLE.color, width: DAM_STYLE.width * pixel, cap: 'butt' });
		}
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

	/**
	 * A POI's routes as bands under the roads, the others first and the
	 * picked one over them, at widths that scale with the roads'.
	 */
	private drawRoutes(draw: DrawApi): void {
		if (this.routeLines.length === 0) return;
		const zoom = this.mapCamera.zoom;
		const pixel = roadWidthScale(zoom) / zoom;
		const visible = this.visibleMap();
		let skipped = 0;
		for (const picked of [false, true]) {
			const style = picked ? ROUTE_BAND.picked : ROUTE_BAND.other;
			const width = style.width * pixel;
			for (const line of this.routeLines) {
				if (line.route.picked !== picked) continue;
				const { bounds } = line;
				if (bounds.maxX < visible.minX - width || bounds.minX > visible.maxX + width
					|| bounds.maxY < visible.minY - width || bounds.minY > visible.maxY + width) {
					skipped += 1;
					continue;
				}
				draw.drawPolyline({ id: this.part(`route_${line.route.id}`), points: line.points, color: style.color, width, cap: 'round' });
			}
		}
		if (skipped > 0) draw.cullGroups(skipped);
	}

	/** The picked route's stops, in screen space at a constant size: a fight a diamond, anything else a square. */
	private drawRouteStops(draw: DrawApi): void {
		const camera = this.mapCamera;
		const { half, ink, paper, border } = ROUTE_STOP;
		for (const { route } of this.routeLines) {
			if (!route.picked || !route.stops) continue;
			route.stops.forEach((stop: MapRouteStop, index: number) => {
				const at = camera.worldToScreen(stop.x, stop.y, this.scratch);
				const id = this.part(`route_${route.id}_stop_${index}`);
				if (stop.fight) {
					draw.drawPolygon({ id, points: diamond(at, half), indices: DIAMOND_INDICES, fill: ink });
				} else {
					draw.drawRect({ id, rect: { x: at.x - half, y: at.y - half, width: half * 2, height: half * 2 }, fill: paper, border: { color: ink, width: border, position: 'inside' } });
				}
			});
		}
	}

	/**
	 * The roads by class (Rendering: the road atlas), each class's casings
	 * under its fills: trails dashed, then back roads on their pale edges,
	 * then highways in their dark casing, so a highway's casing runs over
	 * the roads it meets; a selected stretch's highlight under them all.
	 * Rumored roads are paler and uncharted ones fading stubs. Then the
	 * collapsed spans, and every drawn road's bridges over the lot.
	 */
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
					? truncatePolyline(this.stubPoints(selected), UNCHARTED_STUB.length)
					: geometry.polyline(selected, level);
				draw.drawPolyline({ id: this.part('selected_road'), points, color: SELECTED_ROAD.color, width: SELECTED_ROAD.width * pixel, cap: 'round' });
			}
		}

		const shown: { id: number; drawn: RoadKnowledge }[] = [];
		for (const roadClass of CLASS_ORDER) {
			const style = ROAD_STYLES[roadClass];
			shown.length = 0;
			for (const id of this.classStretches[roadClass]) {
				const drawn = drawnKnowledge(network, knowledge, id);
				if (drawn === null) continue;
				const bounds = geometry.stretches[id].bounds;
				if (bounds.maxX < visible.minX - reach || bounds.minX > visible.maxX + reach
					|| bounds.maxY < visible.minY - reach || bounds.minY > visible.maxY + reach) {
					// What it would have asked for: a group a dash, or its casing and fill.
					skipped += drawn === 'uncharted' ? this.stubDashes(id).length : style.dash ? this.trailDashes(id, drawn).length : style.casing ? 2 : 1;
					continue;
				}
				shown.push({ id, drawn });
			}
			if (style.casing) {
				for (const { id, drawn } of shown) {
					if (drawn === 'uncharted') continue;
					const color = drawn === 'rumored' ? RUMORED_STYLES[roadClass].casing ?? style.casing.color : style.casing.color;
					draw.drawPolyline({ id: this.stretchIds[id], points: geometry.polyline(id, level), color, width: style.casing.width * pixel, cap: 'round' });
				}
			}
			for (const { id, drawn } of shown) {
				const width = style.width * pixel;
				if (drawn === 'uncharted' || style.dash) {
					const dashes = drawn === 'uncharted' ? this.stubDashes(id) : this.trailDashes(id, drawn);
					for (const dash of dashes) draw.drawPolyline({ id: this.stretchIds[id], points: dash.points, color: dash.color, width });
					continue;
				}
				const color = drawn === 'rumored' ? RUMORED_STYLES[roadClass].color : style.color;
				draw.drawPolyline({ id: this.stretchIds[id], points: geometry.polyline(id, level), color, width, cap: 'round' });
			}
		}

		skipped += this.drawBrokenSpans(draw, geometry, pixel);
		if (zoom >= ROAD_DETAIL_ZOOM) skipped += this.drawBridges(draw, pixel);
		// R4.2a: what the view skipped itself still counts as asked for and culled.
		if (skipped > 0) draw.cullGroups(skipped);
	}

	/**
	 * Collapsed highway spans: casing and fill either side of a gap at the
	 * span's middle, with a red cross over the gap. Not under the fog, and
	 * not driven, so knowledge doesn't hide one. Returns the groups culled.
	 */
	private drawBrokenSpans(draw: DrawApi, geometry: RoadGeometry, pixel: number): number {
		const style = ROAD_STYLES.highway;
		const casing = style.casing ?? { color: style.color, width: style.width };
		const visible = this.visibleMap();
		const reach = casing.width * pixel;
		const { cross, gap } = BROKEN_SPAN;
		let skipped = 0;
		const step = this.dashStep();
		const stepPixel = roadWidthScale(step) / step;
		geometry.broken.forEach(({ points, bounds }, index) => {
			const { length, middle } = this.brokenSpans[index];
			if (!middle || this.fogged(middle.x, -middle.y)) return;
			if (bounds.maxX < visible.minX - reach || bounds.minX > visible.maxX + reach
				|| bounds.maxY < visible.minY - reach || bounds.minY > visible.maxY + reach) {
				// Its casing and fill each side of the gap, and the cross's two strokes.
				skipped += 6;
				return;
			}
			let pieces = this.brokenPieces[index];
			if (!pieces) {
				const half = Math.min(length / 2, (gap / 2) * stepPixel);
				pieces = [slicePolyline(points, 0, length / 2 - half), slicePolyline(points, length / 2 + half, length)];
				this.brokenPieces[index] = pieces;
			}
			const id = this.part(`broken_${index}`);
			for (const piece of pieces) draw.drawPolyline({ id, points: piece, color: casing.color, width: casing.width * pixel, cap: 'butt' });
			for (const piece of pieces) draw.drawPolyline({ id, points: piece, color: style.color, width: style.width * pixel, cap: 'butt' });
			const arm = cross.half * pixel;
			draw.drawLine({ id, from: { x: middle.x - arm, y: middle.y - arm }, to: { x: middle.x + arm, y: middle.y + arm }, color: cross.color, width: cross.width * pixel, cap: 'round' });
			draw.drawLine({ id, from: { x: middle.x - arm, y: middle.y + arm }, to: { x: middle.x + arm, y: middle.y - arm }, color: cross.color, width: cross.width * pixel, cap: 'round' });
		});
		return skipped;
	}

	/**
	 * Each bridge on a drawn road as parapets either side of its deck, just
	 * outside the road's widest line, flared outward at the ends. Returns the
	 * groups culled.
	 */
	private drawBridges(draw: DrawApi, pixel: number): number {
		const map = this.mapData;
		if (!map || this.decks.length === 0) return 0;
		const network = map.network;
		const knowledge = this.knowledgeLayer ?? ALL_CHARTED;
		const visible = this.visibleMap();
		const step = this.dashStep();
		const stepPixel = roadWidthScale(step) / step;
		const reach = BRIDGE.reach * pixel;
		let skipped = 0;
		this.decks.forEach((deck, index) => {
			const drawn = drawnKnowledge(network, knowledge, deck.stretch);
			if (drawn === null || drawn === 'uncharted') return;
			const first = deck.points[0];
			if (first.x < visible.minX - reach || first.x > visible.maxX + reach || first.y < visible.minY - reach || first.y > visible.maxY + reach) {
				// A parapet each side.
				skipped += 2;
				return;
			}
			let sides = this.parapets[index];
			if (!sides) {
				const offset = (roadReach(ROAD_STYLES[network.stretches[deck.stretch].roadClass]) / 2 + BRIDGE.gap + BRIDGE.width / 2) * stepPixel;
				sides = [parapet(deck.points, offset, BRIDGE.flare * stepPixel), parapet(deck.points, -offset, BRIDGE.flare * stepPixel)];
				this.parapets[index] = sides;
			}
			for (const side of sides) draw.drawPolyline({ id: this.stretchIds[deck.stretch], points: side, color: BRIDGE.color, width: BRIDGE.width * pixel, cap: 'butt' });
		});
		return skipped;
	}

	/** Each pass as a chevron in screen space, where it isn't under the fog. */
	private drawPasses(draw: DrawApi): void {
		const passes = this.mapData?.network.passes ?? [];
		const { half, rise, color, width } = PASS_MARK;
		passes.forEach((pass, index) => {
			if (this.fogged(pass.x, pass.y)) return;
			const at = this.mapCamera.worldToScreen(pass.x, pass.y, this.scratch);
			if (at.x < -half || at.y < -rise || at.x > this.width + half || at.y > this.height + rise) return;
			draw.drawPolyline({
				id: this.part(`pass_${index}`),
				points: [{ x: at.x - half, y: at.y + rise / 2 }, { x: at.x, y: at.y - rise / 2 }, { x: at.x + half, y: at.y + rise / 2 }],
				color,
				width,
				cap: 'round',
			});
		});
	}

	/** A trail's dashes along its whole length, plain or rumored, built again when the zoom moves a step. */
	private trailDashes(id: number, drawn: RoadKnowledge): readonly Dash[] {
		const zoom = this.dashStep();
		const key = -(id + 1) * 2 - (drawn === 'rumored' ? 1 : 0);
		let dashes = this.dashCache.get(key);
		if (!dashes) {
			const style = ROAD_STYLES[this.mapData?.network.stretches[id].roadClass ?? 'trail'];
			const pattern = style.dash ?? { dash: 4, gap: 3 };
			const color = drawn === 'rumored' ? RUMORED_STYLES.trail.color : style.color;
			const points = this.geometry?.stretches[id].points ?? [];
			dashes = dashesAlong(points, Infinity, pattern.dash / zoom, pattern.gap / zoom).map((dash) => ({ points: dash.points, color }));
			this.dashCache.set(key, dashes);
		}
		return dashes;
	}

	/**
	 * An uncharted stretch's dashed stub, fading out along its first
	 * `UNCHARTED_STUB.length` world units: dashes a constant length on
	 * screen, near enough, so built again when the zoom moves a step and kept
	 * while it doesn't.
	 */
	private stubDashes(id: number): readonly Dash[] {
		const zoom = this.dashStep();
		const points = this.stubPoints(id);
		// Keyed by the end too, since the knowledge can move a stub to the other.
		const key = points === this.geometry?.stretches[id].points ? 2 * id : 2 * id + 1;
		let dashes = this.dashCache.get(key);
		if (!dashes) {
			const roadClass = this.mapData?.network.stretches[id].roadClass ?? 'trail';
			const color = ROAD_STYLES[roadClass].color;
			dashes = dashesAlong(points, UNCHARTED_STUB.length, UNCHARTED_STUB.dash / zoom, UNCHARTED_STUB.gap / zoom).map((dash) => ({
				points: dash.points,
				color: [color[0], color[1], color[2], color[3] * (1 - (1 - STUB_FADE_FLOOR) * dash.along)] as RGBA,
			}));
			this.dashCache.set(key, dashes);
		}
		return dashes;
	}

	/** The zoom dashes, parapets, and broken spans' pieces are built at: the camera's, in steps of `DASH_ZOOM_STEPS` a doubling; a new step drops all of them. */
	private dashStep(): number {
		const zoom = 2 ** (Math.round(Math.log2(this.mapCamera.zoom) * DASH_ZOOM_STEPS) / DASH_ZOOM_STEPS);
		if (zoom !== this.dashZoom) {
			this.dashCache.clear();
			this.parapets.length = 0;
			this.brokenPieces.length = 0;
			this.dashZoom = zoom;
		}
		return zoom;
	}

	/** An uncharted stretch's polyline from the end where it leaves known road. */
	private stubPoints(id: number): readonly Vec2[] {
		const geometry = this.geometry;
		const map = this.mapData;
		if (!geometry || !map) return [];
		return geometry.fromEnd(id, stubEnd(map.network, this.knowledgeLayer ?? ALL_CHARTED, id) ?? 'from');
	}

	/** Home: a star in ink on a paper halo, at the origin. */
	private drawCompound(draw: DrawApi): void {
		const at = this.mapCamera.worldToScreen(0, 0, this.scratch);
		const id = this.part('compound');
		draw.drawPolygon({ id, points: STAR_HALO.map((point) => ({ x: at.x + point.x, y: at.y + point.y })), indices: STAR_INDICES, fill: COMPOUND.halo });
		draw.drawPolygon({ id, points: STAR.map((point) => ({ x: at.x + point.x, y: at.y + point.y })), indices: STAR_INDICES, fill: COMPOUND.fill });
	}

	/** Whether the fog, drawn, hides the land at (x, y). */
	private fogged(x: number, y: number): boolean {
		const fog = this.fogLayer;
		if (!fog || !this.layerToggles.fog) return false;
		const radius = this.mapCamera.radius;
		const side = (radius * 2) / fog.cells;
		const column = Math.floor((x + radius) / side);
		const row = Math.floor((y + radius) / side);
		if (column < 0 || row < 0 || column >= fog.cells || row >= fog.cells) return true;
		return !fog.isRevealed(column, row);
	}

	/**
	 * Markers: a stronghold a diamond; a POI a circled glyph, in ink while
	 * unvisited, greyed once looted, and filled grey and struck through once
	 * depleted; a night ring round a POI with no way home by dark, and the
	 * selection ring round the selected one.
	 */
	private drawMarkers(draw: DrawApi): void {
		const camera = this.mapCamera;
		const selectedId = this.currentSelection?.kind === 'marker' ? this.currentSelection.id : null;
		for (const marker of this.markerList) {
			const at = camera.worldToScreen(marker.x, marker.y, this.scratch);
			const radius = markerRadius(marker);
			const id = this.part(`marker_${marker.id}`);
			if (marker.id === selectedId) {
				const outside = marker.kind === 'poi' && marker.pastDark ? NIGHT_RING.gap + NIGHT_RING.width : 0;
				draw.drawCircle({ id, center: at, radius: radius + outside + MARKER.ring * 2.5, fill: CLEAR, border: { color: SELECTED_ROAD.color, width: MARKER.ring * 2 } });
			}
			if (marker.kind === 'stronghold') {
				const { half, fill, border, edge } = MARKER.stronghold;
				draw.drawPolygon({ id, points: diamond(at, half + edge), indices: DIAMOND_INDICES, fill: border });
				draw.drawPolygon({ id, points: diamond(at, half), indices: DIAMOND_INDICES, fill });
				continue;
			}
			if (marker.pastDark) {
				draw.drawCircle({ id, center: at, radius: radius + NIGHT_RING.gap + NIGHT_RING.width / 2, fill: CLEAR, border: { color: NIGHT_RING.color, width: NIGHT_RING.width } });
			}
			const state = marker.state ?? 'unvisited';
			const ink = state === 'unvisited' ? MARKER.ink : MARKER.spent;
			draw.drawCircle({ id, center: at, radius, fill: state === 'depleted' ? MARKER.spent : MARKER.fill, border: { color: ink, width: MARKER.ring } });
			const glyph = glyphOf(marker);
			if (glyph) {
				draw.drawText({
					id: this.part(`glyph_${marker.id}`),
					text: glyph,
					box: { x: at.x - radius, y: at.y - radius, width: radius * 2, height: radius * 2 },
					font: POI_GLYPH.font,
					size: POI_GLYPH.size,
					color: state === 'depleted' ? MARKER.fill : ink,
					align: 'center',
					verticalAlign: 'middle',
				});
			}
			if (state === 'depleted') {
				const arm = radius * MARKER.strike;
				draw.drawLine({ id, from: { x: at.x - arm, y: at.y + arm }, to: { x: at.x + arm, y: at.y - arm }, color: MARKER.ink, width: MARKER.ring, cap: 'round' });
			}
		}
	}

	/**
	 * Where this frame's labels go, before any is drawn (Rendering: the road
	 * atlas; Dressing: placed by priority with collision boxes). Home's star,
	 * the picked route's stops, and every marker are blocked first, as
	 * symbols no label may cover; then Home's label; then the markers' labels
	 * in their order (`markerLabelOrder`), the selected one placed whatever
	 * was there if it has no clear spot; then the metro's name, the towns'
	 * biggest first, and the villages'. A label with no clear spot is left
	 * out until the zoom makes room. Where text can't be measured nothing can
	 * be placed clear, so every label is drawn.
	 */
	private planLabels(draw: DrawApi): void {
		const camera = this.mapCamera;
		const layout = this.labelLayout;
		this.planned = 0;
		layout.reset(this.width, this.height, draw.canMeasureText(LABELS.poi.font));
		const place = (text: string, style: LabelStyle, x: number, y: number, radius: number, part: string, sides: readonly LabelSide[] = BESIDE, anyway = false, fogged = false): void => {
			const box = layout.placeBeside({ x, y, radius, width: this.labelWidth(draw, text, style), height: labelHeight(style), sides, anyway });
			if (!box) return;
			let entry = this.labelPlan[this.planned];
			if (!entry) {
				entry = { text, style, box, part, fogged };
				this.labelPlan.push(entry);
			}
			entry.text = text;
			entry.style = style;
			entry.box = box;
			entry.part = part;
			entry.fogged = fogged;
			this.planned += 1;
		};

		const home = camera.worldToScreen(0, 0, this.homeScratch);
		layout.block(home.x - COMPOUND.outer, home.y - COMPOUND.outer, COMPOUND.outer * 2, COMPOUND.outer * 2);
		const { half } = ROUTE_STOP;
		for (const { route } of this.routeLines) {
			if (!route.picked || !route.stops) continue;
			for (const stop of route.stops) {
				const at = camera.worldToScreen(stop.x, stop.y, this.scratch);
				layout.block(at.x - half - 1, at.y - half - 1, half * 2 + 2, half * 2 + 2);
			}
		}
		const markers = this.layerToggles.markers;
		if (markers) {
			for (const marker of this.markerList) {
				const at = camera.worldToScreen(marker.x, marker.y, this.scratch);
				const radius = markerExtent(marker);
				layout.block(at.x - radius, at.y - radius, radius * 2, radius * 2);
			}
		}

		place(COMPOUND.label, LABELS.home, home.x, home.y, COMPOUND.outer, 'compound_label', HOME_SIDES);

		if (markers) {
			const selectedId = this.currentSelection?.kind === 'marker' ? this.currentSelection.id : null;
			for (const marker of this.markerLabelOrder()) {
				const style = marker.kind === 'stronghold' ? LABELS.stronghold : LABELS.poi;
				const at = camera.worldToScreen(marker.x, marker.y, this.scratch);
				place(marker.label as string, style, at.x, at.y, markerExtent(marker), `label_${marker.id}`, BESIDE, marker.id === selectedId, this.fogged(marker.x, marker.y));
			}
		}

		const map = this.mapData;
		if (map && this.layerToggles.places) {
			if (map.metroName) place(capitals(map.metroName, LABELS.metro), LABELS.metro, home.x, home.y, COMPOUND.outer + labelHeight(LABELS.home), 'metro_label', METRO_SIDES);
			const { share, town, village } = LABEL_LAYOUT.place;
			for (const [settlements, style, most] of [[this.settlementOrder.towns, LABELS.town, town], [this.settlementOrder.villages, LABELS.village, village]] as const) {
				for (const settlement of settlements) {
					if (this.fogged(settlement.x, settlement.y)) continue;
					const at = camera.worldToScreen(settlement.x, settlement.y, this.scratch);
					place(settlement.name, style, at.x, at.y, Math.min(settlement.radius * camera.zoom * share, most), `place_${settlement.id}_label`);
				}
			}
		}
		this.placedText.length = 0;
		for (let index = 0; index < this.planned; index++) this.placedText.push(this.labelPlan[index].text);
		this.textPlaced = true;
	}

	/** The labels `planLabels` placed, each on its paper halo, or light on the fog's dark over the fog. */
	private drawLabels(draw: DrawApi): void {
		const { halo, fogged: overFog } = LABEL_LAYOUT;
		for (let index = 0; index < this.planned; index++) {
			const { text, style, box, part, fogged } = this.labelPlan[index];
			draw.drawText({
				id: this.part(part),
				text,
				box: { x: box.x, y: box.y, width: Math.max(box.width, 1), height: box.height },
				font: style.font,
				size: style.size,
				color: fogged ? overFog.color : style.color,
				letterSpacing: style.letterSpacing,
				verticalAlign: 'middle',
				shadow: { color: fogged ? overFog.halo : halo.color, blur: halo.blur },
			});
		}
	}

	/** The selected marker's label first, then by priority, then in the markers' order: those with labels only. */
	private markerLabelOrder(): readonly MapMarker[] {
		if (this.labelOrder) return this.labelOrder;
		const selectedId = this.currentSelection?.kind === 'marker' ? this.currentSelection.id : null;
		const labelled = this.markerList.filter((marker) => marker.label);
		const place = new Map(labelled.map((marker, index) => [marker, index]));
		const rank = (marker: MapMarker): number => (marker.id === selectedId ? -Infinity : marker.priority ?? 0);
		this.labelOrder = [...labelled].sort((a, b) => rank(a) - rank(b) || (place.get(a) ?? 0) - (place.get(b) ?? 0));
		return this.labelOrder;
	}

	/** Measured once per string and style (R2.14); 0 where the backend can't measure. */
	private labelWidth(draw: DrawApi, text: string, style: LabelStyle): number {
		let widths = this.labelWidths.get(style);
		if (!widths) {
			widths = new Map();
			this.labelWidths.set(style, widths);
		}
		const known = widths.get(text);
		if (known !== undefined) return known;
		if (!draw.canMeasureText(style.font)) return 0;
		const width = Math.ceil(draw.measureText({ text, font: style.font, size: style.size, letterSpacing: style.letterSpacing }).width);
		widths.set(text, width);
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
				const reach = (ROAD_PICK_DISTANCE + (roadReach(ROAD_STYLES[network.stretches[id].roadClass]) * scale) / 2) / zoom;
				const { bounds } = stretch;
				if (mapX < bounds.minX - reach || mapX > bounds.maxX + reach || mapY < bounds.minY - reach || mapY > bounds.maxY + reach) continue;
				const drawn = drawnKnowledge(network, knowledge, id);
				if (drawn === null) continue;
				const distance = drawn === 'uncharted'
					? distanceToPolyline(this.stubPoints(id), mapX, mapY, UNCHARTED_STUB.length)
					: distanceToPolyline(stretch.points, mapX, mapY, Infinity);
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

/** A marker's extent from its centre: a POI's disc, or a stronghold's diamond with its edge. */
function markerRadius(marker: MapMarker): number {
	return marker.kind === 'stronghold' ? MARKER.stronghold.half + MARKER.stronghold.edge : MARKER.radius;
}

/** A marker's extent with its night ring, what labels keep clear of. */
function markerExtent(marker: MapMarker): number {
	return markerRadius(marker) + (marker.kind === 'poi' && marker.pastDark ? NIGHT_RING.gap + NIGHT_RING.width : 0);
}

/** A POI's glyph by its type; none for a stronghold or a type without one. */
function glyphOf(marker: MapMarker): string | undefined {
	return marker.kind === 'poi' && marker.type ? POI_GLYPHS[marker.type] : undefined;
}

/** A label's text as its style sets it. */
function capitals(text: string, style: LabelStyle): string {
	return style.capitals ? text.toUpperCase() : text;
}

function labelHeight(style: LabelStyle): number {
	return Math.ceil(style.size * LABEL_LAYOUT.lineHeight);
}

/** Settlements biggest first, ties in their order, so the bigger of two crowded places keeps its name. */
function bySize(settlements: readonly Settlement[]): Settlement[] {
	return settlements.map((settlement, index) => ({ settlement, index }))
		.sort((a, b) => b.settlement.radius - a.settlement.radius || a.index - b.index)
		.map(({ settlement }) => settlement);
}

/** A five-pointed star about the origin, its first point straight up (screen space, y down). */
function starPoints(outer: number, inner: number): Vec2[] {
	return Array.from({ length: 10 }, (_, index) => {
		const radius = index % 2 === 0 ? outer : inner;
		const angle = -Math.PI / 2 + (index * Math.PI) / 5;
		return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
	});
}

/** A diamond `half` from its centre to each point. */
function diamond(at: Vec2, half: number): Vec2[] {
	return [{ x: at.x, y: at.y - half }, { x: at.x + half, y: at.y }, { x: at.x, y: at.y + half }, { x: at.x - half, y: at.y }];
}

const DIAMOND_INDICES = [0, 1, 2, 0, 2, 3];

/**
 * One parapet of a bridge: the deck `offset` to one side (left of the way
 * it runs for a positive offset), each end flared `flare` further along and
 * further out.
 */
export function parapet(deck: readonly Vec2[], offset: number, flare: number): Vec2[] {
	const side = offsetPolyline(deck, offset);
	const last = side.length - 1;
	const flared = (end: number, next: number): Vec2 => {
		const at = side[end];
		const alongX = at.x - side[next].x;
		const alongY = at.y - side[next].y;
		const along = Math.hypot(alongX, alongY) || 1;
		const outX = at.x - deck[end].x;
		const outY = at.y - deck[end].y;
		const out = Math.hypot(outX, outY) || 1;
		return { x: at.x + ((alongX / along + outX / out) * flare), y: at.y + ((alongY / along + outY / out) * flare) };
	};
	return [flared(0, 1), ...side, flared(last, last - 1)];
}

/** A route's line in map space, y flipped from the world's, and the box round it. */
function routeLine(route: MapRoute): RouteLine {
	const points: Vec2[] = [];
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (let index = 0; index + 1 < route.points.length; index += 2) {
		const x = route.points[index];
		const y = -route.points[index + 1];
		points.push({ x, y });
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	return { route, points, bounds: { minX, minY, maxX, maxY } };
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

