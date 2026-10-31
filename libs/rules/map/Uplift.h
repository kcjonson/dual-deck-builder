#pragma once

#include "LandGrid.h"

#include <random/Rng.h>

#include <vector>

namespace rules::map {

	struct UpliftArgs {
		LandGrid grid;
		// World units: coverage is a share of the land inside the disc...
		double radius{0};
		// ...and past this. No range lifts inside the metro, and the lift is full from the relief radius out.
		double metroRadius{0};
		double reliefRadius{0};
		double mountainCoverage{0};
		double ruggedness{0};
	};

	struct UpliftField {
		// How hard the land is pushed up, per cell.
		std::vector<double> uplift;
		// Range country per cell, 0 to 1, none in the metro: 0.5 and up is mountainCoverage of the land past
		// the relief radius.
		std::vector<double> mountains;
		// The unit vector ranges run along.
		double grainX{0};
		double grainY{0};
	};

	// Where the land is pushed up before erosion cuts it down (Area Map Generation, Pipeline, 1. Terrain).
	// A low, varied lift everywhere makes rolling country, and ranges lift far more: belts of a broad layer
	// stretched along one grain per map, since a region's ranges run roughly parallel, bent by a warp and
	// broken by a finer layer added before the coverage quantile, so the share is exact and gaps make
	// passes. Round the metro the ranges fade to nothing and the hills to half. `stream` is the terrain's;
	// the uplift forks it by feature and never draws from it.
	[[nodiscard]] UpliftField buildUplift(const UpliftArgs& args, const foundation::Rng& stream);

} // namespace rules::map
