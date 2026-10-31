#include <rules/map/RiverIndex.h>

#include <gtest/gtest.h>

#include <cmath>
#include <numbers>
#include <vector>

namespace {

	using namespace rules::map;

	// A river running north from (x, -length / 2) to (x, length / 2), its points `spacing` apart, its width
	// growing evenly from `south` to `north`.
	River straightRiver(double x, double south, double north, double length = 1000, double spacing = 10) {
		River	   river;
		const auto points = static_cast<int>(length / spacing);
		for (int point = 0; point <= points; ++point) {
			const double share = static_cast<double>(point) / points;
			river.line.push_back({.x = x, .y = -length / 2 + point * spacing, .width = south + (north - south) * share});
		}
		return river;
	}

	std::vector<RiverCrossing> crossings(const RiverIndex& index, double x0, double y0, double x1, double y1) {
		std::vector<RiverCrossing> found;
		index.forEachCrossing(x0, y0, x1, y1, [&](const RiverCrossing& crossing) { found.push_back(crossing); });
		return found;
	}

	TEST(RiverIndex, HoldsWaterWithinHalfTheRiversWidthOfItsCentreline) {
		const std::vector<River> rivers{straightRiver(40, 4, 4)};
		const RiverIndex		 index(rivers, 720);
		EXPECT_TRUE(index.contains(40, 0));
		EXPECT_TRUE(index.contains(41.9, 123));
		EXPECT_FALSE(index.contains(42.1, 123));
		EXPECT_FALSE(index.contains(37.9, -300));
		EXPECT_FALSE(index.contains(40, 600));
		EXPECT_FALSE(RiverIndex().contains(40, 0));
	}

	TEST(RiverIndex, RunsTheWidthStraightBetweenASegmentsEnds) {
		const std::vector<River> rivers{straightRiver(0, 2, 6, 100, 100)};
		const RiverIndex		 index(rivers, 720);
		EXPECT_TRUE(index.contains(1.9, 0));
		EXPECT_FALSE(index.contains(2.1, 0));
		EXPECT_TRUE(index.contains(2.9, 49));
		EXPECT_FALSE(index.contains(1.2, -49));
	}

	TEST(RiverIndex, FindsWhereAMoveCrossesHowWideTheWaterIsAndHowSquareOn) {
		const std::vector<River> rivers{straightRiver(40, 4, 4)};
		const RiverIndex		 index(rivers, 720);
		const auto				 square = crossings(index, 30, 5, 50, 5);
		ASSERT_EQ(square.size(), 1U);
		EXPECT_NEAR(square[0].along, 0.5, 1e-12);
		EXPECT_NEAR(square[0].width, 4, 1e-12);
		EXPECT_NEAR(square[0].sine, 1, 1e-12);
		// 30 degrees off the river's line.
		const auto askew = crossings(index, 35, 0, 45, 10 * std::sqrt(3.0));
		ASSERT_EQ(askew.size(), 1U);
		EXPECT_NEAR(askew[0].sine, 0.5, 1e-12);
		EXPECT_NEAR(askew[0].along, 0.5, 1e-12);
	}

	TEST(RiverIndex, CrossesNothingAlongsideARiverOrStoppingOnIt) {
		const std::vector<River> rivers{straightRiver(40, 4, 4)};
		const RiverIndex		 index(rivers, 720);
		EXPECT_TRUE(crossings(index, 41, -50, 41, 50).empty());
		EXPECT_TRUE(crossings(index, 30, 5, 40, 5).empty());
		EXPECT_TRUE(crossings(index, 30, 5, 39, 5).empty());
		EXPECT_TRUE(crossings(index, 30, 5, 30, 5).empty());
	}

	TEST(RiverIndex, CountsASegmentFiledInManyBucketsOnceAndEveryRiverTheMoveCrosses) {
		const std::vector<River> rivers{straightRiver(40, 4, 4, 1000, 1000), straightRiver(-60, 2, 2)};
		const RiverIndex		 index(rivers, 720);
		EXPECT_EQ(crossings(index, -100, 3, 100, 3).size(), 2U);
		EXPECT_EQ(crossings(index, -100, -150, 100, 150).size(), 2U);
		EXPECT_EQ(crossings(index, 0, -150, 100, 150).size(), 1U);
	}

	TEST(RiverIndex, CrossesARiverOnceThroughThePointWhereTwoOfItsSegmentsMeet) {
		const std::vector<River> rivers{straightRiver(40, 4, 4)};
		const RiverIndex		 index(rivers, 720);
		// The river has a point at (40, 10), which both moves pass through.
		EXPECT_EQ(crossings(index, 30, 10, 50, 10).size(), 1U);
		EXPECT_EQ(crossings(index, 30, 0, 50, 20).size(), 1U);
	}

} // namespace
