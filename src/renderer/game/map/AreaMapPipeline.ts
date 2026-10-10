import { Hazards, generateHazards } from './Hazards';
import type { MapParams } from './MapParams';
import { AcceptHook, MapPipeline, MapStage, PipelineReplay, PipelineResult, StageAttempt } from './MapPipeline';
import { Places, checkPlaces, generatePlaces, placeList, ruinAt, ruinsOf } from './Places';
import { checkPoiLayer } from './PoiChecks';
import { PoiGround, PoiLayer, placePois } from './Pois';
import { checkRoadNetwork } from './RoadChecks';
import type { RoadNetwork } from './RoadNetwork';
import { RoadStats, Roads, generateRoads, loopsNeeded, loopsWanted, roadsProblems } from './Roads';
import { RouteTree, buildRouteTree } from './RouteTree';
import { Terrain, generateTerrain } from './Terrain';
import { Water, generateWater } from './Water';

/**
 * The area map's stages as they stand: terrain, water, hazards, places, the
 * roads, then the route tree and the POIs over the roads' network. Each runs
 * on the stream the runner nests for it, so water draws from
 * root.fork('map', m).fork('terrain', t).fork('water', w), hazards one level
 * further down, places one more, and so on; the route tree takes no draws,
 * but it's a link in the chain all the same.
 */

export interface AreaMapProducts {
	/** The land, without water. */
	readonly terrain: Terrain;
	/** Rivers, lakes, and the fields beside them; `water.terrain` is the land with its water. */
	readonly water: Water;
	/** Craters and plumes; `hazards.terrain` is the land with its water and hazards, what every stage after reads. */
	readonly hazards: Hazards;
	/** The metro, towns, villages, crossroads, and exits. */
	readonly places: Places;
	/** The road network, every road on the map, with its stats. */
	readonly roads: Roads;
	readonly routeTree: RouteTree;
	readonly pois: PoiLayer;
}

export type AreaMapStageName = keyof AreaMapProducts;

type NoProducts = Record<never, never>;

/** Stage 1, the land, through terrain's public function alone. */
export const TERRAIN_STAGE: MapStage<MapParams, NoProducts, 'terrain', Terrain> = {
	name: 'terrain',
	run: ({ input, rng }) => generateTerrain({ params: input, rng }),
};

/** Stage 2, rivers and lakes over the land. */
export const WATER_STAGE: MapStage<MapParams, Pick<AreaMapProducts, 'terrain'>, 'water', Water> = {
	name: 'water',
	run: ({ input, products, rng }) => generateWater({ params: input, terrain: products.terrain, rng }),
};

/** Stage 3, hotspots over the land with its water, off the rivers and lakes. */
export const HAZARDS_STAGE: MapStage<MapParams, Pick<AreaMapProducts, 'water'>, 'hazards', Hazards> = {
	name: 'hazards',
	run: ({ input, products, rng }) => generateHazards({ params: input, terrain: products.water.terrain, rng }),
};

/**
 * Stage 4, settlements, crossroads, and exits, checked that a road from the
 * metro surely reaches every one, so an exit with no reachable ground near any
 * turn of its bearings reruns the stage on a fresh draw of them.
 */
export const PLACES_STAGE: MapStage<MapParams, Pick<AreaMapProducts, 'water' | 'hazards'>, 'places', Places> = {
	name: 'places',
	run: ({ input, products, rng }) => generatePlaces({ params: input, terrain: products.hazards.terrain, water: products.water, rng }),
	check: (places, { products }) => checkPlaces({ places, terrain: products.hazards.terrain, water: products.water }),
};

/**
 * Stage 5, the roads (Maps 7 and 8), joining the places over the land with
 * its water and hazards, the metro as the compound. It fails when a place
 * has no road or the roads close too few loops for the POIs, and on the
 * network checks the map validator will run.
 */
export const ROADS_STAGE: MapStage<MapParams, Pick<AreaMapProducts, 'water' | 'hazards' | 'places'>, 'roads', Roads> = {
	name: 'roads',
	run: ({ input, products, rng }) => generateRoads({
		terrain: products.hazards.terrain, rivers: products.water.lines, params: input, places: placeList(products.places), rng,
	}),
	check: (roads, { input, products }) => [
		...roadsProblems(roads, input),
		...checkRoadNetwork({ network: roads.network, terrain: products.hazards.terrain }).map(({ rule, detail }) => `${rule}: ${detail}`),
	],
};

/** What the route tree reads: the road network. */
interface RoadsProduct {
	readonly roads: { readonly network: RoadNetwork };
}

/** Stage 6, the route tree. It takes no draws, so one attempt: another would only repeat it. */
export const ROUTE_TREE_STAGE: MapStage<MapParams, RoadsProduct, 'routeTree', RouteTree> = {
	name: 'routeTree',
	attempts: 1,
	run: ({ input, products }) => buildRouteTree({ network: products.roads.network, travelPace: input.travelPace, routeSplit: input.routeSplit }),
};

export interface PoisStageOptions {
	/**
	 * Hold the layer to every guarantee it keeps: a sector without a
	 * stronghold, or a first ring that doesn't yield food, water, and fuel,
	 * fails the stage, and past its attempts it escalates to the roads. On
	 * unless told otherwise; off, the layer reports what it missed in
	 * `failures` and the map goes on without it.
	 */
	readonly strict?: boolean;
}

/** What the POIs read: the roads and how many places they join, the land with its water and hazards, the places' ruins, and the route tree. */
interface PoisUpstream {
	readonly roads: { readonly network: RoadNetwork; readonly stats: Pick<RoadStats, 'inland' | 'loops'> };
	readonly hazards: { readonly terrain: Omit<PoiGround, 'ruin'> };
	readonly places: Pick<Places, 'metro' | 'towns' | 'villages'>;
	readonly routeTree: RouteTree;
}

/** The ground the POIs read: the land with its water and hazards, and ruin from the metro, towns, and villages. */
export function poiGround({ terrain, places }: { terrain: Omit<PoiGround, 'ruin'>; places: Pick<Places, 'metro' | 'towns' | 'villages'> }): PoiGround {
	const ruins = ruinsOf(places);
	return {
		radius: terrain.radius,
		metro: terrain.metro,
		biome: (x, y) => terrain.biome(x, y),
		elevation: (x, y) => terrain.elevation(x, y),
		moisture: (x, y) => terrain.moisture(x, y),
		ruin: (x, y) => ruinAt(x, y, ruins),
	};
}

/**
 * Stage 7, strongholds and POIs on the route tree's meeting points, checked
 * by the checks the map validator will run. On a map whose places can't
 * close the loops the POIs want (`loopsNeeded`) and whose roads close fewer,
 * no attempt can seat them all, so the stage holds it leniently whatever
 * `strict` says, and the map goes on with what it missed in `failures`.
 * Roads that close the loops wanted keep it strict, so a campaign map, whose
 * roads always do, never loses a stronghold quietly.
 */
export function poisStage({ strict = true }: PoisStageOptions = {}): MapStage<MapParams, PoisUpstream, 'pois', PoiLayer> {
	return {
		name: 'pois',
		escalate: strict ? 'roads' : undefined,
		run: ({ input, products, rng }) => placePois({
			network: products.roads.network, tree: products.routeTree, ground: poiGround({ terrain: products.hazards.terrain, places: products.places }), params: input, rng,
		}),
		check: (layer, { input, products }) => {
			const wanted = loopsWanted(input);
			const { inland, loops } = products.roads.stats;
			const holds = strict && (loopsNeeded(input, inland) >= wanted || loops >= wanted);
			const violations = checkPoiLayer({ network: products.roads.network, tree: products.routeTree, layer, params: input, radius: products.hazards.terrain.radius })
				.filter(({ rule }) => holds || rule !== 'sectors')
				.map(({ rule, detail }) => `${rule}: ${detail}`);
			return holds ? [...layer.failures, ...violations] : violations;
		},
	};
}

export interface AreaMapPipelineOptions {
	/** Strict unless told otherwise. */
	readonly pois?: PoisStageOptions;
}

/** Adding, removing, or renaming a stage here bumps `AREA_MAP_GENERATOR_VERSION` (GeneratorVersion.ts). */
export function areaMapPipeline({ pois = {} }: AreaMapPipelineOptions = {}): MapPipeline<MapParams, AreaMapProducts> {
	return new MapPipeline<MapParams>()
		.stage(TERRAIN_STAGE)
		.stage(WATER_STAGE)
		.stage(HAZARDS_STAGE)
		.stage(PLACES_STAGE)
		.stage(ROADS_STAGE)
		.stage(ROUTE_TREE_STAGE)
		.stage(poisStage(pois));
}

export interface AreaMapGeneration extends PipelineResult<AreaMapProducts> {
	/** The params the map was generated on, its seed among them. */
	readonly params: MapParams;
}

export interface AreaMapOptions {
	/** Resolved and validated. Every stream forks from `params.seed`. */
	readonly params: MapParams;
	/** The POI stage's options; strict unless told otherwise. */
	readonly pois?: PoisStageOptions;
	readonly accept?: AcceptHook<AreaMapProducts>;
	readonly onProgress?: (stage: StageAttempt<AreaMapStageName>) => void;
	/** `__DEV_TOOLS__` when left out. */
	readonly debug?: boolean;
	/** Make again the map a run on these params made, from its map attempt and stage attempts, unchecked. */
	readonly replay?: PipelineReplay;
}

/**
 * The area map as far as the stages go today, in-process. The generation
 * worker runs this. Throws a MapPipelineError when every map attempt on the
 * seed fails; founding answers that with the next seed (map-pipeline-worker.md).
 */
export function generateAreaMap({ params, pois, accept, onProgress, debug, replay }: AreaMapOptions): AreaMapGeneration {
	return { ...areaMapPipeline({ pois }).run({ seed: params.seed, input: params, accept, onProgress, debug, replay }), params };
}
