#include "EdgeCostField.h"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <initializer_list>
#include <limits>

namespace rules::map {

	namespace {

		constexpr double kInfinity = std::numeric_limits<double>::infinity();
		// Cell centres keep this far inside the rim, so every road stays in the disc.
		constexpr double kRimInset = 0.5;
		// World units between the samples along a move through a square where something impassable could stand.
		constexpr double kSampleSpacing = 0.5;
		// World units past a river's water, or a crater's rim, that a square counts as near it.
		constexpr double kMargin = 1;
		// A lake could reach a square with a corner this deep, a little short of the shore at 0.
		constexpr double kLakeCorner = -0.001;

		// What could stand in a square, as bits, each in obstacle's own terms: a cliff where the land's open
		// squares say one could; a lake where a corner is under water, or nearly, since bilinear can't pass its
		// corners; a river where its water and a unit more reach; a crater likewise. A move's two open ends lie
		// inside the disc, which is convex, so nothing past the rim is between them.
		constexpr uint8_t kCliff = 1;
		constexpr uint8_t kLake = 2;
		constexpr uint8_t kRiver = 4;
		constexpr uint8_t kCrater = 8;
		constexpr uint8_t kEverything = kCliff | kLake | kRiver | kCrater;

		// A move's flags.
		constexpr uint8_t kWorked = 1;
		constexpr uint8_t kBlocked = 2;
		constexpr uint8_t kBridged = 4;

		// On Home's own four cells round the origin, which the compound stands on: it can stand in a river, so
		// its roads leave it through the water.
		bool atHome(double x, double y, double cell) {
			return x <= cell && x >= -cell && y <= cell && y >= -cell;
		}

	} // namespace

	EdgeCostField::EdgeCostField(const Ground& ground, double curviness)
		: land(&ground),
		  costs(ground, curviness),
		  landGrid(ground.terrain().surface().grid) {
		const double reach = ground.terrain().start().metro + kMetroBridges;
		metroReachSquared = reach * reach;
		const int  size = landGrid.size;
		const auto cells = static_cast<size_t>(landGrid.cells());
		openCells.assign(cells, 0);
		heights.assign(cells, 0);
		const double rim = ground.terrain().radius() - kRimInset;
		for (int row = 0; row < size; ++row) {
			const double y = cellCentre(landGrid, row);
			for (int column = 0; column < size; ++column) {
				const double x = cellCentre(landGrid, column);
				if (x * x + y * y >= rim * rim) {
					continue;
				}
				const auto cell = static_cast<size_t>(row * size + column);
				heights[cell] = ground.terrain().elevation(x, y);
				if (ground.obstacle(x, y) == Obstacle::None && !metroRiver(x, y)) {
					openCells[cell] = 1;
				}
			}
		}

		const int  squares = size - 1;
		const auto open = ground.terrain().fields().openSquares();
		const auto lakeDepth = ground.water().lakeDepth();
		hazards.assign(static_cast<size_t>(squares) * static_cast<size_t>(squares), 0);
		for (int row = 0; row < squares; ++row) {
			for (int column = 0; column < squares; ++column) {
				const auto corner = static_cast<size_t>(row * size + column);
				const auto north = corner + static_cast<size_t>(size);
				const bool lake = lakeDepth[corner] > kLakeCorner || lakeDepth[corner + 1] > kLakeCorner ||
								  lakeDepth[north] > kLakeCorner || lakeDepth[north + 1] > kLakeCorner;
				const auto square = static_cast<size_t>(row * squares + column);
				hazards[square] = static_cast<uint8_t>((open[square] == 0 ? kCliff : 0) | (lake ? kLake : 0));
			}
		}
		const auto squareOf = [&](double value) {
			return static_cast<int>(std::clamp(std::floor((value + landGrid.halfExtent) / landGrid.cellSize - 0.5), 0.0, squares - 1.0));
		};
		const auto mark = [&](double minX, double minY, double maxX, double maxY, uint8_t bit) {
			for (int row = squareOf(minY); row <= squareOf(maxY); ++row) {
				for (int column = squareOf(minX); column <= squareOf(maxX); ++column) {
					hazards[static_cast<size_t>(row * squares + column)] |= bit;
				}
			}
		};
		ground.rivers().forEachWaterBox([&](double minX, double minY, double maxX, double maxY) {
			mark(minX - kMargin, minY - kMargin, maxX + kMargin, maxY + kMargin, kRiver);
		});
		for (const Hotspot& site : ground.hotspots()) {
			const double craterReach = site.craterRadius + kMargin;
			mark(site.x - craterReach, site.y - craterReach, site.x + craterReach, site.y + craterReach, kCrater);
		}
		moves.assign(static_cast<size_t>(edges()), {});
	}

	double EdgeCostField::cost(int edge, RoadClass road) {
		return workedOut(edge).costs[static_cast<size_t>(road)];
	}

	double EdgeCostField::length(int edge) {
		return workedOut(edge).length;
	}

	bool EdgeCostField::bridged(int edge) {
		return (workedOut(edge).flags & kBridged) != 0;
	}

	double EdgeCostField::grade(int edge) {
		return workedOut(edge).grade;
	}

	const EdgeCostField::Move& EdgeCostField::workedOut(int edge) {
		assert(edge >= 0 && edge < edges() && "EdgeCostField: a move's id is one of the field's");
		Move& move = moves[static_cast<size_t>(edge)];
		if ((move.flags & kWorked) == 0) {
			work(edge, move);
		}
		return move;
	}

	void EdgeCostField::work(int edge, Move& move) {
		workedCount += 1;
		move.flags = kWorked | kBlocked;
		move.costs.fill(kInfinity);
		const int size = landGrid.size;
		const int from = edge / detail::kSlots;
		const int direction = detail::kSlotMove[static_cast<size_t>(edge % detail::kSlots)];
		const int column = from % size;
		const int row = from / size;
		const int toColumn = column + kMoveX[static_cast<size_t>(direction)];
		const int toRow = row + kMoveY[static_cast<size_t>(direction)];
		if (toColumn < 0 || toColumn >= size || toRow >= size) {
			return;
		}
		const int	 to = toRow * size + toColumn;
		const double x0 = cellCentre(landGrid, column);
		const double y0 = cellCentre(landGrid, row);
		const double x1 = cellCentre(landGrid, toColumn);
		const double y1 = cellCentre(landGrid, toRow);
		move.length = std::sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
		const bool leap = direction >= kNeighbours;
		if (!open(from) || !open(to) || (leap && open((from + to) / 2))) {
			return;
		}
		const MoveParts parts = costs.parts({.x0 = x0, .y0 = y0, .x1 = x1, .y1 = y1, .height0 = elevation(from), .height1 = elevation(to)});
		if (parts.blocked) {
			return;
		}
		const double middleX = x0 + 0.5 * (x1 - x0);
		const double middleY = y0 + 0.5 * (y1 - y0);
		const bool	 wet = parts.middle == Obstacle::River || (parts.middle == Obstacle::None && metroRiver(middleX, middleY));
		if ((wet && !parts.bridged) || (leap && !wet)) {
			return;
		}
		const uint8_t could = leap ? kEverything : hazardsOf(from, direction);
		if (could != 0 && !clear(x0, y0, x1, y1, parts.length, could)) {
			return;
		}
		move.grade = parts.grade;
		for (const RoadClass road : {RoadClass::Highway, RoadClass::BackRoad, RoadClass::Trail}) {
			move.costs[static_cast<size_t>(road)] = costs.weigh(parts, road).cost;
		}
		move.flags = static_cast<uint8_t>(kWorked | (parts.bridged ? kBridged : 0));
	}

	bool EdgeCostField::metroRiver(double x, double y) const {
		return x * x + y * y <= metroReachSquared && !atHome(x, y, landGrid.cellSize) && land->waterAt(x, y) == WaterKind::River;
	}

	uint8_t EdgeCostField::hazardsOf(int cell, int direction) const {
		const int  squares = landGrid.size - 1;
		const int  column = cell % landGrid.size;
		const int  row = cell / landGrid.size;
		const auto at = [&](int squareColumn, int squareRow) -> uint8_t {
			if (squareColumn < 0 || squareRow < 0 || squareColumn >= squares || squareRow >= squares) {
				return kEverything;
			}
			return hazards[static_cast<size_t>(squareRow * squares + squareColumn)];
		};
		switch (direction) {
			case 0:
				return static_cast<uint8_t>(at(column, row - 1) | at(column, row));
			case 1:
				return at(column, row);
			case 2:
				return static_cast<uint8_t>(at(column - 1, row) | at(column, row));
			default:
				return at(column - 1, row);
		}
	}

	bool EdgeCostField::clear(double x0, double y0, double x1, double y1, double length, uint8_t could) const {
		const std::vector<BridgeSpan> spans = (could & kRiver) != 0 ? costs.bridgeSpans(x0, y0, x1, y1) : std::vector<BridgeSpan>{};
		// From the lower-left end, so a move is sampled at the same points whichever way a road takes it.
		const bool		  forward = x0 < x1 || (x0 == x1 && y0 <= y1);
		const double	  startX = forward ? x0 : x1;
		const double	  startY = forward ? y0 : y1;
		const double	  endX = forward ? x1 : x0;
		const double	  endY = forward ? y1 : y0;
		const auto		  inner = static_cast<int>(std::ceil(length / kSampleSpacing)) - 1;
		const GridSampler lakes(landGrid, land->water().lakeDepth());
		for (int sample = 1; sample <= inner; ++sample) {
			const double share = sample * kSampleSpacing / length;
			const double x = startX + (endX - startX) * share;
			const double y = startY + (endY - startY) * share;
			if ((could & kCrater) != 0 && land->crater(x, y)) {
				return false;
			}
			// Rivers, the metro's included, are passable only under a bridge, bar on Home's cells.
			bool river = false;
			if ((could & kRiver) != 0) {
				const WaterKind water = land->waterAt(x, y);
				if (water == WaterKind::Lake) {
					return false;
				}
				river = water == WaterKind::River;
			} else if ((could & kLake) != 0 && lakes.bilinear(x, y) > 0) {
				return false;
			}
			if (river) {
				const double along = forward ? share : 1 - share;
				const bool	 decked =
					std::ranges::any_of(spans, [&](const BridgeSpan& span) { return along >= span.from && along <= span.to; });
				if (!decked && !atHome(x, y, landGrid.cellSize)) {
					return false;
				}
			} else if ((could & kCliff) != 0 && land->terrain().fields().cliff(x, y)) {
				return false;
			}
		}
		return true;
	}

} // namespace rules::map
