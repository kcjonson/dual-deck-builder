import { Hazards, generateHazards } from './Hazards';
import { highwayDepartures } from './Highways';
import type { MapParams } from './MapParams';
import { AcceptHook, MapPipeline, MapStage, PipelineResult, StageAttempt } from './MapPipeline';
import { Places, generatePlaces } from './Places';
import { checkRoadNetwork } from './RoadChecks';
import { GROWTH_TUNING, GrowthTuning, RoadGrowth, growRoads } from './RoadGrowth';
import { Terrain, generateTerrain } from './Terrain';
import { Water, generateWater } from './Water';

/**
 * The area map's stages as they stand: terrain, water, hazards, places, then
 * growth, the stand-in until road links (Maps 7 and 8) replace it. Each runs
 * on the stream the runner nests for it, so water draws from
 * root.fork('map', m).fork('terrain', t).fork('water', w), hazards one level
 * further down, places one more, and growth one more again.
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

/** Stage 3, hotspots over the land with its water, off the rivers and lakes. */
export const HAZARDS_STAGE: MapStage<MapParams, Pick<AreaMapProducts, 'water'>, 'hazards', Hazards> = {
	name: 'hazards',
	run: ({ input, products, rng }) => generateHazards({ params: input, terrain: products.water.terrain, rng }),
};

/** Stage 4, settlements, crossroads, and exits. */
export const PLACES_STAGE: MapStage<MapParams, Pick<AreaMapProducts, 'water' | 'hazards'>, 'places', Places> = {
	name: 'places',
	run: ({ input, products, rng }) => generatePlaces({ params: input, terrain: products.hazards.terrain, water: products.water, rng }),
};

/**
 * Growth with its own knobs, its highways leaving the metro toward the
 * highway exits, over the land with its water and hazards, checked by the
 * network checks the map validator will run. The departures' drift draws on
 * the stage stream's `highways` fork.
 */
export function growthStage(tuning: GrowthTuning = {}): MapStage<MapParams, Pick<AreaMapProducts, 'hazards' | 'places'>, 'growth', RoadGrowth> {
	const { branchiness, clearance = GROWTH_TUNING.clearance } = tuning;
	return {
		name: 'growth',
		run: ({ input, products, rng }) => {
			const terrain = products.hazards.terrain;
			const highways = highwayDepartures({ terrain, params: input, exits: products.places.exits, rng: rng.fork('highways') });
			return growRoads({ terrain, params: input, highways, rng, branchiness, clearance });
		},
		check: ({ network }, { products }) => checkRoadNetwork({ network, terrain: products.hazards.terrain, clearance })
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
		.stage(HAZARDS_STAGE)
		.stage(PLACES_STAGE)
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
}

/**
 * The area map as far as the stages go today, in-process. The generation
 * worker runs this. Throws a MapPipelineError when every map attempt on the
 * seed fails; founding answers that with the next seed (map-pipeline-worker.md).
 */
export function generateAreaMap({ params, growth, accept, onProgress, debug }: AreaMapOptions): AreaMapGeneration {
	return { ...areaMapPipeline({ growth }).run({ seed: params.seed, input: params, accept, onProgress, debug }), params };
}
