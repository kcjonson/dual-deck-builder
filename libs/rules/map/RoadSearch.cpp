#include "RoadSearch.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <functional>

namespace rules::map {

	namespace {

		constexpr double kInfinity = std::numeric_limits<double>::infinity();

		// Existing road costs `reuse` of new ground, and existing highway `highwayReuse` to a highway; ground right
		// beside a road costs `beside` times its own.
		struct Reuse {
			double reuse = 0.75;
			double highwayReuse = 0.7;
			double beside = 1.6;
		};

		constexpr Reuse kReuse;

		size_t at(int index) {
			return static_cast<size_t>(index);
		}

	} // namespace

	LaidRoads::LaidRoads(int cells, int edges)
		: classes(at(edges), -1),
		  highways(at(edges), -1),
		  mask(at(cells)),
		  leaps(at(cells)),
		  near(at(cells)) {}

	RoadSearch::RoadSearch(EdgeCostField& field, const LaidRoads& laid)
		: field(&field),
		  laid(&laid),
		  size(field.size()),
		  score(at(field.grid().cells())),
		  came(at(field.grid().cells())),
		  seen(at(field.grid().cells())),
		  done(at(field.grid().cells())),
		  goal(at(field.grid().cells())) {}

	std::vector<int>
	RoadSearch::find(std::span<const int> from, std::span<const int> goals, RoadClass road, const std::optional<SearchAim>& aim) {
		const uint32_t stamp = nextStamp();
		const bool	   highway = road == RoadClass::Highway;
		const double   unit = highway ? kReuse.highwayReuse : kReuse.reuse;
		const auto	   heuristic = [&](double x, double y) {
			if (!aim) {
				return 0.0;
			}
			const double distance = std::sqrt((x - aim->x) * (x - aim->x) + (y - aim->y) * (y - aim->y)) - aim->reach;
			return distance > 0 ? unit * distance : 0.0;
		};
		for (const int cell : goals) {
			goal[at(cell)] = stamp;
		}
		heap.clear();
		for (const int cell : from) {
			seen[at(cell)] = stamp;
			score[at(cell)] = 0;
			came[at(cell)] = -1;
			push(heuristic(field->x(cell), field->y(cell)), cell);
		}
		searchCount += 1;
		int found = -1;
		while (!heap.empty()) {
			const int cell = pop().second;
			if (done[at(cell)] == stamp) {
				continue;
			}
			done[at(cell)] = stamp;
			expandedCount += 1;
			if (goal[at(cell)] == stamp) {
				found = cell;
				break;
			}
			const double   base = score[at(cell)];
			const uint16_t mask = laid->mask[at(cell)];
			for (int direction = 0; direction < kMoves; ++direction) {
				const int next = field->step(cell, direction);
				if (done[at(next)] == stamp) {
					continue;
				}
				const bool leap = direction >= kNeighbours;
				if (leap) {
					const int over = (cell + next) / 2;
					if (field->open(over) || (laid->leaps[at(over)] & (direction % 2 == 0 ? 2 : 1)) != 0) {
						continue;
					}
				}
				const double nextX = field->x(next);
				const double nextY = field->y(next);
				if (aim) {
					const double fromDistance =
						std::sqrt((nextX - aim->fromX) * (nextX - aim->fromX) + (nextY - aim->fromY) * (nextY - aim->fromY));
					const double toDistance = std::sqrt((nextX - aim->x) * (nextX - aim->x) + (nextY - aim->y) * (nextY - aim->y));
					if (fromDistance + toDistance > aim->limit) {
						continue;
					}
				}
				const int edge = field->edge(cell, direction);
				double	  cost = field->cost(edge, road);
				if (!(cost < kInfinity)) {
					continue;
				}
				const int8_t onRoad = laid->classes[at(edge)];
				if (onRoad >= 0) {
					cost *= highway && onRoad == static_cast<int8_t>(RoadClass::Highway) ? kReuse.highwayReuse : kReuse.reuse;
				} else {
					if (!leap && direction % 2 == 1 && crossesDiagonal(cell, direction, stamp)) {
						continue;
					}
					if (laid->mask[at(next)] != 0) {
						if (!leap && mask != 0 && closesTriangle(cell, direction, next)) {
							continue;
						}
					} else if (laid->near[at(next)] != 0) {
						cost *= kReuse.beside;
					}
				}
				const double reached = base + cost;
				if (seen[at(next)] == stamp && !(reached < score[at(next)])) {
					continue;
				}
				seen[at(next)] = stamp;
				score[at(next)] = reached;
				came[at(next)] = cell;
				push(reached + heuristic(nextX, nextY), next);
			}
		}
		std::vector<int> path;
		for (int cell = found; cell >= 0; cell = came[at(cell)]) {
			path.push_back(cell);
		}
		std::ranges::reverse(path);
		return path;
	}

	double RoadSearch::roadDistance(std::span<const int> from, std::span<const int> goals, double limit) {
		const uint32_t stamp = nextStamp();
		for (const int cell : goals) {
			goal[at(cell)] = stamp;
		}
		heap.clear();
		for (const int cell : from) {
			seen[at(cell)] = stamp;
			score[at(cell)] = 0;
			push(0, cell);
		}
		while (!heap.empty()) {
			const auto [distance, cell] = pop();
			if (done[at(cell)] == stamp) {
				continue;
			}
			if (distance > limit) {
				return kInfinity;
			}
			if (goal[at(cell)] == stamp) {
				return distance;
			}
			done[at(cell)] = stamp;
			const uint16_t mask = laid->mask[at(cell)];
			for (int direction = 0; direction < kMoves; ++direction) {
				if ((mask & (1U << direction)) == 0) {
					continue;
				}
				const int next = field->step(cell, direction);
				if (done[at(next)] == stamp) {
					continue;
				}
				const double reached = distance + field->length(field->edge(cell, direction));
				if (seen[at(next)] == stamp && !(reached < score[at(next)])) {
					continue;
				}
				seen[at(next)] = stamp;
				score[at(next)] = reached;
				push(reached, next);
			}
		}
		return kInfinity;
	}

	uint32_t RoadSearch::nextStamp() {
		lastStamp += 1;
		return lastStamp;
	}

	// By key, then by cell, so ties never hang on the heap's own order.
	void RoadSearch::push(double key, int cell) {
		heap.emplace_back(key, cell);
		std::ranges::push_heap(heap, std::greater<>{});
	}

	std::pair<double, int> RoadSearch::pop() {
		std::ranges::pop_heap(heap, std::greater<>{});
		const std::pair<double, int> top = heap.back();
		heap.pop_back();
		return top;
	}

	// Whether the diagonal move from `cell` crosses its square's other diagonal: a road's, or the path's own last
	// two moves, which a zigzag round a blocked square's side could make.
	bool RoadSearch::crossesDiagonal(int cell, int direction, uint32_t current) const {
		const auto move = static_cast<size_t>(direction);
		const int  side = cell + kMoveX[move];
		const int  across = moveBetween(-kMoveX[move], kMoveY[move]);
		if ((laid->mask[at(side)] & (1U << across)) != 0) {
			return true;
		}
		const int above = cell + kMoveY[move] * size;
		const int back = came[at(cell)];
		if (back == side) {
			return seen[at(side)] == current && came[at(side)] == above;
		}
		if (back == above) {
			return seen[at(above)] == current && came[at(above)] == side;
		}
		return false;
	}

	// Whether the move from `cell` to `next`, both on roads, closes a triangle with two road moves.
	bool RoadSearch::closesTriangle(int cell, int direction, int next) const {
		const uint16_t mask = laid->mask[at(cell)];
		const uint16_t nextMask = laid->mask[at(next)];
		for (int other = 0; other < kNeighbours; ++other) {
			if (other == direction || (mask & (1U << other)) == 0) {
				continue;
			}
			const int columns = kMoveX[at(other)] - kMoveX[at(direction)];
			const int rows = kMoveY[at(other)] - kMoveY[at(direction)];
			if (columns < -1 || columns > 1 || rows < -1 || rows > 1) {
				continue;
			}
			if ((nextMask & (1U << moveBetween(columns, rows))) != 0) {
				return true;
			}
		}
		return false;
	}

	std::vector<int> cheapestPath(EdgeCostField& field, int from, int to, RoadClass road) {
		const LaidRoads			 nothing(field.grid().cells(), field.edges());
		RoadSearch				 search(field, nothing);
		const std::array<int, 1> start{from};
		const std::array<int, 1> goal{to};
		return search.find(
			start, goal, road, SearchAim{.fromX = field.x(from), .fromY = field.y(from), .x = field.x(to), .y = field.y(to)}
		);
	}

} // namespace rules::map
