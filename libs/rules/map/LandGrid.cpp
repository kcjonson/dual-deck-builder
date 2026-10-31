#include "LandGrid.h"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>

namespace rules::map {

	namespace {

		// Catmull-Rom's four weights at t along a span between centres, and their derivatives in t.
		struct Weights {
			double w0, w1, w2, w3;
			double d0, d1, d2, d3;
		};

		Weights catmullRom(double t) {
			const double t2 = t * t;
			const double t3 = t2 * t;
			return {
				.w0 = 0.5 * (2 * t2 - t - t3),
				.w1 = 0.5 * (2 - 5 * t2 + 3 * t3),
				.w2 = 0.5 * (t + 4 * t2 - 3 * t3),
				.w3 = 0.5 * (t3 - t2),
				.d0 = 0.5 * (4 * t - 1 - 3 * t2),
				.d1 = 0.5 * (9 * t2 - 10 * t),
				.d2 = 0.5 * (1 + 8 * t - 9 * t2),
				.d3 = 0.5 * (3 * t2 - 2 * t),
			};
		}

		// Where a coordinate falls between centres: the centre at or before it, held a centre in from each
		// edge, how far past it, and whether the coordinate moves the sample there.
		struct Span {
			int	   index;
			double t;
			bool   moving;
		};

		Span spanAt(double position, int size) {
			const double fraction = position - 0.5;
			const double low = 1;
			const double high = size - 3;
			const double index = std::clamp(std::floor(fraction), low, high);
			const double t = fraction - index;
			if (t < 0 || t > 1) {
				return {.index = static_cast<int>(index), .t = t > 1 ? 1.0 : 0.0, .moving = false};
			}
			return {.index = static_cast<int>(index), .t = t, .moving = true};
		}

	} // namespace

	LandGrid landGridFor(int radius) {
		const int	 size = 2 * static_cast<int>(std::lround(radius * kCellsPerRadius / 2));
		const double halfExtent = kGridReach * radius;
		return {.size = size, .cellSize = 2 * halfExtent / size, .halfExtent = halfExtent};
	}

	LandGrid coarseGrid(const LandGrid& grid) {
		assert(grid.size % 2 == 0 && "coarseGrid: the grid's size is even");
		return {.size = grid.size / 2, .cellSize = grid.cellSize * 2, .halfExtent = grid.halfExtent};
	}

	double cellCentre(const LandGrid& grid, int index) {
		return -grid.halfExtent + (index + 0.5) * grid.cellSize;
	}

	int cellAt(const LandGrid& grid, double x, double y) {
		assert(std::isfinite(x) && std::isfinite(y) && "cellAt: a point is two finite numbers");
		const double column = std::floor((x + grid.halfExtent) / grid.cellSize);
		const double row = std::floor((y + grid.halfExtent) / grid.cellSize);
		if (column < 0 || row < 0 || column >= grid.size || row >= grid.size) {
			return -1;
		}
		return static_cast<int>(row) * grid.size + static_cast<int>(column);
	}

	GridSampler::GridSampler(const LandGrid& grid, std::span<const double> values)
		: grid(grid),
		  values(values) {
		assert(values.size() == static_cast<size_t>(grid.cells()) && "GridSampler: one value per cell");
		assert(grid.size >= 4 && "GridSampler: bicubic sampling needs 4 cells a side");
	}

	GridSample GridSampler::bicubic(double x, double y) const {
		assert(std::isfinite(x) && std::isfinite(y) && "GridSampler: a point is two finite numbers");
		const int	  size = grid.size;
		const Span	  across = spanAt((x + grid.halfExtent) / grid.cellSize, size);
		const Span	  up = spanAt((y + grid.halfExtent) / grid.cellSize, size);
		const Weights wx = catmullRom(across.t);
		const Weights wy = catmullRom(up.t);

		std::array<double, 4> rows{};
		std::array<double, 4> slopes{};
		for (int line = 0; line < 4; ++line) {
			const auto	 at = static_cast<size_t>((up.index - 1 + line) * size + across.index - 1);
			const double p0 = values[at];
			const double p1 = values[at + 1];
			const double p2 = values[at + 2];
			const double p3 = values[at + 3];
			rows[line] = wx.w0 * p0 + wx.w1 * p1 + wx.w2 * p2 + wx.w3 * p3;
			slopes[line] = wx.d0 * p0 + wx.d1 * p1 + wx.d2 * p2 + wx.d3 * p3;
		}
		const double rate = 1 / grid.cellSize;
		return {
			.value = wy.w0 * rows[0] + wy.w1 * rows[1] + wy.w2 * rows[2] + wy.w3 * rows[3],
			.gradientX = across.moving ? (wy.w0 * slopes[0] + wy.w1 * slopes[1] + wy.w2 * slopes[2] + wy.w3 * slopes[3]) * rate : 0,
			.gradientY = up.moving ? (wy.d0 * rows[0] + wy.d1 * rows[1] + wy.d2 * rows[2] + wy.d3 * rows[3]) * rate : 0,
		};
	}

} // namespace rules::map
