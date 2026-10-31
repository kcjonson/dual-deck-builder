#pragma once

#include <span>

namespace rules::map {

	// The square grid the land is generated on (Area Map Generation, World space): a fifth wider than the
	// disc each way, about 9.4 world units a cell, so the disc is a window onto a larger country. Cells run
	// row by row from the south-west corner: cell `row * size + column` is centred at
	// (cellCentre(column), cellCentre(row)).
	struct LandGrid {
		// Always even, so a grid of half the size covers it two cells to one.
		int	   size{0};
		double cellSize{0};
		// World units from the compound to each edge.
		double halfExtent{0};

		[[nodiscard]] int cells() const { return size * size; }

		bool operator==(const LandGrid&) const = default;
	};

	inline constexpr double kGridReach = 1.2;
	// 256 cells a side at radius 1000.
	inline constexpr double kCellsPerRadius = 0.256;

	// An even number of cells, scaled with the radius so cells stay about the same size.
	[[nodiscard]] LandGrid landGridFor(int radius);
	// Half the size over the same square, for erosion's coarse pass.
	[[nodiscard]] LandGrid coarseGrid(const LandGrid& grid);
	// World x of a column's centres, or y of a row's.
	[[nodiscard]] double cellCentre(const LandGrid& grid, int index);
	// The cell holding (x, y), or -1 off the grid.
	[[nodiscard]] int cellAt(const LandGrid& grid, double x, double y);

	struct GridSample {
		double value{0};
		// Per world unit east, and north.
		double gradientX{0};
		double gradientY{0};
	};

	// Reads a per-cell field at any point: Catmull-Rom through the cell centres, smooth in value and slope,
	// with its exact gradient, so hill shading and slopes show no facets. It needs a centre either side of
	// the two it runs between, so it covers the square out to the second centre from each edge and holds
	// the value past it, flat across the edge. Sampling allocates nothing.
	class GridSampler {
	  public:
		// `values` has one per cell and has to outlive the sampler.
		GridSampler(const LandGrid& grid, std::span<const double> values);

		[[nodiscard]] GridSample bicubic(double x, double y) const;

	  private:
		LandGrid				grid;
		std::span<const double> values;
	};

} // namespace rules::map
