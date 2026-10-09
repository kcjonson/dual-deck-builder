import { HighwayDeparture, planHighways } from './Highways';
import type { MapParams } from './MapParams';
import { AcceptHook, MapPipeline, MapStage, PipelineResult, StageAttempt } from './MapPipeline';
import { checkRoadNetwork } from './RoadChecks';
import { GROWTH_TUNING, GrowthTuning, RoadGrowth, growRoads } from './RoadGrowth';
import { Terrain, generateTerrain } from './Terrain';

/**
 * The area map's stages as they stand: terrain, then the highways and growth
 * pair, stand-ins until settlements and road links (Map 7 and 8) replace
 * them. Each runs on the stream the runner nests for it, so the highways
 * draw from root.fork('map', m).fork('terrain', t).fork('highways', h), and
 * growth one level further down.
 */

export interface AreaMapProducts {
	readonly terrain: Terrain;
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

export const HIGHWAYS_STAGE: MapStage<MapParams, Pick<AreaMapProducts, 'terrain'>, 'highways', readonly HighwayDeparture[]> = {
	name: 'highways',
	run: ({ input, products, rng }) => planHighways({ terrain: products.terrain, params: input, rng }),
};

/** Growth with its own knobs, checked by the network checks the map validator will run. */
export function growthStage(tuning: GrowthTuning = {}): MapStage<MapParams, Pick<AreaMapProducts, 'terrain' | 'highways'>, 'growth', RoadGrowth> {
	const { branchiness, clearance = GROWTH_TUNING.clearance } = tuning;
	return {
		name: 'growth',
		run: ({ input, products, rng }) => growRoads({ terrain: products.terrain, params: input, highways: products.highways, rng, branchiness, clearance }),
		check: ({ network }, { products }) => checkRoadNetwork({ network, terrain: products.terrain, clearance })
			.map(({ rule, detail }) => `${rule}: ${detail}`),
	};
}

export function areaMapPipeline({ growth }: { growth?: GrowthTuning } = {}): MapPipeline<MapParams, AreaMapProducts> {
	return new MapPipeline<MapParams>()
		.stage(TERRAIN_STAGE)
		.stage(HIGHWAYS_STAGE)
		.stage(growthStage(growth));
}

export interface AreaMapGeneration extends PipelineResult<AreaMapProducts> {
	/** The params the map was generated on, with the seed it came from. */
	readonly params: MapParams;
}

export interface AreaMapOptions {
	/** Resolved and validated. Generation starts from `params.seed`. */
	readonly params: MapParams;
	readonly growth?: GrowthTuning;
	readonly accept?: AcceptHook<AreaMapProducts>;
	readonly onProgress?: (stage: StageAttempt) => void;
	/** `__DEV_TOOLS__` when left out. */
	readonly debug?: boolean;
}

/** The area map as far as the stages go today, in-process. The generation worker runs this. */
export function generateAreaMap({ params, growth, accept, onProgress, debug }: AreaMapOptions): AreaMapGeneration {
	const result = areaMapPipeline({ growth }).run({ seed: params.seed, input: params, accept, onProgress, debug });
	return { ...result, params: result.seed === params.seed ? params : { ...params, seed: result.seed } };
}
