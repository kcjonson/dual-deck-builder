#pragma once

#include "Drainage.h"
#include "LandGrid.h"
#include "MapParams.h"

#include <random/Rng.h>

#include <vector>

namespace rules::map {

	// World units elevation 1 stands: slopes and grades are elevation's gradient times this.
	inline constexpr double kRelief = 100;
	// The most of its relief the metro keeps when it's flattened, and less where that would leave a grade
	// steeper than kMetroGrade, cell to cell.
	inline constexpr double kMetroRelief = 0.15;
	inline constexpr double kMetroGrade = 0.1;

	// Dry maps' terraces: none from a moisture level of `below`, full at `full`; benches per unit of
	// elevation; where in each step the riser starts and ends; how far elevation is pulled toward them at
	// full dryness.
	struct Terraces {
		double below = 0.4;
		double full = 0.1;
		int	   steps = 7;
		double riserStart = 0.55;
		double riserEnd = 0.92;
		double strength = 0.8;
	};

	inline constexpr Terraces kTerraces;

	// The start's radii, world units: where the metro ends, where its fields blend into the land's, and
	// where the land's relief is full.
	struct StartRadii {
		double metro{0};
		double blend{0};
		double relief{0};
	};

	[[nodiscard]] StartRadii startRadii(int radius, double metroSize);

	// 1 inside the metro, easing to 0 at the blend radius: how far the metro's fields stand in for the land's.
	// On squared distance, so no square root is taken.
	[[nodiscard]] double startWeight(const StartRadii& radii, double distanceSquared);

	// The eroded land, as plain data on the grid.
	struct LandSurface {
		LandGrid grid;
		// Finished elevation per cell, 0 to 1: outlets at 0, the highest peaks toward 1.
		std::vector<double> elevation;
		// Range country per cell, 0 to 1: the uplift's mask.
		std::vector<double> mountains;
		// The finished land's drainage, routed from the outlets, one unit of rain a cell.
		Drainage drainage;
		// No outlets on the edge: everything drains to drainage.outlets[0], inside the disc.
		bool closedBasin{false};
	};

	// The land (Area Map Generation, Pipeline, 1. Terrain): the uplift eroded by the rivers that drain it,
	// coarse first, then at full size; elevation the eroded height over a fixed scale, easing toward 1 on
	// the highest peaks; and the metro flattened. Terrain terraces a dry map as it samples it, not here.
	// Every step is an add, multiply, divide, compare, square root or floor, so a seed's land is the same
	// to the bit on every platform. `stream` is the terrain's; the land forks it by feature and never
	// draws from it. The params are validated.
	[[nodiscard]] LandSurface generateLand(const MapParams& params, const foundation::Rng& stream);

	struct Outlets {
		std::vector<int> cells;
		bool			 closedBasin{false};
	};

	// `count` cells spread round the grid's edge from a drawn start, each jittered within half its share
	// of the perimeter, so none come within half an even spacing of another. With none, one sink inside
	// the disc in a drawn direction: a closed basin.
	[[nodiscard]] Outlets placeOutlets(const LandGrid& grid, int count, int radius, foundation::Rng& rng);

	// How wet the land runs on average, 0 to 1. The spec defines aridity as dry desert to wet ground over
	// 0 to 1, which reads backwards for the name; renaming or flipping it (DDB-405) is a change here.
	[[nodiscard]] double moistureLevel(double aridity);
	// How hard a map's elevation is pulled toward terraces.
	[[nodiscard]] double terracePull(double wetness);
	// Elevation pulled toward terraces by `pull`: each bench is flat for most of its height, then rises in
	// a steep riser. Never all the way, so a higher point stays higher and land drains the same way
	// terraced or not.
	[[nodiscard]] double terraceHeight(double height, double pull);
	// How far a full pull would move `height`.
	[[nodiscard]] double terraceLift(double height);
	// terraceHeight's derivative in `height`: what a slope is multiplied by where it's terraced.
	[[nodiscard]] double terraceSlope(double height, double pull);

} // namespace rules::map
