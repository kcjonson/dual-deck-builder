#pragma once

#include "MapParams.h"
#include "MapPipeline.h"
#include "Terrain.h"

#include <optional>

namespace rules::map {

	// The area map's products, each its stage's, filled in pipeline order. A finished run fills every one.
	struct AreaMap {
		std::optional<Terrain> terrain;
	};

	// The area map's stages: terrain, so far. Each runs on the stream the runner nests for it, so the
	// terrain draws from root.fork("map", m).fork("terrain", t).
	[[nodiscard]] MapPipeline<MapParams, AreaMap> areaMapPipeline();

	// The area map for validated params, on their seed.
	[[nodiscard]] PipelineResult<AreaMap> generateAreaMap(const MapParams& params, const PipelineOptions<AreaMap>& options = {});

} // namespace rules::map
