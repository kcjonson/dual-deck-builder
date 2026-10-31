#pragma once

#include "Land.h"
#include "LandGrid.h"
#include "MapParams.h"
#include "Noise.h"

#include <random/Rng.h>

#include <cstdint>
#include <span>
#include <vector>

namespace rules::map {

	// The land-only fields over the eroded land (Area Map Generation, Pipeline, 3. Biomes, hazards, and
	// cost; terrain-fields.md and water-and-biomes.md): contamination before any hotspot's plume, rough
	// country and the cliffs in it, the squares a road can surely cross, and badlands. Each is calibrated
	// by quantile, so its parameter is its share of the country on every map. They read the terrain
	// stream's `contamination` and `roughness` forks, so a retry of any later stage never moves them.
	class LandFields {
	  public:
		// Over the land these params grew; `stream` is the terrain stage's.
		LandFields(const MapParams& params, const LandSurface& land, const StartRadii& radii, const foundation::Rng& stream);

		// 0 clean to 1 toxic, before any plume: `contamination` of the country past the blend radius is 0.5 or
		// more, none is in the metro, and it blends in over the blend ring.
		[[nodiscard]] double contamination(double x, double y) const;
		// Rough country: the steepest land past the relief radius, the only ground where a cliff can stand.
		[[nodiscard]] bool rough(double x, double y) const;
		// The steepest of the rough country by the land's averaged grade: an escarpment as one band.
		[[nodiscard]] bool cliff(double x, double y) const;
		// How far into a cliff a point lies, for drawing its edge: 0 or more on one, less off it.
		[[nodiscard]] double cliffDepth(double x, double y) const;
		// 0 to 1: the most broken ground away from the ranges, the toxic above all, 0.5 and up being badlands.
		[[nodiscard]] double badlands(double x, double y) const;

		// Per square between cell centres, row by row from the one whose lower-left corner is cell 0's centre:
		// 1 where no cliff stands anywhere in it and it lies wholly inside the disc. A cliff is rough and steep
		// at once, each read bilinear, which can't pass a square's corners, so this is exact.
		[[nodiscard]] std::span<const uint8_t> openSquares() const { return open; }
		// Per cell, the room a feature cut into the land has (featureRoom).
		[[nodiscard]] std::span<const double> room() const { return roomCells; }

	  private:
		LandGrid   grid;
		StartRadii radii;
		NoiseLayer contaminationNoise;
		// Contamination noise past this is toxic: the `contamination` quantile.
		double				 contaminationThreshold{0};
		std::vector<double>	 roughness;
		std::vector<double>	 steepness;
		double				 roughThreshold{0};
		double				 cliffThreshold{0};
		std::vector<double>	 badlandsCells;
		std::vector<double>	 roomCells;
		std::vector<uint8_t> open;
	};

	// Per cell, the room badlands and canyons have: 1 where no cell within three has any range lift, falling
	// to 0 where one's range mask reaches 0.1, since a range's flanks bend the land at their foot as steeply
	// as any broken ground; and none in the metro, rising to full at the relief radius.
	[[nodiscard]] std::vector<double> featureRoom(const LandSurface& land, const StartRadii& radii);

	// `values` at the cells past the relief radius and inside the disc: the land a feature's share is of.
	// Without `ranges`, only the cells outside the ranges, unless the ranges cover all of it.
	[[nodiscard]] std::vector<double>
	landValues(const LandSurface& land, int radius, double reliefRadius, std::span<const double> values, bool ranges);

} // namespace rules::map
