#include <rules/map/MapTesting.h>
#include <rules/map/RouteDescriptors.h>
#include <rules/map/RouteLegs.h>
#include <rules/map/RouteTesting.h>
#include <rules/map/RouteTree.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <set>
#include <vector>

// The route tree, its legs, and the descriptors over the networks the roads stage lays on three maps.
namespace {

	using namespace rules::map;

	class EveryRouteTree : public ::testing::TestWithParam<const MapParams*> {};

	INSTANTIATE_TEST_SUITE_P(
		RouteTree,
		EveryRouteTree,
		::testing::Values(&fixtures::mixed(), &fixtures::floodlands(), &fixtures::badlands())
	);

	RouteTree treeFor(const MapParams& params) {
		return buildRouteTree({
			.network = fixtures::roadsFor(params).network(),
			.travelPace = params.travelPace,
			.routeSplit = params.routeSplit,
		});
	}

	// Only a loop whose ends' ways home split by halfway holds a meeting point, so there are fewer than loops, at
	// radius 600 sometimes fewer than the POIs want: their targets are aims.
	TEST_P(EveryRouteTree, GivesEveryNodeItsQuickestWayHomeAndFindsMeetingPointsOffIt) {
		const MapParams&   params = *GetParam();
		const RoadNetwork& network = fixtures::roadsFor(params).network();
		const RouteTree	   tree = treeFor(params);
		fixtures::expectQuickestTree(network, tree);
		fixtures::expectMeetingPointsOffTheWaysHome(network, tree, params.routeSplit);
		const auto onStretches = std::ranges::count_if(tree.meetingPoints, [](const MeetingPoint& point) { return point.stretch >= 0; });
		EXPECT_GT(onStretches, 10);
		EXPECT_LE(onStretches, fixtures::roadsFor(params).loops());
	}

	TEST_P(EveryRouteTree, CutsLegsAndDescribesRoutesForEveryFreeMeetingPoint) {
		const MapParams&			   params = *GetParam();
		const RoadNetwork&			   network = fixtures::roadsFor(params).network();
		const RouteTree				   tree = treeFor(params);
		const std::vector<Destination> destinations = fixtures::everyFreeMeetingPoint(network, tree);
		const RouteLegs				   legs = buildLegs({.network = network, .tree = tree, .destinations = destinations});
		fixtures::expectLegsOverTheNetwork(network, destinations, legs, params.routeSplit);
		const Ground  ground = fixtures::groundFor(params);
		const BiomeAt biomeAt = [&](Point point) {
			return ground.biome(point.x, point.y);
		};
		std::set<std::string> kinds;
		int					  numbered = 0;
		for (size_t destination = 0; destination < destinations.size(); ++destination) {
			const std::vector<RouteDescriptor> routes = describeRoutes({
				.network = network,
				.routeLegs = legs,
				.destination = static_cast<int>(destination),
				.biomeAt = biomeAt,
				.tuning = fixtures::routeTuning(),
			});
			fixtures::expectDescriptorsMatchTheirRoutes(network, legs, static_cast<int>(destination), routes, fixtures::routeTuning());
			for (const RouteDescriptor& route : routes) {
				kinds.insert(route.name.substr(0, route.name.find(' ')));
				if (route.roadClass != RoadClass::Highway || !route.name.starts_with("Route ")) {
					continue;
				}
				// The number is one of the highways the route drives, the own road's main one.
				std::set<int> driven;
				for (const int leg : route.legs) {
					for (const LegPiece& piece : legs.legs[static_cast<size_t>(leg)].pieces) {
						const int highway = network.stretches[static_cast<size_t>(piece.stretch)].highway;
						if (highway >= 0) {
							driven.insert(network.routeNumbers[static_cast<size_t>(highway)]);
						}
					}
				}
				EXPECT_TRUE(driven.contains(std::stoi(route.name.substr(6)))) << route.name;
				numbered += 1;
			}
		}
		EXPECT_GT(destinations.size(), 10U);
		EXPECT_GT(numbered, 0);
		// Named for more than one thing: highways, back roads, trails, or a biome.
		EXPECT_GE(kinds.size(), 2U);
	}

} // namespace
