#include <rules/map/Rivers.h>

#include <gtest/gtest.h>

#include <vector>

namespace {

	using namespace rules::map;

	// A tree of ten cells draining to cell 0: a main stem 8, 7, 3, 2, 1, 0, a tributary 5, 4 joining it at 2,
	// and another 9, 6 joining at 1. With one unit of rain a cell and a threshold of 2, the river cells are
	// 7, 3, 2, 1, 0, 4 and 6.
	const std::vector<int>	  kReceivers{-1, 0, 1, 2, 2, 4, 1, 3, 7, 6};
	const std::vector<double> kArea{10, 9, 6, 3, 2, 1, 2, 2, 1, 1};

	std::vector<RiverChain> traced(const std::vector<int>& lakeOf, bool closedBasin = false) {
		return traceRivers({.receivers = kReceivers, .area = kArea, .threshold = 2, .lakeOf = lakeOf, .closedBasin = closedBasin});
	}

	TEST(Rivers, SetsTheThresholdByRiverDensityAndWidensWithTheSquareRootOfTheArea) {
		EXPECT_EQ(riverThreshold(0), 700);
		EXPECT_EQ(riverThreshold(1), 110);
		EXPECT_GT(riverThreshold(0.4), riverThreshold(0.6));
		EXPECT_DOUBLE_EQ(riverWidth(400, 400), 1.2);
		EXPECT_DOUBLE_EQ(riverWidth(1600, 400), 1.2 + 0.75);
		EXPECT_EQ(riverWidth(100, 400), 1.2);
		EXPECT_EQ(riverWidth(1e9, 400), 9);
	}

	TEST(Rivers, TracesEveryRiverCellIntoOneChainCarryingOnFromTheBiggestTributary) {
		const std::vector<RiverChain> chains = traced(std::vector<int>(10, -1));
		ASSERT_EQ(chains.size(), 3U);
		EXPECT_EQ(chains[0].cells, (std::vector<int>{4, 2}));
		EXPECT_EQ(chains[0].end, RiverEnd::Confluence);
		EXPECT_EQ(chains[0].into, 2);
		EXPECT_EQ(chains[1].cells, (std::vector<int>{6, 1}));
		EXPECT_EQ(chains[1].into, 2);
		EXPECT_EQ(chains[2].cells, (std::vector<int>{7, 3, 2, 1, 0}));
		EXPECT_EQ(chains[2].start, RiverStart::Source);
		EXPECT_EQ(chains[2].end, RiverEnd::Edge);
		EXPECT_EQ(chains[2].into, -1);
		EXPECT_EQ(traced(std::vector<int>(10, -1), true)[2].end, RiverEnd::Sink);
	}

	TEST(Rivers, EndsARiverInALakeAndStartsOneWhereTheLakeDrains) {
		std::vector<int> lakeOf(10, -1);
		lakeOf[2] = 0;
		const std::vector<RiverChain> chains = traced(lakeOf);
		ASSERT_EQ(chains.size(), 4U);
		EXPECT_EQ(chains[0].cells, (std::vector<int>{2, 1, 0}));
		EXPECT_EQ(chains[0].start, RiverStart::Lake);
		EXPECT_EQ(chains[0].end, RiverEnd::Edge);
		EXPECT_EQ(chains[1].cells, (std::vector<int>{4, 2}));
		EXPECT_EQ(chains[1].end, RiverEnd::Lake);
		EXPECT_EQ(chains[1].into, 0);
		EXPECT_EQ(chains[2].cells, (std::vector<int>{6, 1}));
		EXPECT_EQ(chains[2].into, 0);
		EXPECT_EQ(chains[3].cells, (std::vector<int>{7, 3, 2}));
		EXPECT_EQ(chains[3].end, RiverEnd::Lake);
	}

} // namespace
