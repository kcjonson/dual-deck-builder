#pragma once

#include "Hazards.h"
#include "MapParams.h"
#include "MapPipeline.h"
#include "Terrain.h"
#include "Water.h"

#include <optional>

namespace rules::map {

	// The area map's products, each its stage's, filled in pipeline order. A finished run fills every one.
	struct AreaMap {
		std::optional<Terrain> terrain;
		std::optional<Water>   water;
		std::optional<Hazards> hazards;
	};

	// The area map's stages: terrain, water, and hazards, so far. Each runs on the stream the runner nests
	// for it, so the hazards draw from root.fork("map", m).fork("terrain", t).fork("water", w).fork("hazards", h).
	[[nodiscard]] MapPipeline<MapParams, AreaMap> areaMapPipeline();

	// The area map for validated params, on their seed.
	[[nodiscard]] PipelineResult<AreaMap> generateAreaMap(const MapParams& params, const PipelineOptions<AreaMap>& options = {});

} // namespace rules::map
