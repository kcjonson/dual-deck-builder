import { HighwayDeparture, planHighways } from './Highways';
import type { MapParams } from './MapParams';
import { AcceptHook, MapPipeline, MapStage, PipelineReplay, PipelineResult, StageAttempt } from './MapPipeline';
import { checkRoadNetwork } from './RoadChecks';
import { GROWTH_TUNING, GrowthTuning, RoadGrowth, growRoads } from './RoadGrowth';
import { Terrain, generateTerrain } from './Terrain';
import { Water, generateWater } from './Water';

/**
 * The area map's stages as they stand: terrain, water, then the highways
 * and growth pair, stand-ins until settlements and road links (Map 7 and 8)
 * replace them. Each runs on the stream the runner nests for it, so water
 * draws from root.fork('map', m).fork('terrain', t).fork('water', w), the
 * highways one level further down, and growth one more.
 */

/**
 * The generator version a campaign records with its map. 1 was the stand-in
 * campaigns were founded on before the generator existed. A change that
 * makes another map from the same seed, params, and attempts, or adds,
 * removes, or renames a stage, bumps it, and a campaign recorded at another
 * version isn't regenerated (map-pipeline-worker.md, The founding contract).
 */
export const AREA_MAP_GENERATOR_VERSION = 2;

export interface AreaMapProducts {
	/** The land, without water. */
	readonly terrain: Terrain;
	/** Rivers, lakes, and the fields beside them; `water.terrain` is the land with its water, what every stage after reads. */
	readonly water: Water;
	readonly highways: readonly HighwayDeparture[];
	readonly growth: RoadGrowth;
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

export interface AreaMapPipelineOptions {
	/** Growth's own knobs. */
	readonly growth?: GrowthTuning;
}

export function areaMapPipeline({ growth }: AreaMapPipelineOptions = {}): MapPipeline<MapParams, AreaMapProducts> {
	return new MapPipeline<MapParams>()
		.stage(TERRAIN_STAGE)
		.stage(WATER_STAGE)
		.stage(HIGHWAYS_STAGE)
		.stage(growthStage(growth));
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
