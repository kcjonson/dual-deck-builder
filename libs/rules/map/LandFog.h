#pragma once

#include "Polyline.h"

#include <array>
#include <cstdint>
#include <span>

namespace rules::map {

	// Cells a side of the land fog, over the square the disc sits in (Area Map Generation, Knowledge and fog).
	inline constexpr int kFogCells = 64;

	struct FogCell {
		int column{0};
		int row{0};
	};

	// Which land is revealed, a cell at a time: plain data the campaign keeps or works out, never the map's. Cells run
	// east by column and north by row from the square's south-west corner, so on a disc of radius r a cell is 2r /
	// kFogCells across.
	struct LandFog {
		// Bit c of row r is the cell in column c.
		std::array<uint64_t, kFogCells> rows{};

		[[nodiscard]] bool revealed(FogCell cell) const;
		void			   reveal(FogCell cell);
		LandFog&		   operator|=(const LandFog& other);

		bool operator==(const LandFog&) const = default;
	};

	// The cell a point stands in on a disc of `radius`, a point past the square's edge in the cell at that edge.
	[[nodiscard]] FogCell fogCellAt(Point at, double radius);
	[[nodiscard]] Point	  fogCellCentre(FogCell cell, double radius);

	// Whether the land at a point is revealed.
	[[nodiscard]] bool revealedAt(const LandFog& fog, Point at, double radius);

	// Reveals every cell whose centre is within `sight` world units of the line, or of its one point.
	void revealAround(LandFog& fog, std::span<const Point> line, double sight, double radius);

	// The share of the cells whose centres lie on the disc that are revealed: the area map's explored percentage.
	[[nodiscard]] double exploredShare(const LandFog& fog);

} // namespace rules::map
