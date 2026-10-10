import { HighwayDeparture, planHighways } from './Highways';
import type { MapParams } from './MapParams';
import { AcceptHook, MapPipeline, MapStage, PipelineReplay, PipelineResult, StageAttempt } from './MapPipeline';
import { checkPoiLayer } from './PoiChecks';
import { PoiGround, PoiLayer, placePois } from './Pois';
import { checkRoadNetwork } from './RoadChecks';
import { GROWTH_TUNING, GrowthTuning, RoadGrowth, growRoads } from './RoadGrowth';
import type { RoadNetwork } from './RoadNetwork';
import { RouteTree, buildRouteTree } from './RouteTree';
import { Terrain, generateTerrain } from './Terrain';
import { Water, generateWater } from './Water';

/**
 * The area map's stages as they stand: terrain, water, then the highways
 * and growth pair, stand-ins until settlements and road links (Map 7 and 8)
 * replace them, then the route tree and the POIs over growth's network. Each
 * runs on the stream the runner nests for it, so water draws from
 * root.fork('map', m).fork('terrain', t).fork('water', w), the highways one
 * level further down, growth one more, and so on; the route tree takes no
 * draws, but it's a link in the chain all the same.
 */

export interface AreaMapProducts {
	/** The land, without water. */
	readonly terrain: Terrain;
	/** Rivers, lakes, and the fields beside them; `water.terrain` is the land with its water, what every stage after reads. */
	readonly water: Water;
	readonly highways: readonly HighwayDeparture[];
	readonly growth: RoadGrowth;
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

export const HIGHWAYS_STAGE: MapStage<MapParams, Pick<AreaMapProducts, 'terrain' | 'water'>, 'highways', readonly HighwayDeparture[]> = {
	name: 'highways',
	run: ({ input, products, rng }) => planHighways({ terrain: products.water.terrain, params: input, rng }),
};

/** Growth with its own knobs, over the land with its water, checked by the network checks the map validator will run. */
export function growthStage(tuning: GrowthTuning = {}): MapStage<MapParams, Pick<AreaMapProducts, 'water' | 'highways'>, 'growth', RoadGrowth> {
	const { branchiness, clearance = GROWTH_TUNING.clearance } = tuning;
	return {
		name: 'growth',
		run: ({ input, products, rng }) => growRoads({ terrain: products.water.terrain, params: input, highways: products.highways, rng, branchiness, clearance }),
		check: ({ network }, { products }) => checkRoadNetwork({ network, terrain: products.water.terrain, clearance })
			.map(({ rule, detail }) => `${rule}: ${detail}`),
	};
}

/** What the route tree reads: the road network. */
interface RoadsProduct {
	readonly growth: { readonly network: RoadNetwork };
}

/** Stage 6, the route tree. It takes no draws, so one attempt: another would only repeat it. */
export const ROUTE_TREE_STAGE: MapStage<MapParams, RoadsProduct, 'routeTree', RouteTree> = {
	name: 'routeTree',
	attempts: 1,
	run: ({ input, products }) => buildRouteTree({ network: products.growth.network, travelPace: input.travelPace, routeSplit: input.routeSplit }),
};

export interface PoisStageOptions {
	/**
	 * Hold the layer to every guarantee it keeps: a sector without a
	 * stronghold, or a first ring that doesn't yield food, water, and fuel,
	 * fails the stage, and past its attempts it escalates to the roads. Off
	 * until the road links and the road graph (Map 7 and 8) replace growth,
	 * whose roads are trees with no meeting points; then the layer reports
	 * what it missed in `failures` and the map goes on without it.
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
		escalate: strict ? 'growth' : undefined,
		run: ({ input, products, rng }) => placePois({ network: products.growth.network, tree: products.routeTree, ground: products.water.terrain, params: input, rng }),
		check: (layer, { input, products }) => {
			const violations = checkPoiLayer({ network: products.growth.network, tree: products.routeTree, layer, params: input, radius: products.water.terrain.radius })
				.filter(({ rule }) => strict || rule !== 'sectors')
				.map(({ rule, detail }) => `${rule}: ${detail}`);
			return strict ? [...layer.failures, ...violations] : violations;
		},
	};
}

export interface AreaMapPipelineOptions {
	/** Growth's own knobs. */
	readonly growth?: GrowthTuning;
	readonly pois?: PoisStageOptions;
}

/** Adding, removing, or renaming a stage here bumps `AREA_MAP_GENERATOR_VERSION` (GeneratorVersion.ts). */
export function areaMapPipeline({ growth, pois }: AreaMapPipelineOptions = {}): MapPipeline<MapParams, AreaMapProducts> {
	return new MapPipeline<MapParams>()
		.stage(TERRAIN_STAGE)
		.stage(WATER_STAGE)
		.stage(HIGHWAYS_STAGE)
		.stage(growthStage(growth))
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
	readonly growth?: GrowthTuning;
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
export function generateAreaMap({ params, growth, accept, onProgress, debug, replay }: AreaMapOptions): AreaMapGeneration {
	return { ...areaMapPipeline({ growth }).run({ seed: params.seed, input: params, accept, onProgress, debug, replay }), params };
}
