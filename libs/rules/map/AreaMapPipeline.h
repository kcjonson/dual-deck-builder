#pragma once

#include "Hazards.h"
#include "MapParams.h"
#include "MapPipeline.h"
#include "PlaceNames.h"
#include "Places.h"
#include "PoiData.h"
#include "Pois.h"
#include "Roads.h"
#include "RouteTree.h"
#include "StopData.h"
#include "Terrain.h"
#include "Water.h"

#include <filesystem>
#include <optional>
#include <vector>

namespace rules::map {

	// The packs' content generation reads.
	struct MapContent {
		PlaceNamePool		 placeNames;
		PoiTuning			 pois;
		std::vector<Faction> factions;
		StopTuning			 stops;
	};

	// One pack's: its map/place-names.json, map/pois.json, map/stops.json, and factions/factions.json, each read
	// strictly.
	[[nodiscard]] MapContent readMapContent(const std::filesystem::path& pack);

	// What generation reads: the validated params, and the content from the packs.
	struct AreaMapInput {
		MapParams  params;
		MapContent content;
	};

	// The area map's products, each its stage's, filled in pipeline order. A finished run fills every one.
	struct AreaMap {
		std::optional<Terrain>	 terrain;
		std::optional<Water>	 water;
		std::optional<Hazards>	 hazards;
		std::optional<Places>	 places;
		std::optional<Roads>	 roads;
		std::optional<RouteTree> routeTree;
		std::optional<PoiLayer>	 pois;
	};

	// The area map's stages: terrain, water, hazards, places, roads, the route tree, and the POIs, so far. Each runs
	// on the stream the runner nests for it, so the POIs draw from root.fork("map", m).fork("terrain", t)
	// .fork("water", w).fork("hazards", h).fork("places", p).fork("roads", r).fork("routeTree", 0).fork("pois", q).
	// The route tree takes no draws, and so gets one attempt, but it's a link in the chain all the same. The POIs
	// escalate to the roads once their attempts run out.
	[[nodiscard]] MapPipeline<AreaMapInput, AreaMap> areaMapPipeline();

	// Whether the POI stage holds a map leniently, its failures kept in the layer rather than failing it: where the
	// places could close fewer loops than the POIs want, so the roads asked for fewer, and the roads closed fewer.
	// No attempt there can seat a stronghold in every sector.
	[[nodiscard]] bool poisHeldLeniently(const MapParams& params, const Roads& roads);

	// The area map for validated params, on their seed.
	[[nodiscard]] PipelineResult<AreaMap>
	generateAreaMap(const MapParams& params, const MapContent& content, const PipelineOptions<AreaMap>& options = {});

} // namespace rules::map
