#include <rules/battle/BattleTesting.h>

#include <gtest/gtest.h>

namespace {

	using namespace rules;
	using namespace rules::fights;

	const DriverIndex  kFirst{0};
	const DriverIndex  kFirstRaider{1};
	const VehicleIndex kFirstVehicle{0};

	bool happened(const std::vector<Event>& events, const Event& event) {
		return std::ranges::find(events, event) != events.end();
	}

	TEST(EnemyTurn, RaidersCommitTheirPlansOnARehearsalAndACopyReplaysThem) {
		// The Road Warrior across from the Scav Bike, the Rust Buggy a row behind it.
		BattleStart	 start = fight({seat("road_warrior")}, {raider("scav_bike"), raider("rust_buggy")});
		BattleState& state = start.state;
		giveHand(state, kFirstRaider, {"point_blank"});
		giveHand(state, DriverIndex{2}, {"far_shoot"});
		state.phase = Phase::Planning;
		BattleState unplanned = state;

		const std::vector<Event> committed = plan(state, AimAt(0));
		EXPECT_TRUE(
			(committed ==
			 std::vector<Event>{
				 event::PlanCommitted{.raider = kFirstRaider, .steps = 1}, event::PlanCommitted{.raider = DriverIndex{2}, .steps = 1}
			 })
		);
		const PlannedStep shot{.card = {.card = CardId{"point_blank"}}, .target = kFirstVehicle};
		EXPECT_TRUE((state.driver(kFirstRaider).plan == std::vector{shot}));
		EXPECT_TRUE(plan(unplanned, AimAt(0)) == committed);
		EXPECT_TRUE(unplanned == state) << "a copy plans the same";

		BattleState				 copy = state;
		const std::vector<Event> events = apply(state, testContent(), action::EndTurn{});
		EXPECT_TRUE(events == apply(copy, testContent(), action::EndTurn{}));
		EXPECT_TRUE(copy == state);
		EXPECT_TRUE(happened(events, event::PlannedStepPlayed{.raider = kFirstRaider, .step = 0}));
		EXPECT_TRUE(happened(events, event::PlannedStepPlayed{.raider = DriverIndex{2}, .step = 0}));
		EXPECT_EQ(eventsOf<event::CardPlayed>(events).size(), 2U);
	}

	TEST(EnemyTurn, AStepThePlayerMovesOutOfReachFizzlesAndIsSpent) {
		BattleStart	 start = fight({seat("road_warrior")}, {raider("scav_bike")});
		BattleState& state = start.state;
		giveHand(state, kFirstRaider, {"point_blank"});
		(void)replan(state, AimAt(0));
		std::vector<Intent> intents = intentsOf(state, testContent());
		ASSERT_EQ(intents.size(), 1U);
		EXPECT_EQ(intents[0].kind, IntentKind::Attack);
		EXPECT_EQ(intents[0].hits, std::vector{3});

		giveHand(state, kFirst, {"lane_change"});
		(void)apply(state, testContent(), play(0, 0));
		EXPECT_TRUE(intentsOf(state, testContent()).empty()) << "an intent that will fizzle disappears";

		const std::vector<Event>					 events = apply(state, testContent(), action::EndTurn{});
		const std::vector<event::PlannedStepFizzled> fizzled = eventsOf<event::PlannedStepFizzled>(events);
		ASSERT_EQ(fizzled.size(), 1U);
		EXPECT_EQ(fizzled[0].card.card, CardId{"point_blank"});
		EXPECT_NE(fizzled[0].reason.find("out of range"), std::string::npos) << fizzled[0].reason;
		EXPECT_TRUE(eventsOf<event::CardPlayed>(events).empty());
	}

	TEST(EnemyTurn, AnElitesIntentShowsItsAimAndHidesItsNumbers) {
		// The Scav Bike (basic) across from the Interceptor, the Warlord (elite) a row behind.
		BattleStart	 start = fight({seat("interceptor")}, {raider("scav_bike"), raider("warlord")});
		BattleState& state = start.state;
		giveHand(state, kFirstRaider, {"point_blank"});
		giveHand(state, DriverIndex{2}, {"far_shoot"});
		(void)replan(state, AimAt(0));

		std::vector<Intent> intents = intentsOf(state, testContent());
		ASSERT_EQ(intents.size(), 2U);
		EXPECT_FALSE(intents[0].hidden);
		EXPECT_EQ(intents[0].card, CardId{"point_blank"});
		EXPECT_EQ(intents[0].hits, std::vector{3});
		EXPECT_TRUE(intents[1].hidden);
		EXPECT_EQ(intents[1].kind, IntentKind::Attack);
		EXPECT_EQ(intents[1].target, kFirstVehicle);
		EXPECT_FALSE(intents[1].card);
		EXPECT_TRUE(intents[1].hits.empty());

		// Worked out when shown: a Vulnerable picked up since the plan raises it.
		state.vehicle(kFirstVehicle).statuses.push_back({.status = Status::Vulnerable, .value = 0, .turns = 1});
		EXPECT_EQ(intentsOf(state, testContent())[0].hits, std::vector{4});
	}

	TEST(EnemyTurn, APlannedSwerveNamesItsSlotAndFizzlesOnceShovedOffIt) {
		BattleStart	 start = fight({seat("road_warrior")}, {raider("scav_bike")});
		BattleState& state = start.state;
		giveHand(state, kFirstRaider, {"lane_change"});
		(void)replan(state, FirstOffered());
		const RoadSlot outside{.lane = RoadLane::RaiderOutside, .row = Row::Center};
		ASSERT_EQ(state.driver(kFirstRaider).plan.size(), 1U);
		EXPECT_EQ(state.driver(kFirstRaider).plan[0].movesTo, outside);
		std::vector<Intent> intents = intentsOf(state, testContent());
		ASSERT_EQ(intents.size(), 1U);
		EXPECT_EQ(intents[0].kind, IntentKind::Move);
		EXPECT_EQ(intents[0].movesTo, outside);

		// Shoved into its own outside lane, its Lane Change would now go back inside (call 330).
		giveHand(state, kFirst, {"lay_on_the_horn"});
		(void)apply(state, testContent(), play(0, 0, 1));
		const std::vector<event::PlannedStepFizzled> fizzled =
			eventsOf<event::PlannedStepFizzled>(apply(state, testContent(), action::EndTurn{}));
		ASSERT_EQ(fizzled.size(), 1U);
		EXPECT_EQ(fizzled[0].reason, "its move no longer goes where it was planned");
	}

	TEST(EnemyTurn, AStepPlannedAtAWreckFollowsWhoGotOut) {
		// The Road Warrior and the Interceptor behind it; the Rust Buggy across from the first, the Scav Bike from the second.
		BattleStart		  start = fight({seat("road_warrior"), seat("interceptor")}, {raider("rust_buggy"), raider("scav_bike")});
		BattleState&	  state = start.state;
		const DriverIndex scavBike{3};
		giveHand(state, DriverIndex{2}, {"test_slam"});
		giveHand(state, scavBike, {"far_shoot"});
		(void)replan(state, AimAt(0));
		state.vehicle(kFirstVehicle).structure = 1;
		state.vehicle(kFirstVehicle).armor = 0;

		const std::vector<Event> events = apply(state, testContent(), action::EndTurn{});
		EXPECT_TRUE(happened(events, event::JumpedAboard{.driver = kFirst, .vehicle = VehicleIndex{1}}));
		EXPECT_TRUE(happened(events, event::PlanRedirected{.raider = scavBike, .step = 0, .from = kFirstVehicle, .to = VehicleIndex{1}}));
		EXPECT_TRUE(happened(events, event::PlannedStepPlayed{.raider = scavBike, .step = 0}));
	}

} // namespace
