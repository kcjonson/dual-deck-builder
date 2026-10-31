#include "Measures.h"
#include "Fights.h"
#include "SimTesting.h"

#include <gtest/gtest.h>

namespace {

	using namespace sim;
	using namespace sim::tests;
	using rules::CardId;
	using rules::OpponentId;
	using rules::Outcome;

	TEST(Measures, ARateCarriesItsCountAndItsNinetyPercentWilsonInterval) {
		const Rate half = rateOf(5, 10);
		EXPECT_EQ(half.count, 5);
		EXPECT_EQ(half.of, 10);
		EXPECT_DOUBLE_EQ(*half.rate, 0.5);
		EXPECT_NEAR(*half.low, 0.26927, 1e-4);
		EXPECT_NEAR(*half.high, 0.73073, 1e-4);

		// Exact at the ends, and nothing at all with nothing counted.
		EXPECT_EQ(*rateOf(0, 20).low, 0.0);
		EXPECT_EQ(*rateOf(20, 20).high, 1.0);
		EXPECT_LT(*rateOf(20, 20).low, 1.0);
		EXPECT_EQ(rateOf(0, 0), Rate{});
		EXPECT_THROW((void)rateOf(3, 2), std::invalid_argument);
		EXPECT_FALSE(meanOf({}).has_value());
	}

	FightRecord fight(std::optional<Outcome> outcome, int hitpointsLost = 0) {
		return FightRecord{
			.skulls = 1,
			.encounter = rules::EncounterId{"scav_pack"},
			.outcome = outcome,
			.turns = 4,
			.hitpointsAtStart = 60,
			.hitpointsAtEnd = 60 - hitpointsLost,
			.mostHitpoints = 60,
			.structureAtStart = 100,
			.structureAtEnd = 100,
			.mostStructure = 100,
		};
	}

	TEST(Measures, ACellMeasuresItsRunsHomeItsSeatingsAndEachPlaceOnItsRoute) {
		const FightsConfig config =
			configOf(nlohmann::json::parse(R"({"crews": [["road_warrior", "interceptor"]], "routes": [[1, 2]], "runs": 4})"));
		const FightCell		   cell = fightCells(config).front();
		std::vector<RunRecord> runs(4);
		// Run 1, in the crew's order: home through both fights, losing 6 HP in the first and leaving a quarter of its HP.
		runs[0].fights = {fight(Outcome::Won, 6), fight(Outcome::Won)};
		runs[0].fights[0].raiderPlays[OpponentId{"scav_bike"}][CardId{"far_shoot"}] = CardPlays{.played = 3, .fizzled = 1};
		runs[0].fights[0].playerPlays[CardId{"ram"}] = 4;
		runs[0].hitpointsLost = 15;
		runs[0].mostHitpoints = 60;
		runs[0].injuryDays = 2;
		// Run 2, swapped: lost the second fight.
		runs[1] = RunRecord{.end = RunEnd::Lost, .swapped = true, .fights = {fight(Outcome::Won, 12), fight(Outcome::Lost)}};
		// Run 3, in order: stalled in the first.
		runs[2] = RunRecord{.end = RunEnd::Stalled, .fights = {fight(std::nullopt)}};
		// Run 4, swapped: broken off, then home, with nothing lost.
		runs[3] = RunRecord{.swapped = true, .fights = {fight(Outcome::BrokenOff), fight(Outcome::Won)}};
		runs[3].mostHitpoints = 60;
		runs[3].fights[1].rout = rules::RoutCause::LeaderOut;

		const CellRow row = measureCell(config, cell, runs);
		EXPECT_EQ(row.cell, "road_warrior+interceptor:1+2@0");
		EXPECT_EQ(row.home, rateOf(2, 4));
		EXPECT_EQ(row.lost, rateOf(1, 4));
		EXPECT_EQ(row.stalled, rateOf(1, 4));
		EXPECT_EQ(row.brokenOff, rateOf(1, 4));
		EXPECT_EQ(row.routed, rateOf(1, 4));
		ASSERT_TRUE(row.bySeat.has_value());
		EXPECT_EQ((*row.bySeat)[0], rateOf(1, 2));
		EXPECT_EQ((*row.bySeat)[1], rateOf(1, 2));
		// Over the two runs home.
		EXPECT_DOUBLE_EQ(*row.hitpointsLost, 0.125);
		EXPECT_DOUBLE_EQ(*row.injuryDays, 1);
		EXPECT_DOUBLE_EQ(*row.turns, 8);

		// Every run reached the first fight, and three the second; what was lost is over the fights won.
		ASSERT_EQ(row.fights.size(), 2U);
		EXPECT_EQ(row.fights[0].won, rateOf(2, 4));
		EXPECT_EQ(row.fights[0].stalled, rateOf(1, 4));
		EXPECT_DOUBLE_EQ(*row.fights[0].hitpointsLost, 0.15);
		EXPECT_EQ(row.fights[1].skulls, 2);
		EXPECT_EQ(row.fights[1].won, rateOf(2, 3));
		EXPECT_EQ(row.fights[1].routed, rateOf(1, 3));

		// Plays are a fight's, over the seven fights played.
		EXPECT_DOUBLE_EQ(row.raiderPlays.at(OpponentId{"scav_bike"}).at(CardId{"far_shoot"}).played, 3.0 / 7);
		EXPECT_DOUBLE_EQ(row.raiderPlays.at(OpponentId{"scav_bike"}).at(CardId{"far_shoot"}).fizzled, 1.0 / 7);
		EXPECT_DOUBLE_EQ(row.playerPlays.at(CardId{"ram"}), 4.0 / 7);
	}

} // namespace
