#include <rules/battle/BattleTesting.h>

#include <gtest/gtest.h>

namespace {

	using namespace rules;
	using namespace rules::fights;

	const DriverIndex kRoadWarrior{0};

	// A sure 10 from the Road Warrior at a raider whose driver is down to 1 HP, which takes the raider out.
	std::vector<Event> takeOut(BattleState& state, int raider) {
		state.driver(DriverIndex{raider}).hitpoints = 1;
		giveHand(state, kRoadWarrior, {"test_slam"});
		return apply(state, testContent(), play(0, 0, raider));
	}

	std::vector<event::FightEnded> endings(const std::vector<Event>& events) {
		return eventsOf<event::FightEnded>(events);
	}

	TEST(FightEnds, TheRaidersRoutOnceTheThreatLeftOnTheRoadAndQueuedIsAQuarterOfTheStart) {
		// Two Rust Buggies (2 each) and a Scav Bike (1) queued: 5 to start.
		BattleStart start = startBattle(
			BattleSetup{
				.players = {seat("road_warrior")},
				.raiders = {raider("rust_buggy"), raider("rust_buggy")},
				.waves = {EncounterWave{.raiders = {OpponentId{"scav_bike"}}, .arriveAt = std::nullopt, .afterTurns = std::nullopt}},
				.seed = 7,
			},
			testContent()
		);
		BattleState& state = start.state;
		planIdle(state);
		EXPECT_EQ(state.startingThreat, 5);

		giveHand(state, kRoadWarrior, {"test_slam"});
		EXPECT_TRUE(endings(apply(state, testContent(), play(0, 0, 1))).empty()) << "threat is nominal: a hurt raider counts in full";
		EXPECT_TRUE(endings(takeOut(state, 1)).empty()) << "3 left, over a quarter of 5";

		EXPECT_TRUE(
			(endings(takeOut(state, 2)) == std::vector{event::FightEnded{.outcome = Outcome::Won, .rout = RoutCause::ThreatThinned}})
		) << "the queued bike's 1 is all that's left";
		EXPECT_EQ(state.outcome, Outcome::Won);
		EXPECT_EQ(state.rout, RoutCause::ThreatThinned);
		EXPECT_EQ(state.reinforcements.queue.size(), 1U) << "the queue never arrives";
	}

	TEST(FightEnds, ALeaderOutOfTheFightRoutsTheRest) {
		// The Warlord's 6 out leaves three bikes' 3, over a quarter of 9, so only the leader routs them.
		BattleStart start =
			fight({seat("road_warrior")}, {raider("warlord"), raider("scav_bike"), raider("scav_bike"), raider("scav_bike")});
		BattleState&			 state = start.state;
		const std::vector<Event> events = takeOut(state, 1);
		EXPECT_EQ(eventsOf<event::Unmanned>(events).size(), 1U);
		EXPECT_TRUE((endings(events) == std::vector{event::FightEnded{.outcome = Outcome::Won, .rout = RoutCause::LeaderOut}}));
	}

	TEST(FightEnds, ThreeQuietPlayerTurnsRunningBreakTheFightOff) {
		BattleStart	 start = fight({seat("road_warrior")}, {raider("rust_buggy")});
		BattleState& state = start.state;
		(void)endTurn(state);
		EXPECT_EQ(state.quietTurns, 1);

		// A hit the raider's Shield takes all of doesn't count (call 197).
		state.vehicle(VehicleIndex{1}).shield = 20;
		giveHand(state, kRoadWarrior, {"test_slam"});
		(void)apply(state, testContent(), play(0, 0, 1));
		(void)endTurn(state);
		EXPECT_EQ(state.quietTurns, 2);

		giveHand(state, kRoadWarrior, {"test_slam"});
		(void)apply(state, testContent(), play(0, 0, 1));
		(void)endTurn(state);
		EXPECT_EQ(state.quietTurns, 0) << "a hit on a raider starts the count again";
		(void)endTurn(state);
		(void)endTurn(state);
		EXPECT_EQ(state.quietTurns, 2);

		// The raider's plan stands, but ending the turn now breaks off, so there's no enemy turn for its intent.
		giveHand(state, DriverIndex{1}, {"point_blank"});
		(void)replan(state, FirstOffered());
		EXPECT_EQ(state.driver(DriverIndex{1}).plan.size(), 1U);
		EXPECT_TRUE(intentsOf(state, testContent()).empty());

		const std::vector<Event> events = apply(state, testContent(), action::EndTurn{});
		EXPECT_TRUE((endings(events) == std::vector{event::FightEnded{.outcome = Outcome::BrokenOff, .rout = std::nullopt}}));
		EXPECT_TRUE(eventsOf<event::TurnStarted>(events).empty()) << "a broken-off fight has no enemy turn";
		EXPECT_TRUE(eventsOf<event::CardPlayed>(events).empty());
		EXPECT_EQ(state.outcome, Outcome::BrokenOff);
		EXPECT_EQ(state.phase, Phase::Over);
	}

} // namespace
