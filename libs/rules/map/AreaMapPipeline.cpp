#include "AreaMapPipeline.h"

#include <cstddef>
#include <string>

namespace rules::map {

	namespace {

		void runTerrain(const MapParams& params, AreaMap& map, foundation::Rng& stream) {
			map.terrain.emplace(params, stream);
		}

		void runWater(const MapParams& params, AreaMap& map, foundation::Rng& stream) {
			map.water.emplace(params, *map.terrain, stream);
		}

		void runHazards(const MapParams& params, AreaMap& map, foundation::Rng& stream) {
			map.hazards.emplace(params, *map.terrain, *map.water, stream);
		}

		// A hotspot finding no room is vanishingly rare, so a map short of one draws again.
		Problems checkHazards(const MapParams& params, const AreaMap& map) {
			const size_t placed = map.hazards->hotspots().size();
			if (placed == static_cast<size_t>(params.hotspots)) {
				return {};
			}
			return {"placed " + std::to_string(placed) + " of " + std::to_string(params.hotspots) + " hotspots"};
		}

	} // namespace

	MapPipeline<MapParams, AreaMap> areaMapPipeline() {
		return MapPipeline<MapParams, AreaMap>{}
			.then({.name = "terrain", .run = runTerrain})
			.then({.name = "water", .run = runWater})
			.then({.name = "hazards", .run = runHazards, .check = checkHazards});
	}

	PipelineResult<AreaMap> generateAreaMap(const MapParams& params, const PipelineOptions<AreaMap>& options) {
		return areaMapPipeline().run(params.seed, params, options);
	}

} // namespace rules::map
