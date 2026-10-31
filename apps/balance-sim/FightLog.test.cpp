#include "FightLog.h"
#include "Fights.h"
#include "SimTesting.h"

#include <gtest/gtest.h>

#include <sstream>
#include <string>

namespace {

	using namespace sim;
	using namespace sim::tests;

	FightsConfig read(std::string_view json) {
		return configOf(nlohmann::json::parse(json));
	}

	TEST(FightLog, ARunPlayedWithItsLogWordsEveryEventAndPlaysTheSameFights) {
		const FightsConfig config = read(R"({"seed": 7, "crews": [["road_warrior", "interceptor"]], "routes": [["scav_pack", 1]]})");
		const FightCell	   cell = fightCells(config).front();
		std::ostringstream log;
		const RunRecord	   logged = playRun(config, baseRules(), cell, 1, &log);
		EXPECT_EQ(logged, playRun(config, baseRules(), cell, 1));

		const std::string text = log.str();
		EXPECT_TRUE(text.starts_with("fight 1: scav_pack, 1 skull\n"));
		EXPECT_NE(text.find("fight 2: "), std::string::npos);
		EXPECT_NE(text.find("road_warrior (seat 1) draws "), std::string::npos);
		EXPECT_NE(text.find(" plans "), std::string::npos) << "the raiders' planning is logged";
		EXPECT_NE(text.find("interceptor (seat 2) plays "), std::string::npos);
		EXPECT_NE(text.find("the fight is won"), std::string::npos);
		std::istringstream lines(text);
		for (std::string line; std::getline(lines, line);) {
			EXPECT_FALSE(line.find_first_not_of(' ') == std::string::npos) << "an event worded as nothing";
		}
	}

	TEST(FightLog, TallyingTheCardsReadsThePlansWithoutChangingTheFight) {
		const FightsConfig plain = read(R"({"seed": 7, "crews": [["road_warrior", "interceptor"]], "routes": [[2]]})");
		FightsConfig	   tallied = plain;
		tallied.cards = true;
		const FightCell cell = fightCells(plain).front();
		RunRecord		counted = playRun(tallied, baseRules(), cell, 1);
		const RunRecord fought = playRun(plain, baseRules(), cell, 1);
		ASSERT_EQ(counted.fights.size(), fought.fights.size());
		const FightRecord& fight = counted.fights.front();
		ASSERT_FALSE(fight.cards.empty());
		EXPECT_TRUE(fought.fights.front().cards.empty());
		for (const auto& [card, plays] : fight.playerPlays) {
			ASSERT_TRUE(fight.cards.contains(card)) << card.value << " played without a tally";
			EXPECT_GE(fight.cards.at(card).drawn, 1) << card.value << " played and never drawn";
			EXPECT_GE(fight.cards.at(card).fizzled, 0);
		}
		// One fight, so a card played was played in it, and drawn at least as often a fight.
		const CellRow row = measureCell(tallied, cell, std::span(&counted, 1));
		ASSERT_FALSE(row.cards.empty());
		for (const auto& [card, measured] : row.cards) {
			EXPECT_EQ(measured.wonWhenPlayed.of, measured.played > 0 ? 1 : 0) << card.value;
			EXPECT_GE(measured.drawn, measured.played > 0 ? 1.0 : 0.0) << card.value;
		}

		for (FightRecord& record : counted.fights) {
			record.cards.clear();
		}
		EXPECT_EQ(counted, fought);
	}

} // namespace
