#pragma once

#include "Ground.h"
#include "LandGrid.h"
#include "MoveCost.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace rules::map {

	// A road's moves over the land grid, between cell centres: the eight to a neighbour, east first and
	// counterclockwise, then four bridges two cells straight on, east, north, west, and south.
	inline constexpr int					 kMoves = 12;
	inline constexpr int					 kNeighbours = 8;
	inline constexpr std::array<int, kMoves> kMoveX{1, 1, 0, -1, -1, -1, 0, 1, 2, 0, -2, 0};
	inline constexpr std::array<int, kMoves> kMoveY{0, 1, 1, 1, 0, -1, -1, -1, 0, 2, 0, -2};
	// Each move's way back.
	inline constexpr std::array<int, kMoves> kOpposite{4, 5, 6, 7, 0, 1, 2, 3, 10, 11, 8, 9};

	namespace detail {

		// Each cell files its forward moves: east, north-east, north, north-west, and the bridges east and north.
		inline constexpr int					 kSlots = 6;
		inline constexpr std::array<int, kSlots> kSlotMove{0, 1, 2, 3, 8, 9};
		inline constexpr std::array<int, kMoves> kSlotOf{0, 1, 2, 3, -1, -1, -1, -1, 4, 5, -1, -1};

		// The move by (columns + 2) * 5 + rows + 2.
		inline constexpr std::array<int, 25> kMoveByStep = [] {
			std::array<int, 25> moves{};
			moves.fill(-1);
			for (size_t move = 0; move < kMoves; ++move) {
				moves[static_cast<size_t>((kMoveX[move] + 2) * 5 + kMoveY[move] + 2)] = static_cast<int>(move);
			}
			return moves;
		}();

	} // namespace detail

	// The move from a cell to the one `columns` and `rows` off, or -1 for none.
	[[nodiscard]] constexpr int moveBetween(int columns, int rows) {
		if (columns < -2 || columns > 2 || rows < -2 || rows > 2) {
			return -1;
		}
		return detail::kMoveByStep[static_cast<size_t>((columns + 2) * 5 + rows + 2)];
	}

	// The id of the move from cell in direction on a grid size cells a side, the same from either end: filed
	// under the end it leaves forward, six to a cell.
	[[nodiscard]] constexpr int edgeId(int size, int cell, int direction) {
		const int slot = detail::kSlotOf[static_cast<size_t>(direction)];
		if (slot >= 0) {
			return cell * detail::kSlots + slot;
		}
		const auto move = static_cast<size_t>(direction);
		const int  from = cell + kMoveY[move] * size + kMoveX[move];
		return from * detail::kSlots + detail::kSlotOf[static_cast<size_t>(kOpposite[move])];
	}

	// The roads' per-map edge cost field (road-network.md, The edge cost field): what each move costs each
	// class, from MoveCost's parts at the cell centres, worked out the first time a search asks and kept. The
	// parts don't depend on the order moves are asked for, so neither does any search.
	//
	// It's stricter than MoveCost. Both ends have to be open. A move through a square where anything
	// impassable could stand is sampled every half unit from its lower-left end, so the same points whichever
	// way a road takes it, and blocked where a sample is impassable, bar river water under one of its bridges.
	// The metro's rivers, which cost nothing to cross, can't be driven along: no cell centre in one is open,
	// bar Home's own four round the origin, and their water has to be under a bridge too. A bridge two cells
	// long goes only over a cell whose centre is in a river, where a broad one leaves no dry centre close
	// enough either side.
	class EdgeCostField {
	  public:
		// The ground has to outlive it.
		EdgeCostField(const Ground& ground, double curviness);

		[[nodiscard]] const Ground&	  ground() const { return *land; }
		[[nodiscard]] const LandGrid& grid() const { return landGrid; }
		[[nodiscard]] int			  size() const { return landGrid.size; }

		// A road can pass through the cell's centre: half a unit or more inside the rim, on passable ground.
		[[nodiscard]] bool open(int cell) const { return openCells[static_cast<size_t>(cell)] != 0; }
		// The cell centre's elevation, inside the rim.
		[[nodiscard]] double elevation(int cell) const { return heights[static_cast<size_t>(cell)]; }
		[[nodiscard]] double x(int cell) const { return cellCentre(landGrid, cell % landGrid.size); }
		[[nodiscard]] double y(int cell) const { return cellCentre(landGrid, cell / landGrid.size); }
		// The cell `direction` leads to.
		[[nodiscard]] int step(int cell, int direction) const {
			const auto move = static_cast<size_t>(direction);
			return cell + kMoveY[move] * landGrid.size + kMoveX[move];
		}

		// A move's id, the same from either end: filed under the end it leaves forward.
		[[nodiscard]] int edge(int cell, int direction) const { return edgeId(landGrid.size, cell, direction); }
		// Ids run from 0 to this.
		[[nodiscard]] int edges() const { return landGrid.cells() * detail::kSlots; }

		// What the move costs a class: infinity where it's blocked or too steep.
		[[nodiscard]] double cost(int edge, RoadClass road);
		// World units.
		[[nodiscard]] double length(int edge);
		// It crosses a river on a bridge, the metro's included.
		[[nodiscard]] bool bridged(int edge);
		// Rise over run along it.
		[[nodiscard]] double grade(int edge);
		// Moves worked out so far.
		[[nodiscard]] int worked() const { return workedCount; }

	  private:
		// What each class pays, worked out with the rest, since the searches ask for a move many times over.
		struct Move {
			double				  length{0};
			double				  grade{0};
			std::array<double, 3> costs{};
			uint8_t				  flags{0};
		};

		const Ground*		 land;
		MoveCost			 costs;
		LandGrid			 landGrid;
		double				 metroReachSquared{0};
		std::vector<uint8_t> openCells;
		std::vector<double>	 heights;
		// Per square between cell centres, what impassable could stand in it, as bits.
		std::vector<uint8_t> hazards;
		std::vector<Move>	 moves;
		int					 workedCount{0};

		const Move&			  workedOut(int edge);
		void				  work(int edge, Move& move);
		[[nodiscard]] bool	  metroRiver(double x, double y) const;
		[[nodiscard]] uint8_t hazardsOf(int cell, int direction) const;
		[[nodiscard]] bool	  clear(double x0, double y0, double x1, double y1, double length, uint8_t could) const;
	};

} // namespace rules::map
