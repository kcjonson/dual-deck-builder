#include "Fights.h"
#include "Report.h"
#include "SimTesting.h"

#include <gtest/gtest.h>

#include <algorithm>

namespace {

	using namespace sim;
	using namespace sim::tests;
	using rules::Outcome;

	FightsConfig read(std::string_view json) {
		return configOf(nlohmann::json::parse(json));
	}

	const FightCell& cellNamed(const std::vector<FightCell>& cells, std::string_view name) {
		const auto found = std::ranges::find(cells, name, &FightCell::name);
		EXPECT_NE(found, cells.end()) << name;
		return *found;
	}

	TEST(Fights, CellsAreNamedByCrewRouteAndStage) {
		const FightsConfig		 config = read(R"({
			"crews": [["road_warrior", "interceptor"], [{"archetype": "mechanic", "add": {"ram": 2}}], ["mechanic"]],
			"routes": [[1, 2], ["spike_raid"]], "stages": [0, 4]
		})");
		std::vector<std::string> names;
		for (const FightCell& cell : fightCells(config)) {
			names.push_back(cell.name);
		}
		EXPECT_EQ(names.size(), 12U);
		EXPECT_EQ(names[0], "road_warrior+interceptor:1+2@0");
		EXPECT_EQ(names[3], "road_warrior+interceptor:spike_raid@4");
		// A crew listed twice, on other decks, is told apart by its place in the crews.
		EXPECT_EQ(names[4], "mechanic#2:1+2@0");
		EXPECT_EQ(names[11], "mechanic#3:spike_raid@4");
	}

	// One crew, one encounter, a fixed seed: the spec's balance smoke.
	TEST(Fights, OneCrewAgainstOneEncounterOnAFixedSeedComesOutTheSameEveryTime) {
		const FightsConfig config = read(R"({"seed": 7, "crews": [["road_warrior", "interceptor"]], "routes": [["scav_pack"]]})");
		const FightCell	   cell = fightCells(config).front();
		const RunRecord	   run = playRun(config, baseRules(), cell, 1);
		EXPECT_EQ(playRun(config, baseRules(), cell, 1), run);

		ASSERT_EQ(run.fights.size(), 1U);
		const FightRecord& fight = run.fights.front();
		EXPECT_EQ(run.end, RunEnd::Home);
		EXPECT_FALSE(run.swapped);
		EXPECT_EQ(fight.outcome, Outcome::Won);
		EXPECT_EQ(fight.rout, rules::RoutCause::ThreatThinned);
		EXPECT_EQ(fight.turns, 3);
		EXPECT_EQ(fight.mostHitpoints, 65);
		EXPECT_EQ(fight.hitpointsAtEnd, 57);
		EXPECT_EQ(fight.mostStructure, 130);
		EXPECT_EQ(fight.structureAtEnd, 122);
		EXPECT_EQ(fight.raidersKilled, 4);
		EXPECT_EQ(fight.wavesSeen, 2);
		EXPECT_GT(fight.decisions, 0);
		EXPECT_FALSE(fight.raiderPlays.empty());
		// 8 HP missing at the infirmary's 10 a day.
		EXPECT_EQ(run.injuryDays, 1);
		// The second run seats the pair the other way round.
		EXPECT_TRUE(playRun(config, baseRules(), cell, 2).swapped);
	}

	TEST(Fights, ARouteCarriesTheCrewsDamageFromFightToFightAndEveryCellPlaysTheSameDraws) {
		const FightsConfig			 config = read(R"({"seed": 3, "crews": [["road_warrior"]], "routes": [[1], [1, 1]]})");
		const std::vector<FightCell> cells = fightCells(config);
		const RunRecord				 alone = playRun(config, baseRules(), cellNamed(cells, "road_warrior:1@0"), 1);
		const RunRecord				 route = playRun(config, baseRules(), cellNamed(cells, "road_warrior:1+1@0"), 1);
		// The route's first fight is the lone fight: run 1's fight 0 on both.
		EXPECT_EQ(route.fights.front(), alone.fights.front());
		ASSERT_EQ(route.fights.size(), 2U);
		ASSERT_FALSE(route.fights[0].driverDown);
		EXPECT_EQ(route.fights[1].hitpointsAtStart, route.fights[0].hitpointsAtEnd);
		EXPECT_EQ(route.fights[1].structureAtStart, route.fights[0].structureAtEnd);
		EXPECT_LT(route.fights[1].hitpointsAtStart, route.fights[1].mostHitpoints);
	}

	TEST(Fights, TheReportIsTheSameWhateverTheWorkers) {
		const FightsConfig config =
			read(R"({"seed": 5, "runs": 2, "crews": [["interceptor", "mechanic"], ["interceptor"]], "routes": [[1]]})");
		const FightsReport one = playFights(config, baseRules(), 1);
		const FightsReport three = playFights(config, baseRules(), 3);
		EXPECT_EQ(one.cells, three.cells);
		EXPECT_EQ(one.skulls, three.skulls);
		EXPECT_EQ(reportJson(one, baseContent().packs).dump(), reportJson(three, baseContent().packs).dump());
		ASSERT_EQ(one.skulls.size(), 2U);
		EXPECT_EQ(one.skulls[0].seats, 2);
		EXPECT_EQ(one.skulls[0].fights, 2);
		EXPECT_EQ(one.skulls[1].worstCrew, "interceptor");
	}

} // namespace
