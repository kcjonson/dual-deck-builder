/**
 * The area map generator version a campaign records with its map. 1 was the
 * stand-in campaigns were founded on before the generator existed.
 * Adding, removing, or renaming a gameplay stage in `areaMapPipeline`
 * (AreaMapPipeline.ts) bumps it, since a save names the stages its
 * attempts belong to (a test pins the list to it), and so may any change
 * that makes another gameplay map from the same seed, params, and
 * attempts. An inert stage, the dressing, never does: a replay runs it on
 * its first attempt where a save has none, and what it draws isn't play.
 * The campaign store reads a save recorded at another version as outdated,
 * the way it reads one of another save format version
 * (map-pipeline-worker.md, Making a saved map again).
 *
 * A module of its own, so the store reads it without loading the pipeline.
 */
export const AREA_MAP_GENERATOR_VERSION = 6;
