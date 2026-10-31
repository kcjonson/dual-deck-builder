#pragma once

#include "LandGrid.h"

#include <random/Rng.h>

#include <cstdint>
#include <optional>
#include <span>
#include <vector>

namespace rules::map {

	enum class LakeKind { Reservoir, Natural };

	// The depth field just past a shore, as elevation: the shore sits that far short of the dry cell's centre.
	inline constexpr double kLakeShore = 0.002;

	// Where a reservoir's dam holds its river back: a natural site for a POI.
	struct Dam {
		// The dam cell's centre.
		double x{0};
		double y{0};
		// The way the river leaves through it, a unit vector; the dam runs square across it.
		double towardX{0};
		double towardY{0};
	};

	struct Lake {
		LakeKind kind{LakeKind::Natural};
		// Its water level, as elevation. A natural lake's is its highest cell's.
		double level{0};
		int	   cells{0};
		// The centre of its cells.
		double			   x{0};
		double			   y{0};
		std::optional<Dam> dam;
	};

	// Where lakes stand as they're made: each cell's lake, -1 for none, and its water level.
	struct LakeCells {
		std::vector<int>	lakeOf;
		std::vector<double> level;
		std::vector<Lake>	lakes;
	};

	[[nodiscard]] LakeCells emptyLakeCells(size_t cells);

	struct NaturalLakeArgs {
		LandGrid				grid;
		std::span<const double> elevation;
		// The land's own drainage levels: where one stands above the land, water stands in a pit until it spills.
		std::span<const double> levels;
		// Each cell's moisture before the rivers.
		std::span<const double> moisture;
	};

	// The land's pits where the country is wet, as lakes at the level they fill to, cell by cell. A pit that
	// touches a blocked cell stays dry, and the cells round each lake become blocked, so no later lake
	// touches it.
	void naturalLakes(const NaturalLakeArgs& args, std::vector<uint8_t>& blocked, LakeCells& lakes);

	struct ReservoirArgs {
		LandGrid				grid;
		std::span<const double> elevation;
		// The water's routing, and its rain-weighted area.
		std::span<const int>	receivers;
		std::span<const double> area;
		double					threshold{0};
		int						count{0};
		// The map's radius, and the nearest a dam may sit to the compound.
		double radius{0};
		double inner{0};
	};

	// Up to `count` reservoirs, each a dam on a river cell in a valley, filled to the highest level that keeps
	// its lake within a drawn size, clear of blocked cells and other lakes, and below the lowest saddle out of
	// its valley, so no land beside it lies under its level but what the dam's wall holds back. `rng` is the
	// water stream's `reservoirs` fork.
	void placeReservoirs(const ReservoirArgs& args, foundation::Rng& rng, std::vector<uint8_t>& blocked, LakeCells& lakes);

	// How far `cell` lies below the lower of the two cells `reach` away on either side, across whichever of
	// the four directions cuts deepest: how deep a valley it's in. 0 on a slope or a ridge.
	[[nodiscard]] double valleyDepth(std::span<const double> elevation, int size, int cell, int reach = 3);

	// Every cell's water as a depth field: under a lake its level less the land, at least kLakeShore; just
	// past its shore the level less the land there, at most -kLakeShore; elsewhere -1. Read bilinear, its zero is the
	// shore, which follows the land's contour at the level.
	[[nodiscard]] std::vector<double> lakeDepthField(const LandGrid& grid, std::span<const double> elevation, const LakeCells& lakes);

} // namespace rules::map
