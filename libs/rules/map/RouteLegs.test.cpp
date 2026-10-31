#include <rules/map/RouteLegs.h>
#include <rules/map/RouteTesting.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <vector>

namespace {

	using namespace rules::map;
	using fixtures::meshFrom;

	// A highway trunk from the compound to node 1, which forks to 2, 3, and 5, each joined to node 4 beyond them: a
	// leaf with three roads in, from three neighbours whose ways home split at 1.
	struct Trunk {
		RoadNetwork network = meshFrom(
			{{0, 0}, {100, 0}, {300, 150}, {300, -150}, {500, 0}, {300, 0}},
			{{0, 1, RoadClass::Highway}, {1, 2}, {1, 3}, {2, 4}, {4, 3}, {1, 5}, {5, 4}}
		);
		RouteTree tree = buildRouteTree({.network = network, .travelPace = 1, .routeSplit = 0.9});

		[[nodiscard]] const MeetingPoint& threeWay() const { return *std::ranges::find(tree.meetingPoints, 4, &MeetingPoint::node); }
	};

	TEST(RouteLegs, ArriveQuickestFirstWithTiesToTheLowerNode) {
		const Trunk		  trunk;
		const Destination arrivals = arrivalsAt(trunk.network, trunk.tree, trunk.threeWay(), 0);
		ASSERT_EQ(arrivals.size(), 3U);
		// Through 5 is quickest; through 2 and through 3 mirror each other.
		EXPECT_EQ(arrivals[0].from, 5);
		EXPECT_EQ(arrivals[1].from, 2);
		EXPECT_EQ(arrivals[2].from, 3);
		EXPECT_EQ(arrivals[1].hours, arrivals[2].hours);
		EXPECT_EQ(arrivals[0].stretch, 6);
		EXPECT_EQ(arrivals[0].length, trunk.network.stretches[6].length);
		EXPECT_NEAR(arrivals[0].hours, trunk.tree.hours[5] + trunk.tree.stretchHours[6], 1e-12);
	}

	TEST(RouteLegs, CutThePrunedTreeAtTheCompoundWhereRoutesSplitAndThePOIs) {
		const Trunk					   trunk;
		const std::vector<Destination> destinations{arrivalsAt(trunk.network, trunk.tree, trunk.threeWay(), 0)};
		const RouteLegs				   cut = buildLegs({.network = trunk.network, .tree = trunk.tree, .destinations = destinations});
		// The trunk to 1, where three routes split, then a leg from 1 into the POI along each, by node.
		ASSERT_EQ(cut.legs.size(), 4U);
		EXPECT_EQ(cut.legs[0].parent, -1);
		EXPECT_EQ(cut.legs[0].from, 0);
		EXPECT_EQ(cut.legs[0].to, 1);
		EXPECT_EQ(cut.legs[0].destination, -1);
		for (size_t id = 1; id < 4; ++id) {
			EXPECT_EQ(cut.legs[id].parent, 0);
			EXPECT_EQ(cut.legs[id].from, 1);
			EXPECT_EQ(cut.legs[id].to, 4);
			EXPECT_EQ(cut.legs[id].destination, 0);
		}
		const auto pieces = [&](size_t id) {
			std::vector<std::pair<int, bool>> found;
			for (const LegPiece& piece : cut.legs[id].pieces) {
				found.emplace_back(piece.stretch, piece.forward);
			}
			return found;
		};
		EXPECT_EQ(pieces(1), (std::vector<std::pair<int, bool>>{{1, true}, {3, true}}));
		// Stretch 4 runs from 4 to 3, so it's driven against its points.
		EXPECT_EQ(pieces(2), (std::vector<std::pair<int, bool>>{{2, true}, {4, false}}));
		EXPECT_EQ(pieces(3), (std::vector<std::pair<int, bool>>{{5, true}, {6, true}}));
		EXPECT_EQ(cut.lastLegs, (std::vector<std::vector<int>>{{3, 1, 2}}));
		const std::vector<Route> routes = routesTo(cut, 0);
		ASSERT_EQ(routes.size(), 3U);
		EXPECT_EQ(routes[0].legs, (std::vector<int>{0, 3}));
		EXPECT_EQ(routes[1].legs, (std::vector<int>{0, 1}));
		for (size_t place = 0; place < routes.size(); ++place) {
			EXPECT_NEAR(routes[place].hours, destinations[0][place].hours, 1e-12);
		}
		EXPECT_EQ(legPoints(trunk.network, cut.legs[2]), (std::vector<Point>{{100, 0}, {300, -150}, {500, 0}}));
		fixtures::expectLegsOverTheNetwork(trunk.network, destinations, cut, 0.9);
	}

	TEST(RouteLegs, EndALegPartwayAlongAStretchForAPOIThereAndKeepALegWholeWhereOnlyOneWayGoesOn) {
		const Trunk			trunk;
		const MeetingPoint& point =
			*std::ranges::find_if(trunk.tree.meetingPoints, [](const MeetingPoint& found) { return found.stretch >= 0; });
		const RoadStretch& stretch = trunk.network.stretches[static_cast<size_t>(point.stretch)];
		ASSERT_EQ(point.stretch, 3);
		const std::vector<Destination> destinations{arrivalsAt(trunk.network, trunk.tree, point, stretch.length / 4)};
		ASSERT_EQ(destinations[0][0].from, 2);
		const RouteLegs cut = buildLegs({.network = trunk.network, .tree = trunk.tree, .destinations = destinations});
		// From 1, one leg on to 2 and the POI, and one through 5 and 4, which only it goes on from, to the POI.
		ASSERT_EQ(cut.legs.size(), 3U);
		const Leg& near = cut.legs[static_cast<size_t>(cut.lastLegs[0][0])];
		EXPECT_EQ(near.to, -1);
		EXPECT_EQ(near.pieces.back().stretch, 3);
		EXPECT_TRUE(near.pieces.back().forward);
		EXPECT_EQ(near.pieces.back().length, stretch.length / 4);
		const Leg& far = cut.legs[static_cast<size_t>(cut.lastLegs[0][1])];
		EXPECT_EQ(far.from, 1);
		EXPECT_EQ(far.pieces.size(), 3U);
		EXPECT_FALSE(far.pieces.back().forward);
		const std::vector<Point> line = legPoints(trunk.network, near);
		EXPECT_NEAR(line.back().x, 350, 1e-9);
		EXPECT_NEAR(line.back().y, 112.5, 1e-9);
		const std::vector<Point> other = legPoints(trunk.network, far);
		EXPECT_NEAR(other.back().x, 350, 1e-9);
		EXPECT_NEAR(other.back().y, 112.5, 1e-9);
		fixtures::expectLegsOverTheNetwork(trunk.network, destinations, cut, 0.9);
	}

	TEST(RouteLegs, CutEveryRandomMeshsMeetingPointsIntoLegsOverTheNetwork) {
		size_t legs = 0;
		for (uint32_t index = 0; index < 12; ++index) {
			const RoadNetwork			   network = fixtures::randomMesh({.seed = 300 + index, .radius = 500 + 40.0 * index});
			const RouteTree				   tree = buildRouteTree({.network = network});
			const std::vector<Destination> destinations = fixtures::everyFreeMeetingPoint(network, tree);
			const RouteLegs				   cut = buildLegs({.network = network, .tree = tree, .destinations = destinations});
			fixtures::expectLegsOverTheNetwork(network, destinations, cut, 0.5);
			legs += cut.legs.size();
		}
		EXPECT_GT(legs, 12U * 50);
	}

	TEST(RouteLegs, ProfileALegsClassesBiomesMainHighwayAndMiddle) {
		const RoadNetwork network =
			meshFrom({{0, 0}, {100, 0}, {250, 0}, {300, 0}}, {{0, 1, RoadClass::Highway, 0}, {1, 2, RoadClass::Highway, 1}, {2, 3}});
		const Leg leg{
			.parent = -1,
			.from = 0,
			.to = 3,
			.destination = -1,
			.pieces =
				{{.stretch = 0, .forward = true, .length = 100},
				 {.stretch = 1, .forward = true, .length = 150},
				 {.stretch = 2, .forward = true, .length = 50}},
			.length = 300,
			.hours = 0,
		};
		const LegProfile profile = profileLeg(network, leg, [](Point point) { return point.x < 120 ? Biome::Scrub : Biome::Mire; }, 12);
		EXPECT_EQ(profile.classLengths, (std::array<double, 3>{250, 50, 0}));
		EXPECT_EQ(profile.highway, 1);
		// 25 samples 12 apart from 6 along: ten short of 120.
		EXPECT_NEAR(profile.biomeLengths[static_cast<size_t>(Biome::Scrub)], 120, 1e-9);
		EXPECT_NEAR(profile.biomeLengths[static_cast<size_t>(Biome::Mire)], 180, 1e-9);
		EXPECT_NEAR(profile.middle.x, 150, 1e-9);
		EXPECT_EQ(profile.middle.y, 0);
		// Two highways as long on it: the lower.
		const RoadNetwork even = meshFrom({{0, 0}, {100, 0}, {200, 0}}, {{0, 1, RoadClass::Highway, 1}, {1, 2, RoadClass::Highway, 0}});
		const Leg		  both{
					.parent = -1,
					.from = 0,
					.to = 2,
					.destination = -1,
					.pieces = {{.stretch = 0, .forward = true, .length = 100}, {.stretch = 1, .forward = true, .length = 100}},
					.length = 200,
					.hours = 0,
		};
		EXPECT_EQ(profileLeg(even, both, [](Point) { return Biome::Scrub; }, 12).highway, 0);
	}

} // namespace
