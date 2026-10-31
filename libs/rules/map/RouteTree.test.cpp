#include <rules/map/RouteTesting.h>
#include <rules/map/RouteTree.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <set>
#include <vector>

namespace {

	using namespace rules::map;
	using fixtures::MeshEdge;
	using fixtures::meshFrom;

	RouteTree treeOf(const RoadNetwork& network, double travelPace = 1, double routeSplit = 0.5) {
		return buildRouteTree({.network = network, .travelPace = travelPace, .routeSplit = routeSplit});
	}

	// A square of four nodes, the compound at one corner: node 3 is as far from home either way round.
	const std::vector<Point> kSquare{{0, 0}, {100, 0}, {0, 100}, {100, 100}};

	TEST(RouteTree, TakesEachNodesQuickestWayHomeAtTheClassesSpeeds) {
		const RoadNetwork network = meshFrom(kSquare, {{0, 1}, {0, 2, RoadClass::Highway}, {1, 3}, {2, 3, RoadClass::Highway}});
		const RouteTree	  tree = treeOf(network);
		EXPECT_EQ(tree.parentNode, (std::vector<int>{-1, 0, 0, 2}));
		EXPECT_EQ(tree.parentStretch, (std::vector<int>{-1, 0, 1, 3}));
		EXPECT_EQ(tree.depth, (std::vector<int>{0, 1, 1, 2}));
		EXPECT_DOUBLE_EQ(tree.hours[3], 200 / kRoadSpeeds[0]);
		EXPECT_DOUBLE_EQ(tree.hours[1], 100 / kRoadSpeeds[1]);
		EXPECT_EQ(hoursFor(260, RoadClass::Highway, 1), 1);
		EXPECT_EQ(hoursFor(90, RoadClass::Trail, 2), 2);
	}

	TEST(RouteTree, BreaksATieToTheLowerStretchIdHoweverTheStretchesAreListedOrRun) {
		const RouteTree first = treeOf(meshFrom(kSquare, {{0, 1}, {0, 2}, {1, 3}, {2, 3}}));
		EXPECT_EQ(first.parentStretch[3], 2);
		EXPECT_EQ(first.parentNode[3], 1);
		const RouteTree swapped = treeOf(meshFrom(kSquare, {{0, 1}, {0, 2}, {2, 3}, {1, 3}}));
		EXPECT_EQ(swapped.parentStretch[3], 2);
		EXPECT_EQ(swapped.parentNode[3], 2);
		const RouteTree reversed = treeOf(meshFrom(kSquare, {{1, 0}, {2, 0}, {3, 1}, {3, 2}}));
		EXPECT_EQ(reversed.parentNode, (std::vector<int>{-1, 0, 0, 1}));
	}

	TEST(RouteTree, ScalesHoursByTheTravelPaceWithoutMovingTheTree) {
		const RoadNetwork network = fixtures::randomMesh({.seed = 5, .radius = 600});
		const RouteTree	  usual = treeOf(network);
		const RouteTree	  slow = treeOf(network, 2);
		EXPECT_EQ(slow.parentStretch, usual.parentStretch);
		for (size_t node = 0; node < usual.hours.size(); ++node) {
			EXPECT_NEAR(slow.hours[node], 2 * usual.hours[node], 1e-9);
		}
	}

	TEST(RouteTree, LeavesANodeNoRoadReachesWithoutAWayHome) {
		std::vector<Point> points = kSquare;
		points.push_back({500, 500});
		points.push_back({600, 500});
		const RouteTree tree = treeOf(meshFrom(points, {{0, 1}, {0, 2}, {1, 3}, {2, 3}, {4, 5}}));
		EXPECT_EQ(tree.parentNode[4], -1);
		EXPECT_EQ(tree.depth[5], -1);
		EXPECT_TRUE(std::isinf(tree.hours[4]));
		EXPECT_EQ(splitNode(tree, 3, 4), -1);
		EXPECT_FALSE(splitsInTime(tree, 3, 4, 1));
		for (const MeetingPoint& point : tree.meetingPoints) {
			EXPECT_TRUE(std::ranges::all_of(point.from, [](int node) { return node < 4; }));
		}
	}

	// The properties every network's tree has, over random meshes that loop far more than real roads.
	TEST(RouteTree, GivesEveryNodeItsQuickestWayHomeAsATreeAndFindsMeetingPointsOffItSplitInTime) {
		int meetingPoints = 0;
		int threeWay = 0;
		for (uint32_t index = 0; index < 30; ++index) {
			const RoadNetwork network = fixtures::randomMesh({.seed = 100 + index, .radius = 400 + 20.0 * index});
			const RouteTree	  tree = treeOf(network);
			fixtures::expectQuickestTree(network, tree);
			fixtures::expectMeetingPointsOffTheWaysHome(network, tree, 0.5);
			meetingPoints += static_cast<int>(tree.meetingPoints.size());
			threeWay += static_cast<int>(std::ranges::count(tree.meetingPoints, -1, &MeetingPoint::stretch));
			const RouteTree again = treeOf(network);
			EXPECT_EQ(again.parentStretch, tree.parentStretch);
			EXPECT_EQ(again.hours, tree.hours);
			EXPECT_EQ(again.meetingPoints.size(), tree.meetingPoints.size());
		}
		EXPECT_GT(meetingPoints, 30 * 20);
		EXPECT_GT(threeWay, 0);
	}

	// A trunk from the compound to node 1, forking to 2 and 3, which a stretch from 2 to 3 joins again.
	RouteTree forkTree(double trunk, double routeSplit) {
		return treeOf(
			meshFrom({{0, 0}, {trunk, 0}, {trunk + 100, 50}, {trunk + 100, -50}}, {{0, 1}, {1, 2}, {1, 3}, {2, 3}}), 1, routeSplit
		);
	}

	TEST(MeetingPoints, AreStretchesNoWayHomeUsesWhoseEndsWaysHomeSplitByRouteSplitOfTheShortersHours) {
		// The ways home of 2 and 3 split at node 1, 400 units out of about 512: too late at a half...
		EXPECT_TRUE(forkTree(400, 0.5).meetingPoints.empty());
		// ...in time at 0.8.
		const RouteTree late = forkTree(400, 0.8);
		ASSERT_EQ(late.meetingPoints.size(), 1U);
		EXPECT_EQ(late.meetingPoints[0].stretch, 3);
		EXPECT_EQ(late.meetingPoints[0].node, -1);
		EXPECT_EQ(late.meetingPoints[0].from, (std::vector<int>{2, 3}));
		// A short trunk splits early enough at a half.
		ASSERT_EQ(forkTree(50, 0.5).meetingPoints.size(), 1U);
	}

	TEST(MeetingPoints, SplitAtExactlyRouteSplitButNotPastIt) {
		const RouteTree tree = forkTree(400, 0.5);
		EXPECT_EQ(splitNode(tree, 2, 3), 1);
		const double at = tree.hours[1] / std::min(tree.hours[2], tree.hours[3]);
		EXPECT_TRUE(splitsInTime(tree, 2, 3, at));
		EXPECT_FALSE(splitsInTime(tree, 2, 3, at * (1 - 1e-9)));
	}

	TEST(MeetingPoints, NeverJoinANodeToOneOnItsOwnWayHomeUnlessThatsTheCompound) {
		// 1 to 2 doubled: the second runs beside the first, and 1 is on 2's way home.
		const RouteTree doubled = treeOf(meshFrom({{0, 0}, {200, 0}, {400, 0}}, {{0, 1}, {1, 2}, {1, 2}}));
		EXPECT_TRUE(doubled.meetingPoints.empty());
		const RouteTree home = treeOf(meshFrom({{0, 0}, {200, 0}}, {{0, 1}, {0, 1}}));
		ASSERT_EQ(home.meetingPoints.size(), 1U);
		EXPECT_EQ(home.meetingPoints[0].stretch, 1);
		EXPECT_EQ(home.meetingPoints[0].from, (std::vector<int>{0, 1}));
	}

	// Three spokes from the compound, and a leaf beyond them joined to all three.
	const std::vector<Point>	kSpokes{{0, 0}, {300, 0}, {300, 200}, {300, -200}, {500, 0}};
	const std::vector<MeshEdge> kSpokeEdges{{0, 1}, {0, 2}, {0, 3}, {1, 4}, {2, 4}, {3, 4}};

	TEST(MeetingPoints, AreALeafWithExactlyThreeRoadsFromThreeNeighboursWhoseWaysHomeSplitPairwiseInTime) {
		const RouteTree tree = treeOf(meshFrom(kSpokes, kSpokeEdges));
		EXPECT_EQ(tree.parentNode[4], 1);
		ASSERT_EQ(tree.meetingPoints.size(), 3U);
		EXPECT_EQ(tree.meetingPoints[0].stretch, 4);
		EXPECT_EQ(tree.meetingPoints[0].from, (std::vector<int>{2, 4}));
		EXPECT_EQ(tree.meetingPoints[1].stretch, 5);
		const MeetingPoint& leaf = tree.meetingPoints[2];
		EXPECT_EQ(leaf.stretch, -1);
		EXPECT_EQ(leaf.node, 4);
		EXPECT_EQ(leaf.from, (std::vector<int>{1, 2, 3}));
		EXPECT_EQ(leaf.via, (std::vector<int>{3, 4, 5}));
	}

	TEST(MeetingPoints, AreNoThreeWayPointWithTwoRoadsFromOneNeighbourAFourthRoadOrAWayHomeThroughIt) {
		const auto threeWayAt = [](const RouteTree& tree, int node) {
			return std::ranges::any_of(tree.meetingPoints, [&](const MeetingPoint& point) { return point.node == node; });
		};
		EXPECT_FALSE(threeWayAt(treeOf(meshFrom(kSpokes, {{0, 1}, {0, 2}, {0, 3}, {1, 4}, {1, 4}, {2, 4}})), 4));
		std::vector<Point> points = kSpokes;
		points.push_back({300, 400});
		std::vector<MeshEdge> fourth = kSpokeEdges;
		fourth.push_back({5, 4});
		fourth.push_back({0, 5});
		EXPECT_FALSE(threeWayAt(treeOf(meshFrom(points, fourth)), 4));
		points.back() = {700, 0};
		std::vector<MeshEdge> through = kSpokeEdges;
		through.push_back({4, 5});
		EXPECT_FALSE(threeWayAt(treeOf(meshFrom(points, through)), 4));
	}

} // namespace
