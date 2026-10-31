#include "FightsConfig.h"
#include "SimTesting.h"

#include <rules/core/ContentError.h>

#include <gtest/gtest.h>

#include <string>
#include <string_view>

namespace {

	using namespace sim;
	using namespace sim::tests;
	using rules::CardId;
	using rules::DriverId;
	using rules::campaign::CardCounts;
	using rules::campaign::totalCards;

	FightsConfig read(std::string_view json) {
		return configOf(nlohmann::json::parse(json));
	}

	// The ContentError a config fails with, which names the path in it.
	std::string failure(std::string_view json) {
		try {
			(void)read(json);
		} catch (const rules::ContentError& error) {
			return error.what();
		}
		ADD_FAILURE() << "the config read: " << json;
		return "";
	}

	TEST(FightsConfig, AnEmptyConfigIsEveryCrewOfTheStartingArchetypesAgainstEachSkullCount) {
		const FightsConfig config = read("{}");
		EXPECT_EQ(config.seed, 1U);
		EXPECT_EQ(config.runs, 100);
		EXPECT_EQ(config.tier, 1);
		EXPECT_EQ(config.stages, std::vector<int>{0});
		EXPECT_EQ(config.turns, 25);
		EXPECT_EQ(config.standIn.policy, "aggressive_flanker");
		ASSERT_EQ(config.routes.size(), 3U);
		EXPECT_EQ(config.routes[2], RouteConfig{FightStep{.skulls = 3}});

		// Every pair of different archetypes, then each alone, from the three a campaign starts with, in id order.
		ASSERT_EQ(config.crews.size(), 6U);
		EXPECT_EQ(config.crews[0], (CrewConfig{{.archetype = DriverId{"interceptor"}}, {.archetype = DriverId{"mechanic"}}}));
		EXPECT_EQ(config.crews[3], CrewConfig{{.archetype = DriverId{"interceptor"}}});
		EXPECT_EQ(read(R"({"crews": "pairs"})").crews.size(), 3U);
		EXPECT_EQ(read(R"({"crews": "solo", "archetypes": ["road_warrior"]})").crews.size(), 1U);
	}

	TEST(FightsConfig, ReadsCrewsDecksRoutesAndAStandInAndWritesThemBackTheSame) {
		const FightsConfig config = read(R"({
			"seed": 9, "runs": 4, "tier": 2, "stages": [0, 2], "turns": 12,
			"crews": [
				["road_warrior", {"archetype": "interceptor", "add": {"precision_shot": 1}}],
				[{"archetype": "mechanic", "deck": {"point_blank": 6, "repair_kit": 4}}]
			],
			"routes": [[1, 2], ["spike_raid"]],
			"standIn": {"policy": "mcts", "weights": {"iterations": 8}}
		})");
		EXPECT_EQ(config.crews[0][1].add, (CardCounts{{CardId{"precision_shot"}, 1}}));
		EXPECT_EQ(config.routes[1], (RouteConfig{FightStep{.skulls = 3, .encounter = rules::EncounterId{"spike_raid"}}}));
		EXPECT_EQ(config.standIn.weights.at("iterations"), 8);

		// A seat brings its archetype's starting deck and what it adds, or the deck it's given in its place.
		const CardCounts starting = deckOf(SeatConfig{.archetype = DriverId{"interceptor"}}, baseContent());
		const CardCounts interceptor = deckOf(config.crews[0][1], baseContent());
		EXPECT_EQ(interceptor.at(CardId{"precision_shot"}), starting.at(CardId{"precision_shot"}) + 1);
		EXPECT_EQ(totalCards(interceptor), totalCards(starting) + 1);
		EXPECT_EQ(totalCards(deckOf(config.crews[1][0], baseContent())), 10);

		EXPECT_EQ(configOf(fightsConfigJson(config)), config);
	}

	TEST(FightsConfig, ABadConfigFailsNamingThePathInIt) {
		EXPECT_EQ(failure(R"({"sede": 3})"), "test.json has fields nothing reads: sede");
		EXPECT_EQ(failure(R"({"runs": 0})"), "test.json.runs must be 1 or more");
		EXPECT_EQ(failure(R"({"crews": "everyone"})"), R"(test.json.crews must be "all", "pairs", "solo", or a list of crews)");
		EXPECT_EQ(
			failure(R"({"crews": [["mechanic", "mechanic"]]})"),
			"test.json.crews[0] seats two mechanics, and a pair is two different archetypes"
		);
		EXPECT_EQ(failure(R"({"crews": [["mechanic", "tank"]]})"), R"(test.json.crews[0][1] "tank" is no archetype a loaded pack defines)");
		EXPECT_EQ(
			failure(R"({"crews": [[{"archetype": "mechanic", "add": {"precision_shot": 1}}]]})"),
			"test.json.crews[0][0].add.precision_shot is marked for interceptor, not mechanic"
		);
		EXPECT_EQ(
			failure(R"({"crews": [[{"archetype": "mechanic", "deck": {"triage": 2}}]]})"),
			"test.json.crews[0][0].deck.triage is an escort's signature card, which only its escort brings"
		);
		EXPECT_EQ(
			failure(R"({"crews": [[{"archetype": "mechanic", "add": {"ram": 0}}]]})"),
			"test.json.crews[0][0].add.ram must be a whole number of copies from 1 to 99"
		);
		EXPECT_EQ(
			failure(R"({"crews": [[{"archetype": "mechanic", "hand": 3}]]})"), "test.json.crews[0][0] has fields nothing reads: hand"
		);
		EXPECT_EQ(
			failure(R"({"crews": [["mechanic"]], "archetypes": ["mechanic"]})"),
			R"(test.json.archetypes only says what "all", "pairs", and "solo" draw from, and the crews are listed)"
		);
		EXPECT_EQ(failure(R"({"routes": [[1, 4]]})"), "test.json.routes[0][1] must be a skull count from 1 to 3 or an encounter's id");
		EXPECT_EQ(failure(R"({"routes": [["ambush"]]})"), R"(test.json.routes[0][0] "ambush" is no encounter a loaded pack defines)");
		EXPECT_EQ(failure(R"({"routes": [[]]})"), "test.json.routes[0] must be a list of one or more fights");
		EXPECT_EQ(failure(R"({"stages": [0, 7]})"), "test.json.stages holds 7, and game stage runs 0 to 6");
		EXPECT_EQ(failure(R"({"tier": 6})"), "test.json.tier must be from 1 to 5");
		EXPECT_TRUE(failure(R"({"standIn": {"policy": "telepath"}})").starts_with("test.json.standIn isn't a player's stand-in: policy"));
		EXPECT_TRUE(failure(R"({"standIn": {"policy": "mcts", "weights": {"depth": 2}}})")
						.starts_with("test.json.standIn isn't a player's stand-in"));
	}

} // namespace
