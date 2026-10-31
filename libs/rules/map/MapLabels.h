#pragma once

#include "FeatureNames.h"
#include "PlaceNames.h"
#include "Places.h"
#include "Pois.h"
#include "Polyline.h"
#include "RoadNetwork.h"
#include "Terrain.h"
#include "Water.h"

#include <random/Rng.h>

#include <array>
#include <span>
#include <string>
#include <vector>

namespace rules::map {

	// A river big enough to name, with course enough inside the disc.
	struct NamedRiver {
		// Its index in the water's rivers.
		int			river{0};
		std::string name;
		// Its longest run inside the labels' reach, downstream.
		std::vector<Point> course;
	};

	struct NamedLake {
		// Its index in the water's lakes.
		int			lake{0};
		std::string name;
		// Its cell nearest the middle of its cells, so a label there sits on its water.
		Point at;
	};

	// A range of mountains or hills: land cells side by side where the range mask is past half.
	struct NamedRange {
		std::string name;
		int			cells{0};
		bool		mountains{false};
		Point		middle;
		// Its long axis through the middle, a unit vector read west to east, and how far its cells spread along it, the
		// standard deviation in world units.
		Point  axis;
		double spread{0};
	};

	// The metro's name and the land's named features, each named the same way whatever the dressing, in a fixed order,
	// rivers biggest first, then lakes, ranges biggest first, and passes, so a name never changes with how much of the
	// map is labelled.
	struct MapNames {
		// As a place's name; its label is in capitals.
		std::string				metro;
		std::vector<NamedRiver> rivers;
		std::vector<NamedLake>	lakes;
		std::vector<NamedRange> ranges;
		// By pass, the network's.
		std::vector<std::string> passes;
	};

	struct MapNameArgs {
		const Terrain&			  terrain;
		const Water&			  water;
		const Places&			  places;
		std::span<const RoadPass> passes;
		const PlaceNamePool&	  placeNames;
		const FeatureNamePool&	  featureNames;
		// The dressing's `names` fork: the metro is named on its `metro` fork, the features on `features`.
		foundation::Rng stream;
	};

	// The metro's name, from the places' pool and never a town's or a village's nor starting as one does, and the land's
	// features (dressing.md, Labels): rivers draining 4 times the stream threshold where they end with 120 units of
	// course inside 0.92 of the radius, a river from 25 times and a creek under it; lakes of 3 cells or more whose middle
	// is inside 0.95 of the radius; ranges of 30 land cells or more inside 0.95, mountains where their peak's elevation
	// is 0.55 or more and hills under it; and every pass.
	[[nodiscard]] MapNames nameMap(const MapNameArgs& args);

	enum class LabelKind { Metro, Stronghold, Poi, Town, Shield, Range, Reservoir, Lake, River, Village, Pass };

	// Each kind's base priority, by LabelKind: the metro over everything, then what play needs, strongholds and POIs,
	// then towns, highways, the land's big features, villages, and passes last.
	inline constexpr std::array<double, 11> kLabelPriority{100, 95, 90, 80, 70, 65, 60, 60, 55, 50, 40};

	// A name the atlas could print, for the view to set (placeLabels).
	struct MapLabel {
		LabelKind	kind{LabelKind::Metro};
		std::string text;
		// Set highest first: its kind's base, plus under 1 for its size among its kind.
		double priority{0};
		// A point label's anchor, or the middle of a line label's path.
		Point at;
		// What a line label is set along, a stretch of a river's course or a range's long axis; empty for a point label.
		std::vector<Point> path;
		// What it names: a place's id for the metro, a town, or a village; a POI's index in the POI layer for a POI or a
		// stronghold; a highway's number from 0 for a shield; a range's index in MapNames' ranges; a lake's in the water's
		// lakes; a river's in its rivers; and a pass's in the network's passes.
		int ref{0};
	};

	struct MapLabelArgs {
		const MapNames&	   names;
		const Water&	   water;
		const Places&	   places;
		const RoadNetwork& network;
		const PoiLayer&	   pois;
		// By POI, as poiNames gives them, so a label and every screen name a POI alike.
		std::span<const std::string> poiNames;
		int							 radius{0};
		// The dressing over its default (dressingScale).
		double scale{0};
	};

	// Every label the atlas could print, highest priority first, ties in the order they're made: the metro, the POIs
	// and strongholds, towns, highway shields, then the ranges, lakes, and rivers big enough at the dressing's scale,
	// villages, and passes. A town or village gains by its ruins, a range or lake by its cells, a river by its drainage,
	// and a shield the nearer the rim. Shields stand on each highway's stretches outside the metro, 0.35 of the radius
	// apart along a number, the rim's first; a river's are along its course, one every 450 units, each set along 90
	// units either side; a range's along its long axis, 1.6 spreads either side of its middle, drawn in until both ends
	// are inside 0.95 of the radius. With no dressing only what play uses is labelled.
	[[nodiscard]] std::vector<MapLabel> mapLabels(const MapLabelArgs& args);

} // namespace rules::map
