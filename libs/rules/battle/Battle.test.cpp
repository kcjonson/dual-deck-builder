#include <rules/battle/BattleTesting.h>

#include <gtest/gtest.h>

#include <stdexcept>

namespace {

	using namespace rules;
	using namespace rules::fights;

	TEST(RoadGrid, RangeIsLanesApartPlusRowsApart) {
		const RoadSlot inside{.lane = RoadLane::PlayerInside, .row = Row::Center};
		EXPECT_EQ(slotRange(inside, {.lane = RoadLane::RaiderInside, .row = Row::Center}), 1);
		EXPECT_EQ(slotRange(inside, {.lane = RoadLane::RaiderInside, .row = Row::Ahead}), 2);
		EXPECT_EQ(slotRange(inside, {.lane = RoadLane::RaiderOutside, .row = Row::Center}), 2);
		EXPECT_EQ(
			slotRange({.lane = RoadLane::RaiderShoulder, .row = Row::Behind}, {.lane = RoadLane::RaiderInside, .row = Row::Behind}), 2
		);
		EXPECT_EQ(
			slotRange({.lane = RoadLane::PlayerOutside, .row = Row::Ahead}, {.lane = RoadLane::RaiderOutside, .row = Row::Behind}), 5
		);
	}

	TEST(BattleStart, SeatsEveryoneOnTheRoadAndDealsTheOpeningHands) {
		const BattleStart start =
			fight({seat("interceptor"), seat("road_warrior")}, {raider("rust_buggy"), raider("scav_bike"), raider("spike_buggy")});
		const BattleState& state = start.state;
		ASSERT_EQ(state.drivers.size(), 5U);
		ASSERT_EQ(state.vehicles.size(), 5U);

		const std::vector<RoadSlot> opening{
			{.lane = RoadLane::PlayerInside, .row = Row::Center},
			{.lane = RoadLane::PlayerInside, .row = Row::Behind},
			{.lane = RoadLane::RaiderInside, .row = Row::Center},
			{.lane = RoadLane::RaiderInside, .row = Row::Behind},
			{.lane = RoadLane::RaiderInside, .row = Row::Ahead},
		};
		const std::vector<size_t> deckSizes{11, 12, 5, 5, 6};
		for (size_t index = 0; index < state.vehicles.size(); ++index) {
			EXPECT_EQ(state.vehicles[index].slot, opening[index]) << "vehicle " << index;
			const BattleDriver& driver = state.drivers[index];
			EXPECT_EQ(driver.hand.size(), 5U) << "driver " << index;
			EXPECT_EQ(driver.hand.size() + driver.deck.size(), deckSizes[index]) << "driver " << index;
			EXPECT_EQ(driver.adrenaline, driver.maxAdrenaline) << "driver " << index;
		}
		EXPECT_EQ(state.phase, Phase::PlayerTurn);
		EXPECT_EQ(state.turn, 1);
		EXPECT_EQ(state.vehicle(VehicleIndex{1}).structure, 80);
		EXPECT_EQ(state.vehicle(VehicleIndex{1}).armor, 10);
		EXPECT_EQ(speedOf(state, VehicleIndex{0}), 8);

		ASSERT_GT(start.events.size(), 5U);
		for (size_t index = 0; index < 5; ++index) {
			EXPECT_TRUE(
				(start.events[index] == Event{event::DeckShuffled{.driver = DriverIndex{static_cast<int>(index)}, .fromDiscard = false}})
			);
		}
		EXPECT_TRUE((start.events[5] == Event{event::TurnStarted{.turn = 1, .side = Side::Player}}));
		EXPECT_EQ(eventsOf<event::CardDrawn>(start.events).size(), 25U);
	}

	TEST(BattleStart, RefusesASetupTheRulesDont) {
		EXPECT_THROW((void)fight({seat("interceptor"), seat("interceptor")}, {raider("scav_bike")}), std::invalid_argument);
		EXPECT_THROW(
			(void)fight({seat("interceptor"), seat("road_warrior"), seat("mechanic")}, {raider("scav_bike")}), std::invalid_argument
		);
		EXPECT_THROW((void)fight({seat("interceptor")}, {}), std::invalid_argument);
		const RaiderSeat bike = raider("scav_bike");
		EXPECT_THROW((void)fight({seat("interceptor")}, {bike, bike, bike, bike, bike, bike, bike}), std::invalid_argument);

		PlayerSeat bogus = seat("interceptor");
		bogus.deck.push_back(BattleCard{.card = CardId{"no_such_card"}, .upgraded = false});
		EXPECT_THROW((void)fight({bogus}, {bike}), std::invalid_argument);

		RaiderSeat placed = bike;
		placed.slot = FormationSlot{.lane = Lane::Outside, .row = Row::Ahead};
		EXPECT_THROW((void)fight({seat("interceptor")}, {placed, placed}), std::invalid_argument);
		EXPECT_EQ(
			fight({seat("interceptor")}, {bike, placed}).state.vehicle(VehicleIndex{2}).slot,
			(RoadSlot{.lane = RoadLane::RaiderOutside, .row = Row::Ahead})
		);
	}

	TEST(Battle, ACopyPlaysOutExactlyAsTheOriginal) {
		const BattleSetup setup{
			.players = {seat("interceptor"), seat("road_warrior")},
			.raiders = {raider("rust_buggy"), raider("scav_bike")},
			.seed = 1234,
		};
		const BattleStart start = startBattle(setup, testContent());
		EXPECT_TRUE(start.state == startBattle(setup, testContent()).state);
		BattleSetup reseeded = setup;
		reseeded.seed = 99;
		EXPECT_FALSE(start.state == startBattle(reseeded, testContent()).state);

		BattleState original = start.state;
		for (int step = 0; step < 4; ++step) {
			(void)apply(original, testContent(), legalActions(original, testContent()).front());
		}
		BattleState copy = original;
		int			reshuffles = 0;
		for (int step = 0; step < 80 && original.phase != Phase::Over; ++step) {
			// The first action offered: plays until the adrenaline runs out, then the end of the turn.
			const Action			 action = legalActions(original, testContent()).front();
			const std::vector<Event> played = apply(original, testContent(), action);
			ASSERT_TRUE(played == apply(copy, testContent(), action)) << "step " << step;
			ASSERT_TRUE(original == copy) << "step " << step;
			for (const event::DeckShuffled& shuffle : eventsOf<event::DeckShuffled>(played)) {
				reshuffles += shuffle.fromDiscard ? 1 : 0;
			}
		}
		EXPECT_GT(reshuffles, 0);
	}

	TEST(Battle, ThePlayersTurnThenEachRaiderInTurnThenEveryoneRefills) {
		BattleStart	 start = fight({seat("road_warrior")}, {raider("scav_bike"), raider("rust_buggy")});
		BattleState& state = start.state;
		giveHand(state, DriverIndex{0}, {"armor_plating", "point_blank"});
		for (const Action& action : legalActions(state, testContent())) {
			if (const auto* offered = std::get_if<action::PlayCard>(&action)) {
				EXPECT_EQ(offered->driver, DriverIndex{0});
			}
		}

		std::vector<Event> events = apply(state, testContent(), play(0, 0));
		EXPECT_EQ(state.vehicle(VehicleIndex{0}).armor, 18);
		EXPECT_EQ(state.driver(DriverIndex{0}).adrenaline, 4);
		state.vehicle(VehicleIndex{0}).shield = 4;

		events = apply(state, testContent(), action::EndTurn{});
		EXPECT_EQ(state.phase, Phase::EnemyTurn);
		EXPECT_EQ(state.actingRaider, DriverIndex{1});
		EXPECT_TRUE(state.driver(DriverIndex{0}).hand.empty());
		EXPECT_EQ(eventsOf<event::RaiderActing>(events).size(), 1U);
		for (const Action& action : legalActions(state, testContent())) {
			if (const auto* offered = std::get_if<action::PlayCard>(&action)) {
				EXPECT_EQ(offered->driver, DriverIndex{1});
			}
		}
		EXPECT_THROW((void)apply(state, testContent(), play(0, 0)), std::invalid_argument);

		(void)apply(state, testContent(), action::EndTurn{});
		EXPECT_EQ(state.actingRaider, DriverIndex{2});

		events = apply(state, testContent(), action::EndTurn{});
		EXPECT_EQ(state.phase, Phase::PlayerTurn);
		EXPECT_EQ(state.turn, 2);
		EXPECT_FALSE(state.actingRaider);
		EXPECT_EQ(state.vehicle(VehicleIndex{0}).shield, 0);
		EXPECT_EQ(eventsOf<event::ShieldCleared>(events).size(), 1U);
		EXPECT_EQ(eventsOf<event::HandDiscarded>(events).size(), 2U);
		for (const BattleDriver& driver : state.drivers) {
			EXPECT_EQ(driver.adrenaline, driver.maxAdrenaline);
			EXPECT_EQ(driver.hand.size(), 5U);
		}
	}

	TEST(Battle, ADrawPastTheHandLimitBurnsToDiscardAndADryDeckTakesItsDiscardBack) {
		BattleStart	  start = fight({seat("road_warrior")}, {raider("scav_bike")});
		BattleState&  state = start.state;
		BattleDriver& warrior = state.driver(DriverIndex{0});
		giveHand(state, DriverIndex{0}, {"test_draw", "armor_plating", "armor_plating", "repair_kit", "repair_kit"});
		warrior.discard.clear();

		std::vector<Event> events = apply(state, testContent(), play(0, 0));
		EXPECT_EQ(eventsOf<event::CardDrawn>(events).size(), 3U);
		ASSERT_EQ(eventsOf<event::CardBurned>(events).size(), 1U);
		EXPECT_EQ(warrior.hand.size(), 7U);
		ASSERT_EQ(warrior.discard.size(), 2U);
		EXPECT_EQ(warrior.discard[0].card, CardId{"test_draw"});
		EXPECT_EQ(warrior.discard[1], eventsOf<event::CardBurned>(events)[0].card);

		giveHand(state, DriverIndex{0}, {"test_draw"});
		warrior.deck = {BattleCard{.card = CardId{"repair_kit"}}};
		warrior.discard = {BattleCard{.card = CardId{"nitro_boost"}}, BattleCard{.card = CardId{"armor_plating"}}};
		events = apply(state, testContent(), play(0, 0));
		ASSERT_EQ(eventsOf<event::DeckShuffled>(events).size(), 1U);
		EXPECT_TRUE(eventsOf<event::DeckShuffled>(events)[0].fromDiscard);
		EXPECT_EQ(eventsOf<event::CardDrawn>(events).size(), 4U);
		EXPECT_EQ(warrior.hand.size(), 4U);
		EXPECT_TRUE(warrior.deck.empty());
		EXPECT_TRUE(warrior.discard.empty());
	}

	TEST(Battle, ACardWithAPartTheRulesDontPlayYetIsNeverLegal) {
		BattleStart	 start = fight({seat("interceptor")}, {raider("rust_buggy")});
		BattleState& state = start.state;
		// A move, an order, a flank condition, a swerve bonus, and a flank alongside a status the rules do play.
		giveHand(state, DriverIndex{0}, {"lane_change", "close_ranks", "oil_slick", "weave", "flanking_maneuver", "headshot"});
		const std::vector<Action> actions = legalActions(state, testContent());
		for (int handIndex = 0; handIndex < 5; ++handIndex) {
			const std::optional<std::string> blocker = cardBlocker(state, testContent(), DriverIndex{0}, handIndex);
			ASSERT_TRUE(blocker) << "card " << handIndex;
			EXPECT_NE(blocker->find("can't be played yet"), std::string::npos) << *blocker;
			for (const std::optional<int> target : {std::optional<int>(), std::optional<int>(1)}) {
				EXPECT_FALSE(offers(actions, play(0, handIndex, target))) << "card " << handIndex;
				EXPECT_THROW((void)apply(state, testContent(), play(0, handIndex, target)), std::invalid_argument);
			}
		}
		EXPECT_TRUE(offers(actions, play(0, 5, 1)));
	}

	TEST(Battle, AFightThatsOverOffersNothing) {
		BattleStart	 start = fight({seat("interceptor")}, {raider("scav_bike")});
		BattleState& state = start.state;
		giveHand(state, DriverIndex{0}, {"test_slam"});
		const std::vector<Event> events = apply(state, testContent(), play(0, 0, 1));
		EXPECT_EQ(eventsOf<event::Unmanned>(events).size(), 1U);
		ASSERT_FALSE(events.empty());
		EXPECT_TRUE((events.back() == Event{event::FightEnded{.outcome = Outcome::Won}}));
		EXPECT_EQ(state.phase, Phase::Over);
		EXPECT_TRUE(legalActions(state, testContent()).empty());
		EXPECT_THROW((void)apply(state, testContent(), action::EndTurn{}), std::invalid_argument);
	}

} // namespace
