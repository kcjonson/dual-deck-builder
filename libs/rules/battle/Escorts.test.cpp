#include <rules/battle/BattleTesting.h>

#include <gtest/gtest.h>

#include <stdexcept>

namespace {

	using namespace rules;
	using namespace rules::fights;

	const DriverIndex kFirst{0};

	RoadSlot at(RoadLane lane, Row row) {
		return RoadSlot{.lane = lane, .row = row};
	}

	bool happened(const std::vector<Event>& events, const Event& event) {
		return std::ranges::find(events, event) != events.end();
	}

	action::PlayCard aboard(int handIndex, int target, int occupant) {
		action::PlayCard card = play(0, handIndex, target);
		card.occupant = DriverIndex{occupant};
		return card;
	}

	TEST(Escorts, OpenInTheirTypesSlotsAndAnOrderNeedsOneOfThem) {
		BattleStart start = convoy(
			{seat("road_warrior"), seat("interceptor")}, {"outrider", "pilot_car", "fuel_hauler", "med_truck"}, {raider("scav_bike")}
		);
		const BattleState& state = start.state;
		EXPECT_EQ(state.vehicle(VehicleIndex{2}).slot, at(RoadLane::PlayerInside, Row::Ahead));
		EXPECT_EQ(state.vehicle(VehicleIndex{3}).slot, at(RoadLane::PlayerOutside, Row::Ahead));
		EXPECT_EQ(state.vehicle(VehicleIndex{4}).slot, at(RoadLane::PlayerOutside, Row::Center));
		EXPECT_EQ(state.vehicle(VehicleIndex{5}).slot, at(RoadLane::PlayerOutside, Row::Behind));
		EXPECT_EQ(state.vehicle(VehicleIndex{2}).crew, (CrewSkills{.gunnery = 6, .evade = 6, .ramming = 2}));
		EXPECT_FALSE(state.vehicle(VehicleIndex{2}).spent);

		const BattleStart twins = convoy({seat("road_warrior")}, {"outrider", "outrider"}, {raider("scav_bike")});
		EXPECT_EQ(twins.state.vehicle(VehicleIndex{1}).slot, at(RoadLane::PlayerInside, Row::Ahead)) << "the first acquired gets it";
		EXPECT_EQ(twins.state.vehicle(VehicleIndex{2}).slot, at(RoadLane::PlayerInside, Row::Behind));
		EXPECT_THROW(
			(void)convoy({seat("road_warrior")}, {"outrider", "outrider", "outrider", "outrider", "outrider"}, {raider("scav_bike")}),
			std::invalid_argument
		);

		BattleStart	 alone = fight({seat("road_warrior")}, {raider("scav_bike")});
		BattleState& road = alone.state;
		giveHand(road, kFirst, {"covering_fire", "triage"});
		EXPECT_NE(cardBlocker(road, testContent(), kFirst, 0)->find("needs a ready escort"), std::string::npos);
		EXPECT_NE(cardBlocker(road, testContent(), kFirst, 1)->find("needs a living Med Truck"), std::string::npos);
	}

	TEST(Escorts, TheNearestReadyEscortInRangeCarriesAnAttackOrderAndIsSpent) {
		// The Pilot Car is three from the Rust Buggy, the Outrider two.
		BattleStart		   start = convoy({seat("road_warrior")}, {"pilot_car", "outrider"}, {raider("rust_buggy"), raider("scav_bike")});
		BattleState&	   state = start.state;
		const VehicleIndex outrider{2};
		giveHand(state, kFirst, {"covering_fire", "covering_fire"});

		const std::vector<Event> events = apply(state, testContent(), play(0, 0, 3));
		EXPECT_TRUE(happened(events, event::OrderCarried{.escort = outrider, .target = VehicleIndex{3}}));
		ASSERT_EQ(eventsOf<event::HitChecked>(events).size(), 1U);
		EXPECT_EQ(eventsOf<event::HitChecked>(events)[0].attacker, outrider);
		EXPECT_EQ(eventsOf<event::HitChecked>(events)[0].skill, 6);
		EXPECT_TRUE(happened(events, event::EscortSpent{.escort = outrider}));
		EXPECT_FALSE(offers(legalActions(state, testContent()), play(0, 0, 3))) << "the Pilot Car can't reach";
		(void)endTurn(state);
		EXPECT_FALSE(state.vehicle(outrider).spent);

		// A bike carrying on as an escort carries orders with its default crew.
		BattleStart	 pair = fight({seat("road_warrior"), seat("interceptor")}, {raider("rust_buggy")});
		BattleState& road = pair.state;
		road.driver(DriverIndex{1}).hitpoints = 0;
		road.vehicle(VehicleIndex{1}).driver.reset();
		road.vehicle(VehicleIndex{1}).crew = kUnmannedCrew;
		giveHand(road, kFirst, {"covering_fire"});
		const std::vector<event::HitChecked> checks = eventsOf<event::HitChecked>(apply(road, testContent(), play(0, 0, 2)));
		ASSERT_EQ(checks.size(), 1U);
		EXPECT_EQ(checks[0].attacker, VehicleIndex{1});
		EXPECT_FALSE(checks[0].hit) << "gunnery 4 against the Rust Buggy's evade 4";
	}

	TEST(Escorts, SignatureAndBuffOrdersGoToTheirOwnEscorts) {
		// The Outrider at inside ahead, the Pilot Car outside ahead, the Fuel Hauler outside center; raiders across at
		// center, behind, and ahead.
		BattleStart start = convoy(
			{seat("road_warrior")},
			{"outrider", "pilot_car", "fuel_hauler"},
			{raider("rust_buggy"), raider("scav_bike"), raider("spike_buggy")}
		);
		BattleState&	   state = start.state;
		const VehicleIndex outrider{1};
		const VehicleIndex pilotCar{2};
		const VehicleIndex hauler{3};
		giveHand(state, kFirst, {"flag_down", "run_ahead", "top_off", "close_ranks", "fall_in", "triage"});

		std::vector<Event> events = apply(state, testContent(), play(0, 0, 6));
		EXPECT_TRUE(happened(events, event::OrderCarried{.escort = pilotCar, .target = VehicleIndex{6}}));
		EXPECT_EQ(eventsOf<event::StatusApplied>(events).size(), 2U);
		EXPECT_TRUE(state.vehicle(pilotCar).spent);

		events = apply(state, testContent(), play(0, 0, 4));
		EXPECT_TRUE(happened(events, event::OrderCarried{.escort = outrider, .target = VehicleIndex{4}}));
		EXPECT_TRUE(isFlanking(state.vehicle(outrider))) << "speed 5 and Run Ahead's 2 outrun the Rust Buggy's 5";

		events = apply(state, testContent(), aboard(0, 0, 0));
		EXPECT_TRUE(happened(events, event::AdrenalineGained{.driver = kFirst, .adrenaline = 1}));
		events = apply(state, testContent(), play(0, 0, 3));
		EXPECT_TRUE(happened(events, event::ShieldGained{.vehicle = hauler, .shield = 6}));
		action::PlayCard fallIn = play(0, 0, 3);
		fallIn.destination = at(RoadLane::PlayerInside, Row::Behind);
		events = apply(state, testContent(), fallIn);
		EXPECT_EQ(state.vehicle(hauler).slot, at(RoadLane::PlayerInside, Row::Behind));
		EXPECT_FALSE(state.vehicle(hauler).spent) << "Top Off, Close Ranks, and Fall In don't spend it";

		EXPECT_NE(cardBlocker(state, testContent(), kFirst, 0)->find("needs a living Med Truck"), std::string::npos);
	}

	TEST(Escorts, RallyTheConvoyFiresEachReadyEscortThenSpendsThemAll) {
		BattleStart	 start = convoy({seat("road_warrior")}, {"outrider", "med_truck"}, {raider("rust_buggy")});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"rally_the_convoy"});

		const std::vector<Event> events = apply(state, testContent(), play(0, 0));
		EXPECT_TRUE(happened(events, event::OrderCarried{.escort = VehicleIndex{1}, .target = VehicleIndex{3}}));
		EXPECT_TRUE(happened(events, event::OrderCarried{.escort = VehicleIndex{2}, .target = std::nullopt})) << "the Med Truck is 3 away";
		EXPECT_EQ(eventsOf<event::VehicleDamaged>(events).size(), 1U);
		EXPECT_EQ(eventsOf<event::EscortSpent>(events).size(), 2U);
		EXPECT_EQ(state.driver(kFirst).exhausted.size(), 1U);
	}

	TEST(Escorts, DrawFirePullsAShotAtItsRowThatCanReachIt) {
		// The Rig at inside center beside the Fuel Hauler outside, the Rust Buggy across.
		BattleStart		   start = convoy({seat("road_warrior")}, {"fuel_hauler"}, {raider("rust_buggy")});
		BattleState&	   state = start.state;
		const VehicleIndex rig{0};
		const VehicleIndex hauler{1};
		giveHand(state, DriverIndex{1}, {"far_shoot", "point_blank"});
		(void)replan(state, AimAt(0));
		giveHand(state, kFirst, {"draw_fire"});

		std::vector<Event> events = apply(state, testContent(), play(0, 0, 1));
		EXPECT_TRUE(happened(events, event::DrawingFire{.escort = hauler}));
		EXPECT_TRUE(happened(events, event::EscortSpent{.escort = hauler}));
		const std::vector<Intent> intents = intentsOf(state, testContent());
		ASSERT_EQ(intents.size(), 2U);
		EXPECT_EQ(intents[0].target, hauler) << "Far Shoot reaches the hauler";
		EXPECT_EQ(intents[1].target, rig) << "Point Blank can't, so it keeps its target";

		events = apply(state, testContent(), action::EndTurn{});
		EXPECT_TRUE(happened(events, event::FireDrawn{.raider = DriverIndex{1}, .step = 0, .from = rig, .to = hauler}));
		EXPECT_EQ(eventsOf<event::FireDrawn>(events).size(), 1U);
		EXPECT_TRUE(state.drawFireCovers.empty()) << "it lasts until the end of the enemy turn";
	}

} // namespace
