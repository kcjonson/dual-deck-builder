#include <rules/map/Erosion.h>

#include <random/Rng.h>

#include <gtest/gtest.h>

#include <cmath>
#include <cstdlib>
#include <numbers>
#include <vector>

namespace {

	using namespace rules::map;

	double stepTo(int size, int cell, int receiver) {
		const bool diagonal = std::abs(cell / size - receiver / size) == 1 && std::abs(cell % size - receiver % size) == 1;
		return diagonal ? std::numbers::sqrt2 : 1;
	}

	TEST(Erosion, LiftsEveryCellButTheOutletsByDtUAnIterationWhenNothingErodes) {
		const int			size = 5;
		std::vector<double> heights(25);
		std::vector<double> uplift(25);
		for (int cell = 0; cell < 25; ++cell) {
			heights[static_cast<size_t>(cell)] = cell % size + cell / size;
			uplift[static_cast<size_t>(cell)] = 0.1 * (cell % size);
		}
		const std::vector<double> start = heights;
		const std::vector<int>	  outlets{0};
		DrainageRouter			  router(size);
		erode(
			{.heights = heights,
			 .upliftRate = uplift,
			 .outlets = outlets,
			 .iterations = 3,
			 .timeStep = 2,
			 .erodibility = 0,
			 .diffusion = 0},
			router
		);
		EXPECT_EQ(heights[0], start[0]);
		for (size_t cell = 1; cell < 25; ++cell) {
			EXPECT_NEAR(heights[cell], start[cell] + 3 * 2 * uplift[cell], 1e-12) << cell;
		}
	}

	TEST(Erosion, SettlesToStreamPowersSteadyStateEachCellUdOverKRootAreaAboveItsReceiver) {
		const int			size = 8;
		foundation::Rng		rng(8);
		std::vector<double> heights(static_cast<size_t>(size * size));
		for (int cell = 0; cell < size * size; ++cell) {
			heights[static_cast<size_t>(cell)] = 0.05 * (cell % size + cell / size) + 0.01 * rng.nextDouble();
		}
		const double			  uplift = 0.01;
		const double			  erodibility = 0.5;
		const std::vector<double> rate(heights.size(), uplift);
		const std::vector<int>	  outlets{0};
		DrainageRouter			  router(size);
		erode(
			{.heights = heights,
			 .upliftRate = rate,
			 .outlets = outlets,
			 .iterations = 400,
			 .timeStep = 1,
			 .erodibility = erodibility,
			 .diffusion = 0},
			router
		);
		for (int cell = 0; cell < size * size; ++cell) {
			const int receiver = router.receivers()[static_cast<size_t>(cell)];
			if (receiver < 0) {
				continue;
			}
			const double expected =
				uplift * stepTo(size, cell, receiver) / (erodibility * std::sqrt(router.area()[static_cast<size_t>(cell)]));
			const double above = heights[static_cast<size_t>(cell)] - heights[static_cast<size_t>(receiver)];
			EXPECT_NEAR(above, expected, 1e-9) << cell;
			EXPECT_GT(above, 0) << cell;
		}
	}

	TEST(Erosion, CutsEachCellTowardItsReceiversNewHeightNeverPastIt) {
		const int			size = 6;
		std::vector<double> heights(static_cast<size_t>(size * size));
		for (int cell = 0; cell < size * size; ++cell) {
			heights[static_cast<size_t>(cell)] = cell % size + 0.01 * (cell / size);
		}
		const std::vector<double> start = heights;
		const std::vector<double> rate(heights.size(), 0);
		const std::vector<int>	  outlets{0, 6, 12, 18, 24, 30};
		DrainageRouter			  router(size);
		erode(
			{.heights = heights,
			 .upliftRate = rate,
			 .outlets = outlets,
			 .iterations = 1,
			 .timeStep = 1.5,
			 .erodibility = 0.4,
			 .diffusion = 0},
			router
		);
		for (int cell = 0; cell < size * size; ++cell) {
			const int receiver = router.receivers()[static_cast<size_t>(cell)];
			if (receiver < 0) {
				continue;
			}
			EXPECT_LT(heights[static_cast<size_t>(cell)], start[static_cast<size_t>(cell)]) << cell;
			EXPECT_GT(heights[static_cast<size_t>(cell)], heights[static_cast<size_t>(receiver)]) << cell;
		}
	}

	TEST(Erosion, SmoothsASpikeByAShareOfTheFourNeighbourLaplacian) {
		std::vector<double> heights(25);
		heights[12] = 1;
		const std::vector<double> rate(25, 0);
		const std::vector<int>	  outlets{0};
		DrainageRouter			  router(5);
		erode(
			{.heights = heights,
			 .upliftRate = rate,
			 .outlets = outlets,
			 .iterations = 1,
			 .timeStep = 1,
			 .erodibility = 0,
			 .diffusion = 0.2},
			router
		);
		EXPECT_NEAR(heights[12], 1 - 4 * 0.2, 1e-12);
		for (const size_t cell : {7, 11, 13, 17}) {
			EXPECT_NEAR(heights[cell], 0.2, 1e-12);
		}
		for (const size_t cell : {6, 8, 16, 18}) {
			EXPECT_EQ(heights[cell], 0);
		}
	}

	TEST(Erosion, AveragesDownAndInterpolatesUpHoldingTheEdges) {
		const std::vector<double> fine{1, 3, 0, 0, 5, 7, 0, 0, 2, 2, 4, 4, 2, 2, 4, 4};
		const std::vector<double> coarse = downsample(fine, 4);
		EXPECT_EQ(coarse, (std::vector<double>{4, 0, 2, 4}));
		const std::vector<double> up = upsample(coarse, 2);
		ASSERT_EQ(up.size(), 16U);
		EXPECT_EQ(up[0], 4);
		EXPECT_EQ(up[3], 0);
		EXPECT_EQ(up[15], 4);
		EXPECT_DOUBLE_EQ(up[1], 4 + (0 - 4) * 0.25);
		EXPECT_DOUBLE_EQ(up[2], 4 + (0 - 4) * 0.75);
	}

} // namespace
