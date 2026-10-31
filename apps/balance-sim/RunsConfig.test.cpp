#include "RunsConfig.h"
#include "SimTesting.h"

#include <rules/core/ContentError.h>

#include <gtest/gtest.h>

#include <string>
#include <string_view>

namespace {

	using namespace sim;
	using namespace sim::tests;
	using rules::DriverId;

	RunsConfig read(std::string_view json) {
		return readRunsConfig(nlohmann::json::parse(json), "runs.json", baseContent());
	}

	std::string failure(std::string_view json) {
		try {
			(void)read(json);
		} catch (const rules::ContentError& error) {
			return error.what();
		}
		ADD_FAILURE() << "the config read: " << json;
		return "";
	}

	TEST(RunsConfig, AnEmptyConfigIsEveryPairOverEveryRouteOfOneMapFreshAndBehindItsNeighbor) {
		const RunsConfig config = read("{}");
		EXPECT_EQ(config.maps, std::vector<uint32_t>{1});
		EXPECT_EQ(config.runs, 20);
		EXPECT_FALSE(config.routes.has_value());
		EXPECT_EQ(config.tiers, (std::vector<int>{1, 2, 3, 4}));
		EXPECT_EQ(config.stages, std::vector<int>{0});
		EXPECT_EQ(config.turns, 25);
		EXPECT_EQ(config.standIn.policy, "aggressive_flanker");
		EXPECT_TRUE(config.neighbor);
		// The per-run targets are for pairs, so lone drivers come only when asked for.
		ASSERT_EQ(config.crews.size(), 3U);
		EXPECT_EQ(config.crews[2], (CrewConfig{{.archetype = DriverId{"mechanic"}}, {.archetype = DriverId{"road_warrior"}}}));
		EXPECT_EQ(read(R"({"maps": 3})").maps, (std::vector<uint32_t>{1, 2, 3}));
		EXPECT_EQ(read(R"({"crews": "all"})").crews.size(), 6U);
	}

	TEST(RunsConfig, ReadsItsFieldsAndWritesThemBackTheSame) {
		const RunsConfig config = read(R"({
			"maps": [4, 9], "runs": 6, "routes": 12, "tiers": [2, 1], "stages": [0, 2], "turns": 30, "neighbor": false,
			"crews": [["road_warrior", {"archetype": "interceptor", "add": {"precision_shot": 1}}], ["mechanic"]],
			"standIn": {"policy": "intent_aware"}
		})");
		EXPECT_EQ(config.maps, (std::vector<uint32_t>{4, 9}));
		EXPECT_EQ(config.routes, 12);
		EXPECT_EQ(config.tiers, (std::vector<int>{2, 1}));
		EXPECT_FALSE(config.neighbor);
		EXPECT_EQ(config.crews[0][1].add.at(rules::CardId{"precision_shot"}), 1);
		EXPECT_EQ(readRunsConfig(runsConfigJson(config), "written.json", baseContent()), config);
		EXPECT_EQ(readRunsConfig(runsConfigJson(read("{}")), "written.json", baseContent()), read("{}"));
	}

	TEST(RunsConfig, ABadConfigFailsNamingThePathInIt) {
		EXPECT_EQ(failure(R"({"seed": 3})"), "runs.json has fields nothing reads: seed");
		EXPECT_EQ(failure(R"({"maps": 0})"), "runs.json.maps must be a count of maps from 1 to 1000, or a list of seeds");
		EXPECT_EQ(failure(R"({"maps": [2, -1]})"), "runs.json.maps[1] must be a seed, a whole number from 0");
		EXPECT_EQ(failure(R"({"maps": [2, 2]})"), "runs.json.maps[1] is seed 2 again");
		EXPECT_EQ(failure(R"({"routes": "most"})"), R"(runs.json.routes must be "all" or how many of each map's routes to run, 1 or more)");
		EXPECT_EQ(
			failure(R"({"tiers": [5]})"),
			"runs.json.tiers holds 5, the strongholds' routes, which no run leaves on until their boss fights exist"
		);
		EXPECT_EQ(failure(R"({"tiers": [0]})"), "runs.json.tiers holds 0, and a run's destination tier is 1 to 4");
		EXPECT_EQ(failure(R"({"tiers": [1, 1]})"), "runs.json.tiers holds 1 twice");
		EXPECT_EQ(failure(R"({"runs": 0})"), "runs.json.runs must be 1 or more");
		EXPECT_EQ(failure(R"({"stages": [3, 3]})"), "runs.json.stages holds 3 twice");
		EXPECT_EQ(failure(R"({"crews": [["mechanic", "tank"]]})"), R"(runs.json.crews[0][1] "tank" is no archetype a loaded pack defines)");
		EXPECT_TRUE(failure(R"({"neighbor": "yes"})").starts_with("runs.json.neighbor"));
	}

} // namespace
