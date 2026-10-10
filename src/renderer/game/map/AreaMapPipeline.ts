import type { MapParams } from './MapParams';
import { AcceptHook, MapPipeline, MapStage, PipelineResult, StageAttempt } from './MapPipeline';
import { checkPoiLayer } from './PoiChecks';
import { PoiGround, PoiLayer, placePois } from './Pois';
import { checkRoadNetwork } from './RoadChecks';
import type { RoadNetwork } from './RoadNetwork';
import { Roads, generateRoads, roadsProblems, standInPlaces } from './Roads';
import { RouteTree, buildRouteTree } from './RouteTree';
import { Terrain, generateTerrain } from './Terrain';
import { Water, generateWater } from './Water';

/**
 * The area map's stages as they stand: terrain, water, the roads, then the
 * route tree and the POIs over the roads' network. Each runs on the stream
 * the runner nests for it, so water draws from
 * root.fork('map', m).fork('terrain', t).fork('water', w), the roads one
 * level further down, and so on; the route tree takes no draws, but it's a
 * link in the chain all the same.
 */

export interface AreaMapProducts {
	/** The land, without water. */
	readonly terrain: Terrain;
	/** Rivers, lakes, and the fields beside them; `water.terrain` is the land with its water, what every stage after reads. */
	readonly water: Water;
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

/**
 * Stage 5, the roads (Maps 7 and 8), over the land with its water, joining
 * the places that stand in for the places stage (Map 6) until it lands. It
 * fails when a place has no road or the roads close too few loops for the
 * POIs, and on the network checks the map validator will run.
 */
export const ROADS_STAGE: MapStage<MapParams, Pick<AreaMapProducts, 'water'>, 'roads', Roads> = {
	name: 'roads',
	run: ({ input, products, rng }) => {
		const terrain = products.water.terrain;
		return generateRoads({ terrain, rivers: products.water.lines, params: input, places: standInPlaces({ terrain, params: input, rng }), rng });
	},
	check: (roads, { input, products }) => [
		...roadsProblems(roads, input),
		...checkRoadNetwork({ network: roads.network, terrain: products.water.terrain }).map(({ rule, detail }) => `${rule}: ${detail}`),
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
	 * fails the stage, and past its attempts it escalates to the roads. The
	 * game's pipeline runs strict; off, the layer reports what it missed in
	 * `failures` and the map goes on without it.
	 */
	readonly strict?: boolean;
}

/** What the POIs read besides the roads: the land with its water, and the route tree. */
interface PoisUpstream extends RoadsProduct {
	readonly water: { readonly terrain: PoiGround };
	readonly routeTree: RouteTree;
}

/** Stage 7, strongholds and POIs on the route tree's meeting points, checked by the checks the map validator will run. */
export function poisStage({ strict = false }: PoisStageOptions = {}): MapStage<MapParams, PoisUpstream, 'pois', PoiLayer> {
	return {
		name: 'pois',
		escalate: strict ? 'roads' : undefined,
		run: ({ input, products, rng }) => placePois({ network: products.roads.network, tree: products.routeTree, ground: products.water.terrain, params: input, rng }),
		check: (layer, { input, products }) => {
			const violations = checkPoiLayer({ network: products.roads.network, tree: products.routeTree, layer, params: input, radius: products.water.terrain.radius })
				.filter(({ rule }) => strict || rule !== 'sectors')
				.map(({ rule, detail }) => `${rule}: ${detail}`);
			return strict ? [...layer.failures, ...violations] : violations;
		},
	};
}

export interface AreaMapPipelineOptions {
	/** Strict unless told otherwise. */
	readonly pois?: PoisStageOptions;
}

export function areaMapPipeline({ pois = { strict: true } }: AreaMapPipelineOptions = {}): MapPipeline<MapParams, AreaMapProducts> {
	return new MapPipeline<MapParams>()
		.stage(TERRAIN_STAGE)
		.stage(WATER_STAGE)
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
}

/**
 * The area map as far as the stages go today, in-process. The generation
 * worker runs this. Throws a MapPipelineError when every map attempt on the
 * seed fails; founding answers that with the next seed (map-pipeline-worker.md).
 */
export function generateAreaMap({ params, pois, accept, onProgress, debug }: AreaMapOptions): AreaMapGeneration {
	return { ...areaMapPipeline({ pois }).run({ seed: params.seed, input: params, accept, onProgress, debug }), params };
}
