#include <rules/map/Drainage.h>

#include <random/Rng.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <functional>
#include <numbers>
#include <vector>

namespace {

	using namespace rules::map;

	std::vector<double> heightsOf(int size, const std::function<double(int, int)>& height) {
		std::vector<double> values(static_cast<size_t>(size * size));
		for (int row = 0; row < size; ++row) {
			for (int column = 0; column < size; ++column) {
				values[static_cast<size_t>(row * size + column)] = height(column, row);
			}
		}
		return values;
	}

	bool touching(int size, int a, int b) {
		return a != b && std::abs(a / size - b / size) <= 1 && std::abs(a % size - b % size) <= 1;
	}

	// The neighbour a cell falls to fastest per unit of distance on the levels, ties to the lower index.
	int steepestBelow(int size, const std::vector<double>& levels, int cell) {
		int	   best = -1;
		double steepest = 0;
		for (int next = 0; next < size * size; ++next) {
			if (!touching(size, cell, next)) {
				continue;
			}
			const double drop = levels[static_cast<size_t>(cell)] - levels[static_cast<size_t>(next)];
			if (!(drop > 0)) {
				continue;
			}
			const bool	 diagonal = cell / size != next / size && cell % size != next % size;
			const double fall = diagonal ? drop * 0.70710678118654752440 : drop;
			if (fall > steepest) {
				steepest = fall;
				best = next;
			}
		}
		return best;
	}

	struct Definition {
		std::vector<double> levels;
		std::vector<int>	receivers;
		std::vector<double> area;
	};

	// The drainage by its definition, to hold the router to: a priority flood from the outlets, each cell
	// reached at its own height or a flood rise above the cell that reached it, whichever is higher, and
	// settled the first time it's the lowest reached, found by scanning every cell; then each cell's
	// steepest fall on the levels, and its area summed into its receiver in the flood's order backwards.
	Definition floodByDefinition(int size, const std::vector<double>& heights, const std::vector<int>& outlets) {
		const int			 cells = size * size;
		std::vector<double>	 levels(static_cast<size_t>(cells));
		std::vector<uint8_t> reached(static_cast<size_t>(cells));
		std::vector<uint8_t> settled(static_cast<size_t>(cells));
		for (const int outlet : outlets) {
			levels[static_cast<size_t>(outlet)] = heights[static_cast<size_t>(outlet)];
			reached[static_cast<size_t>(outlet)] = 1;
		}
		std::vector<int> order;
		for (;;) {
			int cell = -1;
			for (int at = 0; at < cells; ++at) {
				if (reached[at] == 1 && settled[at] == 0 && (cell < 0 || levels[at] < levels[static_cast<size_t>(cell)])) {
					cell = at;
				}
			}
			if (cell < 0) {
				break;
			}
			settled[static_cast<size_t>(cell)] = 1;
			order.push_back(cell);
			const double raised = levels[static_cast<size_t>(cell)] + kFloodRise;
			for (int next = 0; next < cells; ++next) {
				if (touching(size, cell, next) && reached[static_cast<size_t>(next)] == 0) {
					reached[static_cast<size_t>(next)] = 1;
					levels[static_cast<size_t>(next)] = std::max(heights[static_cast<size_t>(next)], raised);
				}
			}
		}
		Definition definition{.levels = levels, .receivers = std::vector<int>(static_cast<size_t>(cells)), .area = {}};
		for (int cell = 0; cell < cells; ++cell) {
			const bool outlet = std::ranges::find(outlets, cell) != outlets.end();
			definition.receivers[static_cast<size_t>(cell)] = outlet ? -1 : steepestBelow(size, levels, cell);
		}
		definition.area.assign(static_cast<size_t>(cells), 1.0);
		for (size_t index = order.size(); index-- > 0;) {
			const int receiver = definition.receivers[static_cast<size_t>(order[index])];
			if (receiver >= 0) {
				definition.area[static_cast<size_t>(receiver)] += definition.area[static_cast<size_t>(order[index])];
			}
		}
		return definition;
	}

	Drainage route(int size, const std::vector<double>& heights, const std::vector<int>& outlets) {
		DrainageRouter router(size);
		router.route(heights, outlets);
		router.accumulate();
		return router.drainage();
	}

	// What every drainage keeps: receivers are touching neighbours below, every cell reaches an outlet,
	// the order is downstream first, and the outlets' areas count every cell.
	void expectDrainageShape(const Drainage& drainage, const std::vector<double>& heights) {
		const int		 size = drainage.size;
		const int		 cells = size * size;
		std::vector<int> place(static_cast<size_t>(cells), -1);
		for (size_t index = 0; index < drainage.order.size(); ++index) {
			place[static_cast<size_t>(drainage.order[index])] = static_cast<int>(index);
		}
		double outletArea = 0;
		for (int cell = 0; cell < cells; ++cell) {
			const auto at = static_cast<size_t>(cell);
			ASSERT_GE(place[at], 0) << "cell " << cell << " isn't in the order";
			EXPECT_GE(drainage.levels[at], heights[at]);
			const int receiver = drainage.receivers[at];
			if (receiver < 0) {
				EXPECT_NE(std::ranges::find(drainage.outlets, cell), drainage.outlets.end());
				EXPECT_EQ(drainage.levels[at], heights[at]);
				outletArea += drainage.area[at];
				continue;
			}
			EXPECT_TRUE(touching(size, cell, receiver));
			EXPECT_GT(drainage.levels[at], drainage.levels[static_cast<size_t>(receiver)]);
			EXPECT_GT(place[at], place[static_cast<size_t>(receiver)]);
		}
		EXPECT_EQ(outletArea, cells);
	}

	void expectSameAsDefinition(int size, const std::vector<double>& heights, const std::vector<int>& outlets) {
		const Drainage	 drainage = route(size, heights, outlets);
		const Definition definition = floodByDefinition(size, heights, outlets);
		EXPECT_EQ(drainage.levels, definition.levels);
		EXPECT_EQ(drainage.receivers, definition.receivers);
		EXPECT_EQ(drainage.area, definition.area);
		expectDrainageShape(drainage, heights);
	}

	TEST(Drainage, RoutesRandomLandAsTheFloodByDefinitionDoesPitsAndAll) {
		for (uint32_t seed = 1; seed <= 6; ++seed) {
			foundation::Rng			  rng(seed);
			const int				  size = 14;
			const std::vector<double> heights = heightsOf(size, [&](int, int) { return rng.nextDouble(); });
			expectSameAsDefinition(size, heights, {0, size * size - 1, 5 * size});
		}
	}

	TEST(Drainage, RoutesTerracedAndNearlyLevelLandTheSame) {
		foundation::Rng			  rng(9);
		const int				  size = 13;
		const std::vector<double> terraced =
			heightsOf(size, [&](int column, int row) { return std::floor((0.05 * (column + row) + 0.3 * rng.nextDouble()) * 4) / 4; });
		expectSameAsDefinition(size, terraced, {size - 1});
		const std::vector<double> level = heightsOf(size, [&](int, int) { return 0.5 + 1e-8 * rng.nextDouble(); });
		expectSameAsDefinition(size, level, {size * 6});
	}

	TEST(Drainage, DrainsAPlaneByItsSteepestFallDiagonalsIncluded) {
		const int size = 9;
		for (const double degrees : {10.0, 35.0}) {
			const double			  angle = degrees * std::numbers::pi / 180;
			const std::vector<double> heights =
				heightsOf(size, [&](int column, int row) { return -(std::cos(angle) * column + std::sin(angle) * row); });
			std::vector<int> outlets;
			for (int row = 0; row < size; ++row) {
				outlets.push_back(row * size + size - 1);
			}
			for (int column = 0; column < size - 1; ++column) {
				outlets.push_back((size - 1) * size + column);
			}
			const Drainage drainage = route(size, heights, outlets);
			const int	   step = degrees < 20 ? 1 : size + 1;
			for (int cell = 0; cell < size * size; ++cell) {
				const int receiver = drainage.receivers[static_cast<size_t>(cell)];
				if (receiver >= 0) {
					EXPECT_EQ(receiver, cell + step) << degrees << " degrees, cell " << cell;
				}
			}
		}
	}

	TEST(Drainage, FillsAPitToItsSpillAndDrainsItOverItWaterStandingInIt) {
		const int			size = 7;
		std::vector<double> heights = heightsOf(size, [](int column, int row) { return 0.1 * (column + row); });
		heights[static_cast<size_t>(3 * size + 3)] = -1;
		const Drainage drainage = route(size, heights, {0});
		EXPECT_GT(drainage.levels[static_cast<size_t>(3 * size + 3)], heights[static_cast<size_t>(3 * size + 3)]);
		EXPECT_EQ(drainage.levels[static_cast<size_t>(3 * size + 3)], heights[static_cast<size_t>(2 * size + 2)] + kFloodRise);
		expectDrainageShape(drainage, heights);
	}

	TEST(Drainage, DrainsAClosedBasinToItsOneSinkInsideTheGrid) {
		const int				  size = 9;
		const std::vector<double> heights = heightsOf(size, [](int column, int row) { return std::hypot(column - 4, row - 4); });
		const Drainage			  drainage = route(size, heights, {4 * size + 4});
		EXPECT_EQ(drainage.area[static_cast<size_t>(4 * size + 4)], size * size);
		expectDrainageShape(drainage, heights);
	}

	TEST(Drainage, BreaksTiesByCellIndexNeverByTheOrderOutletsAreListedIn) {
		const int				  size = 8;
		const std::vector<double> flat(static_cast<size_t>(size * size), 0.25);
		const Drainage			  one = route(size, flat, {0, size * size - 1});
		const Drainage			  other = route(size, flat, {size * size - 1, 0});
		EXPECT_EQ(one.receivers, other.receivers);
		EXPECT_EQ(one.levels, other.levels);
		expectDrainageShape(one, flat);
	}

	TEST(DrainageRouter, RoutesTheSameReusedAsFresh) {
		foundation::Rng			  rng(4);
		const int				  size = 12;
		const std::vector<double> first = heightsOf(size, [&](int, int) { return rng.nextDouble(); });
		const std::vector<double> second = heightsOf(size, [&](int, int) { return rng.nextDouble(); });
		DrainageRouter			  router(size);
		router.route(first, std::vector<int>{3});
		router.route(second, std::vector<int>{7, 100});
		router.accumulate();
		const Drainage fresh = route(size, second, {7, 100});
		const Drainage reused = router.drainage();
		EXPECT_EQ(reused.levels, fresh.levels);
		EXPECT_EQ(reused.receivers, fresh.receivers);
		EXPECT_EQ(reused.area, fresh.area);
		EXPECT_EQ(reused.outlets, fresh.outlets);
	}

} // namespace
