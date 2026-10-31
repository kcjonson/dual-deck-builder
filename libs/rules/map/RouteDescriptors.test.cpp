#include <rules/core/ContentError.h>
#include <rules/map/RouteDescriptors.h>
#include <rules/map/RouteTesting.h>

#include <gtest/gtest.h>

#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

namespace {

	using namespace rules::map;
	using fixtures::meshFrom;
	namespace fs = std::filesystem;

	const BiomeAt kScrub = [](Point) {
		return Biome::Scrub;
	};

	// A loop out of the compound, its north side highway: a POI halfway along its far south-east side has one route
	// round the highway and one down the back road.
	struct Loop {
		RoadNetwork				 network;
		RouteTree				 tree;
		std::vector<Destination> destinations;
		RouteLegs				 legs;

		explicit Loop(RoadClass south, int southHighway = 0)
			: network(meshFrom(
				  {{0, 0}, {300, 250}, {300, -250}, {600, 0}},
				  {{0, 1, RoadClass::Highway, 1}, {0, 2, south, southHighway}, {1, 3, RoadClass::Highway, 1}, {2, 3, south, southHighway}}
			  )),
			  tree(buildRouteTree({.network = network})) {
			const MeetingPoint& point = *std::ranges::find(tree.meetingPoints, 3, &MeetingPoint::stretch);
			destinations.push_back(arrivalsAt(network, tree, point, network.stretches[3].length / 2));
			legs = buildLegs({.network = network, .tree = tree, .destinations = destinations});
		}

		[[nodiscard]] std::vector<RouteDescriptor> describe(const BiomeAt& biomeAt = kScrub) const {
			return describeRoutes(
				{.network = network, .routeLegs = legs, .destination = 0, .biomeAt = biomeAt, .tuning = fixtures::routeTuning()}
			);
		}
	};

	TEST(RouteDescriptors, ReadTheBasePacksRoutesFile) {
		const RouteTuning& tuning = fixtures::routeTuning();
		EXPECT_EQ(tuning.unitsPerFuel, 150);
		EXPECT_EQ(tuning.biomeShare, 0.5);
		EXPECT_EQ(tuning.biomeStep, 12);
		EXPECT_EQ(tuning.biomeNames[static_cast<size_t>(Biome::Mire)], "Through the mire");
		EXPECT_TRUE(tuning.biomeNames[static_cast<size_t>(Biome::Scrub)].empty());
		EXPECT_EQ(tuning.classNames[static_cast<size_t>(RoadClass::Highway)], "Route {number} highway");
		EXPECT_EQ(tuning.classNames[static_cast<size_t>(RoadClass::Trail)], "Trails");
	}

	TEST(RouteDescriptors, ReadTheRoutesFileStrictlyNamingTheFile) {
		const fs::path folder = fs::temp_directory_path() / "ddb-routes";
		fs::remove_all(folder);
		fs::create_directories(folder);
		const auto errorFrom = [&](std::string_view names) {
			const fs::path file = folder / "routes.json";
			std::ofstream(file, std::ios::binary) << R"({"unitsPerFuel": 150, "names": )" << names << "}";
			try {
				(void)readRouteTuning(file);
			} catch (const rules::ContentError& error) {
				return std::string(error.what());
			}
			return std::string();
		};
		const std::string classes = R"("classes": {"highway": "Route {number}", "backRoad": "Back roads", "trail": "Trails"})";
		const auto		  names = [&](std::string_view biomes, std::string_view tail = "") {
			   return R"({"biomeShare": 0.5, "biomeStep": 12, "biomes": )" + std::string(biomes) + ", " + classes + std::string(tail) + "}";
		};
		EXPECT_EQ(errorFrom(names(R"({"mire": "Through the mire"})")), "");
		EXPECT_NE(errorFrom(names(R"({"swamp": "Through the swamp"})")).find("biomes has fields nothing reads: swamp"), std::string::npos);
		EXPECT_NE(errorFrom(names(R"({"mire": ""})")).find("biomes.mire is empty"), std::string::npos);
		EXPECT_NE(errorFrom(names("{}", R"(, "biomeStep2": 1)")).find("names has fields nothing reads: biomeStep2"), std::string::npos);
		EXPECT_NE(
			errorFrom(R"({"biomeShare": 1.5, "biomeStep": 12, "biomes": {}, )" + classes + "}").find("biomeShare must be at most 1"),
			std::string::npos
		);
		EXPECT_NE(
			errorFrom(R"({"biomeShare": 0.5, "biomeStep": 0, "biomes": {}, )" + classes + "}").find("biomeStep must be above 0"),
			std::string::npos
		);
		const auto withClasses = [](std::string_view highway, std::string_view backRoad) {
			return R"({"biomeShare": 0.5, "biomeStep": 12, "biomes": {}, "classes": {"highway": ")" + std::string(highway) +
				   R"(", "backRoad": ")" + std::string(backRoad) + R"(", "trail": "Trails"}})";
		};
		EXPECT_NE(errorFrom(withClasses("Highway", "Back roads")).find("classes.highway must hold {number} once"), std::string::npos);
		EXPECT_NE(errorFrom(withClasses("{number} {number}", "Back roads")).find("must hold {number} once"), std::string::npos);
		EXPECT_NE(
			errorFrom(withClasses("Route {number}", "Road {number}")).find("classes.backRoad can't hold {number}"), std::string::npos
		);
		EXPECT_NE(errorFrom(R"({"biomeShare": 0.5, "biomeStep": 12, "biomes": {}})").find("names.classes is required"), std::string::npos);
		fs::remove_all(folder);
	}

	TEST(RouteDescriptors, NameARouteForItsOwnRoadsDominantClassAHighwayByItsRouteNumber) {
		Loop loop(RoadClass::BackRoad);
		loop.network.routeNumbers = {12, 47};
		const std::vector<RouteDescriptor> routes = loop.describe();
		ASSERT_EQ(routes.size(), 2U);
		// Quickest first: down the back road, then round the highway, whose own road is mostly highway 1.
		EXPECT_EQ(routes[0].name, "Back roads");
		EXPECT_EQ(routes[0].roadClass, RoadClass::BackRoad);
		EXPECT_EQ(routes[0].biome, Biome::Scrub);
		EXPECT_EQ(routes[1].name, "Route 47 highway");
		EXPECT_EQ(routes[1].roadClass, RoadClass::Highway);
		fixtures::expectDescriptorsMatchTheirRoutes(loop.network, loop.legs, 0, routes, fixtures::routeTuning());
	}

	TEST(RouteDescriptors, TellTwoRoutesOnOneHighwayApartByTheSideTheyComeInFrom) {
		Loop loop(RoadClass::Highway, 1);
		loop.network.routeNumbers = {12, 47};
		const std::vector<RouteDescriptor> routes = loop.describe();
		ASSERT_EQ(routes.size(), 2U);
		// The POI sits at (450, -125): the back road's last leg is west of it, round the highway north.
		EXPECT_EQ(routes[0].name, "Route 47 highway from the west");
		EXPECT_EQ(routes[1].name, "Route 47 highway from the north");
	}

	TEST(RouteDescriptors, TakeABiomesNameWhereItCoversEnoughOfARoutesOwnRoad) {
		const Loop						   loop(RoadClass::BackRoad);
		const std::vector<RouteDescriptor> routes = loop.describe([](Point point) { return point.y < 0 ? Biome::Mire : Biome::Scrub; });
		ASSERT_EQ(routes.size(), 2U);
		EXPECT_EQ(routes[0].name, "Through the mire");
		EXPECT_EQ(routes[0].biome, Biome::Mire);
		EXPECT_EQ(routes[0].roadClass, RoadClass::BackRoad);
		// Round the north, only the last stretch into the POI is mire: a fifth of the way.
		EXPECT_EQ(routes[1].name, "Route 11 highway");
		EXPECT_EQ(routes[1].biome, Biome::Scrub);
	}

	TEST(RouteDescriptors, LetterRoutesThatComeInAlikeFromOneSide) {
		// Three spokes to a leaf east of them: two come in alike from the west, one from the north-west.
		const RoadNetwork network =
			meshFrom({{0, 0}, {300, 30}, {300, -30}, {300, 300}, {600, 0}}, {{0, 1}, {0, 2}, {0, 3}, {1, 4}, {2, 4}, {3, 4}});
		const RouteTree					   tree = buildRouteTree({.network = network});
		const MeetingPoint&				   point = *std::ranges::find(tree.meetingPoints, 4, &MeetingPoint::node);
		const std::vector<Destination>	   destinations{arrivalsAt(network, tree, point, 0)};
		const RouteLegs					   legs = buildLegs({.network = network, .tree = tree, .destinations = destinations});
		const std::vector<RouteDescriptor> routes =
			describeRoutes({.network = network, .routeLegs = legs, .destination = 0, .biomeAt = kScrub, .tuning = fixtures::routeTuning()});
		ASSERT_EQ(routes.size(), 3U);
		EXPECT_EQ(routes[0].name, "Back roads from the west A");
		EXPECT_EQ(routes[1].name, "Back roads from the west B");
		EXPECT_EQ(routes[2].name, "Back roads from the north-west");
		fixtures::expectDescriptorsMatchTheirRoutes(network, legs, 0, routes, fixtures::routeTuning());
	}

	TEST(RouteDescriptors, CostAUnitOfFuelPerUnitsPerFuelOfRoadAtLeastOne) {
		const RouteTuning& tuning = fixtures::routeTuning();
		EXPECT_EQ(fuelFor(0, tuning), 1);
		EXPECT_EQ(fuelFor(150, tuning), 1);
		EXPECT_EQ(fuelFor(151, tuning), 2);
		const Loop loop(RoadClass::BackRoad);
		for (const RouteDescriptor& route : loop.describe()) {
			EXPECT_EQ(route.fuel, fuelFor(route.length, tuning));
			EXPECT_GT(route.fuel, 1);
		}
	}

	TEST(RouteDescriptors, MatchTheirRoutesOnEveryRandomMeshsMeetingPoints) {
		size_t described = 0;
		for (uint32_t index = 0; index < 6; ++index) {
			const RoadNetwork			   network = fixtures::randomMesh({.seed = 700 + index, .spacing = 85.0 + index});
			const RouteTree				   tree = buildRouteTree({.network = network});
			const std::vector<Destination> destinations = fixtures::everyFreeMeetingPoint(network, tree);
			const RouteLegs				   legs = buildLegs({.network = network, .tree = tree, .destinations = destinations});
			const BiomeAt				   biomeAt = [](Point point) {
				 return point.x > 200 ? Biome::Desert : Biome::Scrub;
			};
			for (size_t destination = 0; destination < destinations.size(); ++destination) {
				const std::vector<RouteDescriptor> routes = describeRoutes({
					.network = network,
					.routeLegs = legs,
					.destination = static_cast<int>(destination),
					.biomeAt = biomeAt,
					.tuning = fixtures::routeTuning(),
				});
				fixtures::expectDescriptorsMatchTheirRoutes(network, legs, static_cast<int>(destination), routes, fixtures::routeTuning());
				described += routes.size();
			}
		}
		EXPECT_GT(described, 6U * 100);
	}

	TEST(RouteDescriptors, PointTheCompassByPlainArithmeticXEastAndYNorth) {
		EXPECT_EQ(compass(1, 0), "east");
		EXPECT_EQ(compass(-1, 0.4), "west");
		EXPECT_EQ(compass(0, 1), "north");
		EXPECT_EQ(compass(0.4, -1), "south");
		EXPECT_EQ(compass(1, 1), "north-east");
		EXPECT_EQ(compass(-1, -1), "south-west");
		EXPECT_EQ(compass(-1, 0.5), "north-west");
	}

} // namespace
