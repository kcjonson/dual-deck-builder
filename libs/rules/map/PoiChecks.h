#pragma once

#include "MapParams.h"
#include "PoiData.h"
#include "Pois.h"
#include "RoadNetwork.h"
#include "RouteTree.h"
#include "StopData.h"

#include <rules/core/JsonReader.h>

#include <cstddef>
#include <string>
#include <vector>

namespace rules::map {

	enum class PoiRule { Tree, Destination, Choice, Legs, Spacing, Sectors, OwnRoad };

	inline constexpr EnumNames<PoiRule, 7> kPoiRuleNames{{
		{"tree", PoiRule::Tree},
		{"destination", PoiRule::Destination},
		{"choice", PoiRule::Choice},
		{"legs", PoiRule::Legs},
		{"spacing", PoiRule::Spacing},
		{"sectors", PoiRule::Sectors},
		{"ownRoad", PoiRule::OwnRoad},
	}};

	struct PoiViolation {
		PoiRule		rule{PoiRule::Tree};
		std::string detail;
	};

	struct PoiCheckArgs {
		const RoadNetwork& network;
		const RouteTree&   tree;
		const PoiLayer&	   layer;
		// Validated: strongholds, routeSplit, and radius are read.
		const MapParams&  params;
		const PoiTuning&  tuning;
		const StopTuning& stops;
		// Off where the stage holds a map leniently, which may leave a sector without its stronghold.
		bool   sectors{true};
		size_t limit{20};
	};

	// Every rule the layer breaks, up to `limit`, from the map's data alone, so a loaded map is checked as one just
	// made (Area Map Generation, Guarantees 2, 4, 5, 6, 8, and the own road 11 needs; route-tree-and-pois.md, Checks):
	// - tree: every node's way home steps along a stretch joining it to a node one stretch nearer home.
	// - destination: a POI partway along a stretch sits inside it, on one no way home uses and no other POI is on,
	//   arriving from both its ends; one at a node is on a leaf whose every road is an arrival; no route passes a POI.
	// - choice: two or three arrivals from different nodes, splitting pairwise in time.
	// - legs: each route runs from the compound, leg on from leg and piece after piece, and ends at its POI on its
	//   arrival's stretch.
	// - spacing: POIs keep the sites' spacing, strongholds theirs.
	// - sectors: one stronghold in each sector of the saved rotation, in the outer band.
	// - ownRoad: each route's own road has room at the tight gap for its need.
	[[nodiscard]] std::vector<PoiViolation> checkPoiLayer(const PoiCheckArgs& args);

} // namespace rules::map
