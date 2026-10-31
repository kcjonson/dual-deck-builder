#include "AreaMapPipeline.h"

namespace rules::map {

	MapPipeline<MapParams, AreaMap> areaMapPipeline() {
		return MapPipeline<MapParams, AreaMap>{}
			.then({
				.name = "terrain",
				.run = [](const MapParams& params, AreaMap& map, foundation::Rng& stream) { map.terrain.emplace(params, stream); },
			})
			.then({
				.name = "water",
				.run = [](const MapParams& params, AreaMap& map, foundation::Rng& stream) {
					map.water.emplace(params, *map.terrain, stream);
				},
			});
	}

	PipelineResult<AreaMap> generateAreaMap(const MapParams& params, const PipelineOptions<AreaMap>& options) {
		return areaMapPipeline().run(params.seed, params, options);
	}

} // namespace rules::map
