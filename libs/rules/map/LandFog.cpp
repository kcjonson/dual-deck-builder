#include "LandFog.h"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstddef>

namespace rules::map {

	namespace {

		[[nodiscard]] double cellSize(double radius) {
			return 2 * radius / kFogCells;
		}

		[[nodiscard]] int indexAt(double coordinate, double radius) {
			return std::clamp(static_cast<int>(std::floor((coordinate + radius) / cellSize(radius))), 0, kFogCells - 1);
		}

		// In half cells from the square's middle, so the test is exact: a cell's centre on the disc.
		[[nodiscard]] bool onDisc(int column, int row) {
			const int x = 2 * column + 1 - kFogCells;
			const int y = 2 * row + 1 - kFogCells;
			return x * x + y * y <= kFogCells * kFogCells;
		}

	} // namespace

	bool LandFog::revealed(FogCell cell) const {
		return ((rows[static_cast<size_t>(cell.row)] >> cell.column) & 1U) != 0;
	}

	void LandFog::reveal(FogCell cell) {
		rows[static_cast<size_t>(cell.row)] |= uint64_t{1} << cell.column;
	}

	LandFog& LandFog::operator|=(const LandFog& other) {
		for (size_t row = 0; row < rows.size(); ++row) {
			rows[row] |= other.rows[row];
		}
		return *this;
	}

	FogCell fogCellAt(Point at, double radius) {
		assert(radius > 0 && "fogCellAt: a disc has a radius");
		return {.column = indexAt(at.x, radius), .row = indexAt(at.y, radius)};
	}

	Point fogCellCentre(FogCell cell, double radius) {
		const double size = cellSize(radius);
		return {.x = (cell.column + 0.5) * size - radius, .y = (cell.row + 0.5) * size - radius};
	}

	bool revealedAt(const LandFog& fog, Point at, double radius) {
		return fog.revealed(fogCellAt(at, radius));
	}

	void revealAround(LandFog& fog, std::span<const Point> line, double sight, double radius) {
		assert(!line.empty() && sight >= 0 && "revealAround: a line, and how far it's seen from");
		const double reach = sight * sight;
		const size_t segments = std::max<size_t>(line.size() - 1, 1);
		for (size_t index = 0; index < segments; ++index) {
			const Point	  a = line[index];
			const Point	  b = line[std::min(index + 1, line.size() - 1)];
			const FogCell low = fogCellAt({.x = std::min(a.x, b.x) - sight, .y = std::min(a.y, b.y) - sight}, radius);
			const FogCell high = fogCellAt({.x = std::max(a.x, b.x) + sight, .y = std::max(a.y, b.y) + sight}, radius);
			for (int row = low.row; row <= high.row; ++row) {
				for (int column = low.column; column <= high.column; ++column) {
					const FogCell cell{.column = column, .row = row};
					if (pointSegmentDistanceSquared(fogCellCentre(cell, radius), a, b) <= reach) {
						fog.reveal(cell);
					}
				}
			}
		}
	}

	double exploredShare(const LandFog& fog) {
		int cells = 0;
		int revealed = 0;
		for (int row = 0; row < kFogCells; ++row) {
			for (int column = 0; column < kFogCells; ++column) {
				if (onDisc(column, row)) {
					cells += 1;
					revealed += fog.revealed({.column = column, .row = row}) ? 1 : 0;
				}
			}
		}
		return static_cast<double>(revealed) / cells;
	}

} // namespace rules::map
