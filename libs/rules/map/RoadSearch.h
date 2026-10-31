#pragma once

#include "EdgeCostField.h"
#include "MoveCost.h"
#include "NodeHeap.h"

#include <cstdint>
#include <limits>
#include <optional>
#include <span>
#include <vector>

namespace rules::map {

	// The roads laid on the land grid so far, as the searches read them.
	struct LaidRoads {
		LaidRoads(int cells, int edges);

		// Per move, the best class laid along it as its rank, -1 for none, and the first highway's number.
		std::vector<int8_t> classes;
		std::vector<int8_t> highways;
		// Per cell, a bit for each move a road leaves it by...
		std::vector<uint16_t> mask;
		// ...1 where a road bridges over it east to west, 2 north to south...
		std::vector<uint8_t> leaps;
		// ...and 1 on or beside a road.
		std::vector<uint8_t> near;
	};

	// Where an A* aims: its goal's point and the most the goal's cells lie from it, and the ellipse with foci
	// at the start's point and the goal's that it keeps to.
	struct SearchAim {
		double fromX{0};
		double fromY{0};
		double x{0};
		double y{0};
		double reach{0};
		double limit{std::numeric_limits<double>::infinity()};
	};

	// Least-cost searches over the edge cost field and the roads laid on it (road-network.md, Searches). Existing
	// road costs 0.75 of new ground, existing highway 0.7 to a highway, so roads merge into trunks, and ground
	// right beside a road 1.6 times its own, so a road joins another or keeps its distance. A move never crosses
	// the other diagonal of its square, a road's or the path's own last two moves, never closes a triangle with
	// two road moves, and a bridge two cells long never crosses another over the same cell: where two paths
	// cross, they share a cell. Ties go to the lower cell. The scratch is reused, so a search allocates only
	// its path.
	class RoadSearch {
	  public:
		// The field and the roads have to outlive it.
		RoadSearch(EdgeCostField& field, const LaidRoads& laid);

		// The cheapest cells for `road` from one of `from` to one of `goals`: A* toward `aim` inside its ellipse,
		// its heuristic the straight distance at existing road's cost, which no move undercuts; or Dijkstra with
		// no aim. Empty where there's no path.
		[[nodiscard]] std::vector<int>
		find(std::span<const int> from, std::span<const int> goals, RoadClass road, const std::optional<SearchAim>& aim);

		// World units from one of `from` to one of `goals` over the roads laid, or infinity past `limit`.
		[[nodiscard]] double roadDistance(std::span<const int> from, std::span<const int> goals, double limit);

		// Searches run by find, and the cells they expanded.
		[[nodiscard]] int searches() const { return searchCount; }
		[[nodiscard]] int expanded() const { return expandedCount; }

	  private:
		EdgeCostField*		  field;
		const LaidRoads*	  laid;
		int					  size;
		std::vector<double>	  score;
		std::vector<int>	  came;
		std::vector<uint32_t> seen;
		std::vector<uint32_t> done;
		std::vector<uint32_t> goal;
		uint32_t			  lastStamp{0};
		NodeHeap			  heap;
		int					  searchCount{0};
		int					  expandedCount{0};

		uint32_t		   nextStamp();
		[[nodiscard]] bool crossesDiagonal(int cell, int direction, uint32_t current) const;
		[[nodiscard]] bool closesTriangle(int cell, int direction, int next) const;
	};

	// The cheapest path for a class from one cell to another over open ground where no road is laid, by A*
	// unbounded; empty where there's none.
	[[nodiscard]] std::vector<int> cheapestPath(EdgeCostField& field, int from, int to, RoadClass road);

} // namespace rules::map
