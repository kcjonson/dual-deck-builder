#pragma once

#include "Dressing.h"
#include "FeatureNames.h"
#include "Hazards.h"
#include "MapKnowledge.h"
#include "MapParams.h"
#include "MapPipeline.h"
#include "PlaceNames.h"
#include "Places.h"
#include "PoiData.h"
#include "Pois.h"
#include "Roads.h"
#include "RouteTree.h"
#include "StopData.h"
#include "StopTables.h"
#include "Stops.h"
#include "Terrain.h"
#include "Water.h"

#include <filesystem>
#include <optional>
#include <vector>

namespace rules::map {

	// The packs' content generation reads, and the map validator: the starting knowledge's sight is what Guarantees 6
	// holds the strongholds clear of.
	struct MapContent {
		PlaceNamePool		 placeNames;
		FeatureNamePool		 featureNames;
		PoiTuning			 pois;
		std::vector<Faction> factions;
		StopTuning			 stops;
		StopTables			 stopTables;
		KnowledgeTuning		 knowledge;
	};

	// One pack's: its map/place-names.json, map/feature-names.json, map/pois.json, map/stops.json,
	// map/stop-tables.json, map/knowledge.json, and factions/factions.json, each read strictly, the stop tables compiled.
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
		std::optional<StopLayer> stops;
		std::optional<Dressing>	 dressing;
	};

	// The area map's stages: terrain, water, hazards, places, roads, the route tree, the POIs, the stops, and the
	// dressing. Each runs on the stream the runner nests for it, so the stops draw from root.fork("map", m)
	// .fork("terrain", t).fork("water", w).fork("hazards", h).fork("places", p).fork("roads", r).fork("routeTree", 0)
	// .fork("pois", q).fork("stops", s), and the dressing from that forked ("dressing", d). The route tree takes no
	// draws, and so gets one attempt, but it's a link in the chain all the same. The POIs escalate to the roads once
	// their attempts run out. The stops retry only themselves, and keep their best attempt past their cap in a release
	// run, never one with a route under its fight floor. The dressing is inert, the one stage a replay may leave out.
	[[nodiscard]] MapPipeline<AreaMapInput, AreaMap> areaMapPipeline();

	// Whether the POI stage holds a map leniently, its failures kept in the layer rather than failing it: where the
	// places could close fewer loops than the POIs want, so the roads asked for fewer, and the roads closed fewer.
	// No attempt there can seat a stronghold in every sector.
	[[nodiscard]] bool poisHeldLeniently(const MapParams& params, const Roads& roads);

	// The map validator (Area Map Generation, Validation and retries): every hard guarantee a made map breaks, from its
	// data alone, each as "stage: rule: detail". Each gameplay stage's own check is the validator's for its layer, so this
	// is every one of those over a whole map, then the guarantees no one layer holds, which mapValidator adds. A map a load
	// made again, its stages replayed unchecked, is held to it as a fresh one is. The dressing is held inert by reading
	// every layer through const references, not by a check.
	[[nodiscard]] Problems validateAreaMap(const AreaMap& map, const AreaMapInput& input);

	// The map validator as the pipeline's accept hook. A stage's own check has passed when it's called, so it adds only
	// what spans layers: past the POIs, the starting knowledge's half of Guarantees 6 (revealProblems), which reruns the
	// POIs like any of their failures. The input outlives it.
	[[nodiscard]] AcceptHook<AreaMap> mapValidator(const AreaMapInput& input);

	// The area map for validated params, on their seed, held to mapValidator, then to the options' own hook.
	[[nodiscard]] PipelineResult<AreaMap>
	generateAreaMap(const MapParams& params, const MapContent& content, const PipelineOptions<AreaMap>& options = {});

} // namespace rules::map
