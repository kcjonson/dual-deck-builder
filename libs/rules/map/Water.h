#pragma once

#include "Drainage.h"
#include "Lakes.h"
#include "MapParams.h"
#include "RiverIndex.h"
#include "Rivers.h"
#include "Terrain.h"

#include <random/Rng.h>

#include <span>
#include <vector>

namespace rules::map {

	// Stage 2 of area map generation (Area Map Generation, Pipeline, 2. Water), on the `water` stream:
	// rain-weighted drainage over the finished land, the rivers traced down it, natural lakes and `lakes`
	// reservoirs, and moisture, which follows from where the water runs. Plain data on the land grid.
	//
	// The land is routed again with noise of under a hundredth of grade added, so drainage stops crossing
	// flat ground, the metro's filled water above all, in ruler-straight lines; on any real slope the noise
	// is too small to matter, so rivers stay in the valleys erosion cut. The stream forks by feature,
	// `moisture`, `flats`, `reservoirs` and `meander`, and never draws itself.
	class Water {
	  public:
		// The params are validated, `terrain` is the terrain stage's for them, and `stream` is this stage's.
		Water(const MapParams& params, const Terrain& terrain, const foundation::Rng& stream);

		Water(const Water&) = delete;
		Water& operator=(const Water&) = delete;
		Water(Water&&) = default;
		Water& operator=(Water&&) = default;
		~Water() = default;

		// Rain-weighted drainage area a cell needs to be river.
		[[nodiscard]] double threshold() const { return streamThreshold; }
		// The water's own routing over the land with its noise, and the rain that drains through each cell.
		[[nodiscard]] const Drainage& drainage() const { return routing; }
		// Per cell, 0 dry to 1 wet.
		[[nodiscard]] std::span<const double> moisture() const { return moistureOf; }
		// Per cell, world units above the river or lake its drainage reaches first, height above the nearest
		// drainage...
		[[nodiscard]] std::span<const double> aboveWater() const { return aboveWaterOf; }
		// ...and world units along the drainage to it.
		[[nodiscard]] std::span<const double> alongToWater() const { return alongToWaterOf; }
		// Per cell, 1 on the water, 0.5 at the map's lowland level above it, 0 well above it.
		[[nodiscard]] std::span<const double> lowland() const { return lowlandOf; }
		// Per cell, 0 to 1: deep in a river valley cut into dry country, 0.5 and up being canyons.
		[[nodiscard]] std::span<const double> canyons() const { return canyonsOf; }
		// Per cell, a lake's level less the land, and less than 0 away from lakes: its bilinear zero is the shore.
		[[nodiscard]] std::span<const double> lakeDepth() const { return lakeDepthOf; }
		// Per cell, the lake over it, an index into lakes(), or -1.
		[[nodiscard]] std::span<const int>		lakeOf() const { return lakeIndex; }
		[[nodiscard]] const std::vector<River>& rivers() const { return riverList; }
		[[nodiscard]] const std::vector<Lake>&	lakes() const { return lakeList; }
		// Where the rivers' water is.
		[[nodiscard]] const RiverIndex& riverIndex() const { return index; }

	  private:
		double				streamThreshold{0};
		Drainage			routing;
		std::vector<double> moistureOf;
		std::vector<double> aboveWaterOf;
		std::vector<double> alongToWaterOf;
		std::vector<double> lowlandOf;
		std::vector<double> canyonsOf;
		std::vector<double> lakeDepthOf;
		std::vector<int>	lakeIndex;
		std::vector<River>	riverList;
		std::vector<Lake>	lakeList;
		RiverIndex			index;
	};

} // namespace rules::map
