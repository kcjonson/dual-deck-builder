#pragma once

#include "Hazards.h"
#include "MapParams.h"
#include "MapPipeline.h"
#include "PlaceNames.h"
#include "Places.h"
#include "Roads.h"
#include "RouteTree.h"
#include "Terrain.h"
#include "Water.h"

#include <optional>

namespace rules::map {

	// What generation reads: the validated params, and the content from the packs it names things with.
	struct AreaMapInput {
		MapParams	  params;
		PlaceNamePool placeNames;
	};

	// The area map's products, each its stage's, filled in pipeline order. A finished run fills every one.
	struct AreaMap {
		std::optional<Terrain>	 terrain;
		std::optional<Water>	 water;
		std::optional<Hazards>	 hazards;
		std::optional<Places>	 places;
		std::optional<Roads>	 roads;
		std::optional<RouteTree> routeTree;
	};

	// The area map's stages: terrain, water, hazards, places, roads, and the route tree, so far. Each runs on the
	// stream the runner nests for it, so the roads draw from root.fork("map", m).fork("terrain", t).fork("water", w)
	// .fork("hazards", h).fork("places", p).fork("roads", r). The route tree takes no draws, and so gets one
	// attempt, but it's a link in the chain all the same: the stage after it nests in .fork("routeTree", 0).
	[[nodiscard]] MapPipeline<AreaMapInput, AreaMap> areaMapPipeline();

	// The area map for validated params, on their seed.
	[[nodiscard]] PipelineResult<AreaMap>
	generateAreaMap(const MapParams& params, const PlaceNamePool& placeNames, const PipelineOptions<AreaMap>& options = {});

} // namespace rules::map
