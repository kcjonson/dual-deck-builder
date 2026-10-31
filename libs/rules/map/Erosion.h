#pragma once

#include "Drainage.h"

#include <span>
#include <vector>

namespace rules::map {

	struct ErosionArgs {
		// Height per cell, eroded in place.
		std::span<double> heights;
		// Uplift per unit of time, per cell.
		std::span<const double> upliftRate;
		// They hold their height.
		std::span<const int> outlets;
		int					 iterations{0};
		// dt.
		double timeStep{0};
		// K: how fast drainage cuts, per unit of time and of the square root of its area.
		double erodibility{0};
		// A share of the four-neighbour Laplacian an iteration; 0.25 or under keeps it stable.
		double diffusion{0};
	};

	// Fluvial erosion (Area Map Generation, Pipeline, 1. Terrain): Braun and Willett's implicit
	// stream-power solver (2013), m 0.5 and n 1, after a little hillslope diffusion. Each iteration
	// smooths the hillslopes, routes drainage, accumulates its area, and updates every cell downstream
	// first, so its receiver's new height is known:
	//
	//   h = (h + dt U + F h_receiver) / (1 + F),  F = dt K sqrt(area) / distance
	//
	// with area and distance both in cells, so stream power's steady state is the same land at any cell
	// size. Diffusion doesn't scale that way, so a coarser grid takes less of it. The router, for the
	// grid's size, is left holding the last iteration's drainage, area included.
	void erode(const ErosionArgs& args, DrainageRouter& router);

	// Half the size, each cell the mean of the two by two it covers.
	[[nodiscard]] std::vector<double> downsample(std::span<const double> values, int size);
	// Twice the size over the same square, bilinear between the coarse centres and held at the edges.
	[[nodiscard]] std::vector<double> upsample(std::span<const double> values, int coarseSize);

} // namespace rules::map
