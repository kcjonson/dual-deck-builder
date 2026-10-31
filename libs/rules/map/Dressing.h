#pragma once

#include "FeatureNames.h"
#include "Ground.h"
#include "MapLabels.h"
#include "MapParams.h"
#include "PlaceNames.h"
#include "Places.h"
#include "Pois.h"
#include "Polyline.h"
#include "RailLines.h"
#include "RoadNetwork.h"
#include "StreetGrids.h"

#include <random/Rng.h>

#include <span>
#include <string>
#include <vector>

namespace rules::map {

	// A crater's plume, hatched from the crater's rim out to where its contamination falls to the hatching's level.
	struct HatchRegion {
		Point at;
		// World units: the crater's radius, and where the hatching stops.
		double inner{0};
		double outer{0};
		// The hatching's direction, a unit vector, and world units between its lines.
		double ux{0};
		double uy{0};
		double spacing{0};
	};

	// Stage 11's product (Area Map Generation, 11. Dressing; dressing.md): what makes the map read as a page of a road
	// atlas, as plain data for the view to draw. None of it is play.
	struct Dressing {
		// The metro's districts first, then the towns' grids, then the villages'.
		std::vector<StreetDistrict> districts;
		std::vector<RailLine>		rails;
		std::vector<HatchRegion>	hatches;
		// Dots stippled over mire.
		std::vector<Point> stipple;
		MapNames		   names;
		// Highest priority first.
		std::vector<MapLabel> labels;
	};

	// The dressing over its default: 1 at the default, 0 with none. The parts with a parameter of their own, the grids
	// and the rails, thin below the default and keep to their parameter above it; hatching, stipple, and which features
	// are labelled scale on up.
	[[nodiscard]] double dressingScale(double dressing);

	struct HatchArgs {
		std::span<const Hotspot> hotspots;
		int						 radius{0};
		double					 scale{0};
		// The dressing's `hatches` fork, a draw a hotspot.
		foundation::Rng stream;
	};

	// Every crater inside the disc whose plume is stronger than 0.15, hatched out to where the plume falls to 0.15, its
	// lines 8 units apart at the default dressing and closer as it rises, at 45 degrees turned up to 15 either way.
	[[nodiscard]] std::vector<HatchRegion> hatchRegions(HatchArgs args);

	struct StippleArgs {
		const Ground& ground;
		double		  scale{0};
		// The dressing's `stipple` fork, two draws a cell.
		foundation::Rng stream;
	};

	// A dot anywhere in each cell of a grid over the disc, 12 units across at the default dressing and finer as it rises,
	// kept where it lands on mire and no water.
	[[nodiscard]] std::vector<Point> mireStipple(StippleArgs args);

	struct DressingArgs {
		// Validated: radius, dressing, streetGrids, and railLines are read.
		const MapParams& params;
		// The land with its water and hazards.
		const Ground&	   ground;
		const Places&	   places;
		const RoadNetwork& network;
		const PoiLayer&	   pois;
		// By POI, as poiNames gives them.
		std::span<const std::string> poiNames;
		const PlaceNamePool&		 placeNames;
		const FeatureNamePool&		 featureNames;
		// The stage's: each part forks its own by name, `names`, `rails`, `grids`, `hatches`, and `stipple`, so none
		// moves another.
		foundation::Rng stream;
	};

	// The dressing over a finished map, reading every stage before it and changing none. The rails are laid before the
	// grids, so a rail runs through the streets as a road does.
	[[nodiscard]] Dressing generateDressing(const DressingArgs& args);

} // namespace rules::map
