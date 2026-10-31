#pragma once

#include <cstdint>
#include <span>
#include <vector>

namespace rules::map {

	// How far above its lowest neighbour's level a flooded cell's level stands at the least, so a filled pit
	// or flat drains outward from where it spills rather than in index order. It still raises a level for
	// heights within 2^30 of zero.
	inline constexpr double kFloodRise = 1e-7;

	// A grid's drainage as plain data, indexed by cell (row * size + column).
	struct Drainage {
		int size{0};
		// The neighbour each cell drains to, one of its eight, or -1 at an outlet.
		std::vector<int> receivers;
		// The level water reaches in each cell: its height, or more in a pit or on a flat, where it stands
		// until it spills. Always above its receiver's.
		std::vector<double> levels;
		// The cells that drain through each, its own included.
		std::vector<double> area;
		// Every cell, each after the cell it drains to: downstream first.
		std::vector<int> order;
		std::vector<int> outlets;
	};

	// Drainage on the land grid (Area Map Generation, Pipeline, 1. Terrain). A cell's level is its height,
	// or kFloodRise above its lowest neighbour's level where that's higher, and an outlet's is its height:
	// a priority flood's levels (Barnes et al. 2014), the one solution of that rule, so any way of finding
	// them gives the same bits. Each cell drains to the neighbour it falls to most steeply on the levels, a
	// diagonal's drop counted at 1 / sqrt(2), ties to the lower index, so water runs downhill everywhere.
	//
	// Routes grids of one size over and over, allocating nothing after the first: erosion routes once an
	// iteration.
	class DrainageRouter {
	  public:
		explicit DrainageRouter(int size);

		// Fills receivers, levels and order for `heights` draining to `outlets`, edge cells or not. Every
		// height is finite and every outlet a distinct cell.
		void route(std::span<const double> heights, std::span<const int> outlets);
		// Fills area from the last route, one a cell.
		void accumulate();

		[[nodiscard]] int					  size() const { return gridSize; }
		[[nodiscard]] std::span<const int>	  receivers() const { return receiverOf; }
		[[nodiscard]] std::span<const double> levels() const { return levelOf; }
		[[nodiscard]] std::span<const double> area() const { return areaOf; }
		[[nodiscard]] std::span<const int>	  order() const { return downstreamFirst; }

		// The last route and accumulate as plain data.
		[[nodiscard]] Drainage drainage() const;

	  private:
		struct Pending {
			double level;
			int	   cell;
		};

		int					 gridSize;
		std::vector<int>	 receiverOf;
		std::vector<double>	 levelOf;
		std::vector<double>	 areaOf;
		std::vector<int>	 downstreamFirst;
		std::vector<int>	 outletCells;
		std::vector<uint8_t> reached;
		std::vector<uint8_t> isOutlet;
		// Cells reached at their own height wait in a min-heap by level, then index; cells reached under
		// water, a flood rise above the level just settled, wait in a FIFO, whose levels never fall. Settling
		// the lower of the two fronts each time keeps the flood in level order.
		std::vector<Pending> heap;
		std::vector<int>	 fifo;

		void push(double level, int cell);
		int	 pop();
		void findReceivers();
	};

} // namespace rules::map
