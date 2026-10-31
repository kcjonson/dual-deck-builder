#include <rules/map/Drainage.h>
#include <rules/map/Lakes.h>
#include <rules/map/MapTesting.h>

#include <random/Rng.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <functional>
#include <span>
#include <utility>
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

	// A bowl draining to its south-west corner with a pit four cells across and a unit deep in it.
	struct PitLand {
		LandGrid			grid{.size = 12, .cellSize = 10, .halfExtent = 60};
		std::vector<double> elevation;
		std::vector<double> levels;
	};

	PitLand pitLand() {
		PitLand land;
		land.elevation = heightsOf(12, [](int column, int row) {
			const bool pit = column >= 6 && column <= 7 && row >= 6 && row <= 7;
			return 0.01 * (column + row) - (pit ? 0.1 : 0);
		});
		DrainageRouter router(12);
		router.route(land.elevation, std::vector<int>{0});
		land.levels.assign(router.levels().begin(), router.levels().end());
		return land;
	}

	std::vector<uint8_t> nothingBlocked(const LandGrid& grid) {
		return std::vector<uint8_t>(static_cast<size_t>(grid.cells()));
	}

	TEST(Lakes, MeasuresAValleyBelowTheLowerOfItsSidesAcrossItsDeepestDirection) {
		const int				  size = 11;
		const std::vector<double> vee = heightsOf(size, [](int column, int) { return 0.1 * std::abs(column - 5); });
		EXPECT_NEAR(valleyDepth(vee, size, 5 * size + 5), 0.3, 1e-12);
		const std::vector<double> slope = heightsOf(size, [](int column, int row) { return 0.1 * column + 0.05 * row; });
		EXPECT_EQ(valleyDepth(slope, size, 5 * size + 5), 0);
		EXPECT_EQ(valleyDepth(vee, size, 1 * size + 5), 0);
	}

	TEST(Lakes, MakesAPitInWetCountryALakeAtTheLevelItFillsTo) {
		const PitLand			  land = pitLand();
		const std::vector<double> wet(land.elevation.size(), 0.8);
		std::vector<uint8_t>	  blocked = nothingBlocked(land.grid);
		LakeCells				  lakes = emptyLakeCells(land.elevation.size());
		naturalLakes({.grid = land.grid, .elevation = land.elevation, .levels = land.levels, .moisture = wet}, blocked, lakes);
		ASSERT_EQ(lakes.lakes.size(), 1U);
		const Lake& lake = lakes.lakes[0];
		EXPECT_EQ(lake.kind, LakeKind::Natural);
		EXPECT_EQ(lake.cells, 4);
		EXPECT_FALSE(lake.dam.has_value());
		for (size_t cell = 0; cell < land.elevation.size(); ++cell) {
			if (lakes.lakeOf[cell] == 0) {
				EXPECT_EQ(lakes.level[cell], land.levels[cell]);
				EXPECT_GT(lakes.level[cell], land.elevation[cell]);
			}
		}
		// The cells round it are blocked, so no later lake touches it.
		EXPECT_EQ(blocked[static_cast<size_t>(5 * 12 + 5)], 1);

		const std::vector<double> depth = lakeDepthField(land.grid, land.elevation, lakes);
		for (size_t cell = 0; cell < depth.size(); ++cell) {
			if (lakes.lakeOf[cell] >= 0) {
				EXPECT_GE(depth[cell], kLakeShore);
			} else {
				EXPECT_LE(depth[cell], -kLakeShore);
			}
		}
		EXPECT_EQ(depth[0], -1);
	}

	TEST(Lakes, LeavesAPitDryWhereTheCountryIsDryOrItTouchesBlockedGround) {
		const PitLand			  land = pitLand();
		const std::vector<double> dry(land.elevation.size(), 0.3);
		std::vector<uint8_t>	  blocked = nothingBlocked(land.grid);
		LakeCells				  lakes = emptyLakeCells(land.elevation.size());
		naturalLakes({.grid = land.grid, .elevation = land.elevation, .levels = land.levels, .moisture = dry}, blocked, lakes);
		EXPECT_TRUE(lakes.lakes.empty());

		const std::vector<double> wet(land.elevation.size(), 0.8);
		blocked[static_cast<size_t>(6 * 12 + 6)] = 1;
		naturalLakes({.grid = land.grid, .elevation = land.elevation, .levels = land.levels, .moisture = wet}, blocked, lakes);
		EXPECT_TRUE(lakes.lakes.empty());
	}

	// A valley running north to south down to an outlet on the south edge, its floor falling a tenth of a
	// unit a cell and its sides rising four tenths a cell.
	struct Valley {
		LandGrid			grid{.size = 40, .cellSize = 10, .halfExtent = 200};
		std::vector<double> elevation;
		std::vector<int>	receivers;
		std::vector<double> area;
	};

	Valley valley() {
		Valley land;
		land.elevation = heightsOf(40, [](int column, int row) { return 0.004 * std::abs(column - 20) + 0.001 * row; });
		DrainageRouter router(40);
		router.route(land.elevation, std::vector<int>{20});
		router.accumulate();
		land.receivers.assign(router.receivers().begin(), router.receivers().end());
		land.area.assign(router.area().begin(), router.area().end());
		return land;
	}

	TEST(Lakes, DamsARiverInAValleyAndFloodsItUpstreamHeldBehindTheDam) {
		const Valley		 land = valley();
		std::vector<uint8_t> blocked = nothingBlocked(land.grid);
		LakeCells			 lakes = emptyLakeCells(land.elevation.size());
		foundation::Rng		 rng(3);
		placeReservoirs(
			{.grid = land.grid,
			 .elevation = land.elevation,
			 .receivers = land.receivers,
			 .area = land.area,
			 .threshold = 100,
			 .count = 1,
			 .radius = 300,
			 .inner = 0},
			rng,
			blocked,
			lakes
		);
		ASSERT_EQ(lakes.lakes.size(), 1U);
		const Lake& lake = lakes.lakes[0];
		EXPECT_EQ(lake.kind, LakeKind::Reservoir);
		EXPECT_GE(lake.cells, 30);
		EXPECT_LE(lake.cells, 220);
		const double floor = land.elevation[static_cast<size_t>(cellAt(land.grid, lake.dam->x, lake.dam->y))];
		EXPECT_GE(lake.level - floor, 0.005);
		EXPECT_LE(lake.level - floor, 0.3);
		fixtures::expectHeldBehindItsDam(land.grid, land.elevation, land.receivers, lakes.lakeOf, 0, lake);
	}

	TEST(Lakes, PlacesNoReservoirWhenNoneAreAskedForOrEveryCandidateIsBlocked) {
		const Valley		 land = valley();
		LakeCells			 lakes = emptyLakeCells(land.elevation.size());
		foundation::Rng		 rng(3);
		std::vector<uint8_t> blocked = nothingBlocked(land.grid);
		const ReservoirArgs	 none{
			 .grid = land.grid,
			 .elevation = land.elevation,
			 .receivers = land.receivers,
			 .area = land.area,
			 .threshold = 100,
			 .count = 0,
			 .radius = 300,
			 .inner = 0,
		 };
		placeReservoirs(none, rng, blocked, lakes);
		EXPECT_TRUE(lakes.lakes.empty());
		std::vector<uint8_t> everywhere(blocked.size(), 1);
		ReservoirArgs		 one = none;
		one.count = 1;
		placeReservoirs(one, rng, everywhere, lakes);
		EXPECT_TRUE(lakes.lakes.empty());
	}

} // namespace
