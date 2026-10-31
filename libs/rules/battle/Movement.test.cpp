#include <rules/battle/BattleTesting.h>

#include <gtest/gtest.h>

#include <stdexcept>

namespace {

	using namespace rules;
	using namespace rules::fights;

	const DriverIndex  kFirst{0};
	const DriverIndex  kSecond{1};
	const VehicleIndex kFirstVehicle{0};
	const VehicleIndex kSecondVehicle{1};

	RoadSlot at(RoadLane lane, Row row) {
		return RoadSlot{.lane = lane, .row = row};
	}

	action::PlayCard playTo(int driver, int handIndex, std::optional<int> target, RoadSlot destination) {
		action::PlayCard card = play(driver, handIndex, target);
		card.destination = destination;
		return card;
	}

	bool happened(const std::vector<Event>& events, const Event& event) {
		return std::ranges::find(events, event) != events.end();
	}

	TEST(Movement, AFlankPullsOntoTheShoulderInTheOutrunRowAndHoldsOnlyWhileFaster) {
		// The Interceptor's speed 8 against the Rust Buggy's 5.
		BattleStart	 start = fight({seat("interceptor")}, {raider("rust_buggy")});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"flank", "lane_change", "flank"});

		const std::vector<Event> events = apply(state, testContent(), play(0, 0, 1));
		const RoadSlot			 home = at(RoadLane::PlayerInside, Row::Center);
		const RoadSlot			 shoulder = at(RoadLane::RaiderShoulder, Row::Center);
		EXPECT_TRUE(
			happened(events, event::VehicleMoved{.vehicle = kFirstVehicle, .from = home, .to = shoulder, .cause = MoveCause::Flank})
		);
		EXPECT_EQ(state.vehicle(kFirstVehicle).flank, (FlankState{.reservedSlot = home, .outran = kSecondVehicle}));
		EXPECT_TRUE(slotTaken(state, home)) << "the slot it left stays reserved";
		EXPECT_TRUE(state.vehicle(kFirstVehicle).swervedThisTurn);
		EXPECT_EQ(cardBlocker(state, testContent(), kFirst, 0), "Lane Change: a flanker can't swerve");
		EXPECT_EQ(cardBlocker(state, testContent(), kFirst, 1), "Flank: it's already flanking");

		BattleStart rig = fight({seat("road_warrior")}, {raider("rust_buggy")});
		giveHand(rig.state, kFirst, {"flank"});
		const std::optional<std::string> slower = actionBlocker(rig.state, testContent(), play(0, 0, 1));
		ASSERT_TRUE(slower);
		EXPECT_NE(slower->find("isn't faster"), std::string::npos) << *slower;

		state.vehicle(kFirstVehicle).statuses.push_back({.status = Status::SpeedReduction, .value = -4, .turns = 1});
		EXPECT_TRUE(happened(
			endTurn(state), event::VehicleMoved{.vehicle = kFirstVehicle, .from = shoulder, .to = home, .cause = MoveCause::LostTheFlank}
		));
		EXPECT_FALSE(state.vehicle(kFirstVehicle).flank);
	}

	TEST(Movement, BoxedInCantFlankAndAnAmbusherHoldsItsShoulderAndTakesBrakeChecksHit) {
		RaiderSeat ambusher = raider("scav_bike");
		ambusher.ambush = Row::Center;
		BattleStart		   start = fight({seat("interceptor")}, {raider("rust_buggy"), ambusher});
		BattleState&	   state = start.state;
		const VehicleIndex bike{2};
		EXPECT_EQ(state.vehicle(bike).slot, at(RoadLane::PlayerShoulder, Row::Center));
		EXPECT_EQ(state.vehicle(bike).flank, FlankState{});
		RaiderSeat stranded = raider("scav_bike");
		stranded.ambush = Row::Ahead;
		EXPECT_THROW((void)fight({seat("interceptor")}, {stranded}), std::invalid_argument) << "nobody of yours is in the ahead row";

		giveHand(state, kFirst, {"flank", "brake_check"});
		state.vehicle(kFirstVehicle).statuses.push_back({.status = Status::BoxedIn, .value = 0, .turns = 1});
		EXPECT_EQ(cardBlocker(state, testContent(), kFirst, 0), "Flank: it's boxed in and can't flank");

		const std::vector<Event> events = apply(state, testContent(), play(0, 1, 2));
		EXPECT_TRUE(happened(events, event::MoveBlocked{.vehicle = bike, .cancelsCard = false}))
			<< "an ambusher has no slot to drop back to";
		ASSERT_EQ(eventsOf<event::VehicleDamaged>(events).size(), 1U);
		EXPECT_EQ(eventsOf<event::VehicleDamaged>(events)[0].damage, 4);

		(void)endTurn(state);
		EXPECT_EQ(state.vehicle(bike).slot, at(RoadLane::PlayerShoulder, Row::Center));
	}

	TEST(Movement, ASwerveTakesAnAdjacentFreeSlotAndRangeCountsFromWhereItLands) {
		// The Road Warrior at inside center with the Interceptor behind it, raiders across at center, behind, ahead.
		BattleStart start =
			fight({seat("road_warrior"), seat("interceptor")}, {raider("scav_bike"), raider("rust_buggy"), raider("spike_buggy")});
		BattleState& state = start.state;
		const int	 scavBike = 2;
		giveHand(state, kFirst, {"hard_brake", "lane_change", "strafe", "weave"});
		EXPECT_EQ(cardBlocker(state, testContent(), kFirst, 0), "Hard Brake: there's nowhere to move to");

		std::vector<Event> events = apply(state, testContent(), play(0, 1));
		const RoadSlot	   inside = at(RoadLane::PlayerInside, Row::Center);
		const RoadSlot	   outside = at(RoadLane::PlayerOutside, Row::Center);
		EXPECT_TRUE(
			happened(events, event::VehicleMoved{.vehicle = kFirstVehicle, .from = inside, .to = outside, .cause = MoveCause::Swerve})
		);

		// Strafe swerves first, then shoots at Range 1 of where it went.
		const std::vector<Action> actions = legalActions(state, testContent());
		EXPECT_TRUE(offers(actions, playTo(0, 1, scavBike, inside)));
		EXPECT_FALSE(offers(actions, playTo(0, 1, scavBike, at(RoadLane::PlayerOutside, Row::Ahead))));
		EXPECT_FALSE(offers(actions, play(0, 1, scavBike))) << "Strafe needs its slot";
		events = apply(state, testContent(), playTo(0, 1, scavBike, inside));
		EXPECT_TRUE(
			happened(events, event::VehicleMoved{.vehicle = kFirstVehicle, .from = outside, .to = inside, .cause = MoveCause::Swerve})
		);
		EXPECT_EQ(eventsOf<event::HitChecked>(events).size(), 1U);

		events = apply(state, testContent(), play(0, 1));
		EXPECT_TRUE(
			(eventsOf<event::StatusApplied>(events) == std::vector{event::StatusApplied{
														   .vehicle = kFirstVehicle,
														   .status = Status::EvadeBoost,
														   .value = 2,
														   .turns = 1,
													   }})
		) << "Weave's +1 for having swerved this turn";
	}

	TEST(Movement, AShoveMovesARaiderInItsFormationOnlyWhereThereIsRoom) {
		RaiderSeat outside = raider("rust_buggy");
		outside.slot = FormationSlot{.lane = Lane::Outside, .row = Row::Center};
		BattleStart	 start = fight({seat("road_warrior")}, {raider("scav_bike"), outside});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"lay_on_the_horn", "shoulder_check"});

		std::vector<Event> events = apply(state, testContent(), play(0, 0, 1));
		EXPECT_TRUE(happened(events, event::MoveBlocked{.vehicle = kSecondVehicle, .cancelsCard = false}));
		EXPECT_TRUE(eventsOf<event::VehicleMoved>(events).empty());

		const RoadSlot			  behind = at(RoadLane::RaiderInside, Row::Behind);
		const std::vector<Action> actions = legalActions(state, testContent());
		EXPECT_TRUE(offers(actions, playTo(0, 0, 1, behind)));
		EXPECT_TRUE(offers(actions, playTo(0, 0, 1, at(RoadLane::RaiderInside, Row::Ahead))));
		EXPECT_FALSE(offers(actions, play(0, 0, 1)));
		events = apply(state, testContent(), playTo(0, 0, 1, behind));
		ASSERT_EQ(eventsOf<event::HitChecked>(events).size(), 1U);
		EXPECT_TRUE(eventsOf<event::HitChecked>(events)[0].hit);
		EXPECT_TRUE(happened(
			events,
			event::VehicleMoved{
				.vehicle = kSecondVehicle, .from = at(RoadLane::RaiderInside, Row::Center), .to = behind, .cause = MoveCause::Swerve
			}
		));
	}

	TEST(Movement, AFormationShiftTradesLanesReservationsIncludedAndPeelOffDropsBack) {
		BattleStart	 start = fight({seat("interceptor"), seat("road_warrior")}, {raider("rust_buggy")});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"flank", "peel_off"});
		giveHand(state, kSecond, {"formation_shift"});
		(void)apply(state, testContent(), play(0, 0, 2));

		std::vector<Event> events = apply(state, testContent(), play(1, 0));
		EXPECT_TRUE(happened(
			events,
			event::VehicleMoved{
				.vehicle = kSecondVehicle,
				.from = at(RoadLane::PlayerInside, Row::Behind),
				.to = at(RoadLane::PlayerOutside, Row::Behind),
				.cause = MoveCause::FormationShift,
			}
		));
		EXPECT_EQ(state.vehicle(kFirstVehicle).flank->reservedSlot, at(RoadLane::PlayerOutside, Row::Center));
		EXPECT_EQ(state.driver(kSecond).exhausted.size(), 1U);

		events = apply(state, testContent(), play(0, 0));
		EXPECT_TRUE(happened(
			events,
			event::VehicleMoved{
				.vehicle = kFirstVehicle,
				.from = at(RoadLane::RaiderShoulder, Row::Center),
				.to = at(RoadLane::PlayerOutside, Row::Center),
				.cause = MoveCause::DropBack,
			}
		));
		EXPECT_FALSE(state.vehicle(kFirstVehicle).flank);
		EXPECT_EQ(eventsOf<event::CardDrawn>(events).size(), 1U);
	}

	TEST(Movement, SlipstreamAndLeapfrogMoveAgainstThePartnersVehicle) {
		PlayerSeat ahead = seat("interceptor");
		ahead.slot = FormationSlot{.lane = Lane::Outside, .row = Row::Ahead};
		BattleStart	 start = fight({seat("road_warrior"), ahead}, {raider("scav_bike")});
		BattleState& state = start.state;
		giveHand(state, kSecond, {"slipstream"});
		giveHand(state, kFirst, {"leapfrog"});

		const RoadSlot	   behind = at(RoadLane::PlayerInside, Row::Behind);
		const RoadSlot	   center = at(RoadLane::PlayerInside, Row::Center);
		std::vector<Event> events = apply(state, testContent(), play(1, 0));
		EXPECT_TRUE(happened(
			events,
			event::VehicleMoved{
				.vehicle = kSecondVehicle, .from = at(RoadLane::PlayerOutside, Row::Ahead), .to = behind, .cause = MoveCause::Relocate
			}
		));
		EXPECT_EQ(eventsOf<event::StatusApplied>(events).size(), 1U);

		events = apply(state, testContent(), play(0, 0, 1));
		EXPECT_TRUE(
			happened(events, event::VehicleMoved{.vehicle = kFirstVehicle, .from = center, .to = behind, .cause = MoveCause::Swap})
		);
		EXPECT_TRUE(
			happened(events, event::VehicleMoved{.vehicle = kSecondVehicle, .from = behind, .to = center, .cause = MoveCause::Swap})
		);
	}

	TEST(Movement, TheRaidersCloseUpAcrossFromTheDrivenVehiclesAtTheEndOfTheirTurn) {
		BattleStart start =
			fight({seat("road_warrior"), seat("interceptor")}, {raider("scav_bike"), raider("rust_buggy"), raider("spike_buggy")});
		BattleState&	   state = start.state;
		const VehicleIndex scavBike{2};
		const VehicleIndex spikeBuggy{4};
		giveHand(state, kFirst, {"lay_on_the_horn"});
		std::vector<Event> events = apply(state, testContent(), play(0, 0, 2));
		EXPECT_TRUE(happened(
			events,
			event::VehicleMoved{
				.vehicle = scavBike,
				.from = at(RoadLane::RaiderInside, Row::Center),
				.to = at(RoadLane::RaiderOutside, Row::Center),
				.cause = MoveCause::Swerve,
			}
		));

		// The Spike Buggy a row ahead and the shoved Scav Bike a lane out are both a range away; the inside lane wins.
		events = endTurn(state);
		EXPECT_TRUE(happened(
			events,
			event::VehicleMoved{
				.vehicle = spikeBuggy,
				.from = at(RoadLane::RaiderInside, Row::Ahead),
				.to = at(RoadLane::RaiderInside, Row::Center),
				.cause = MoveCause::CloseUp,
			}
		));
		EXPECT_FALSE(state.vehicle(spikeBuggy).swervedThisTurn);
	}

	TEST(Movement, ACardsOwnMovesComeFirstForItsFlankAndItsRange) {
		// The Mechanic's speed 4 against the Rust Buggy's 5 across from it, the Spike Buggy a row ahead.
		RaiderSeat ahead = raider("spike_buggy");
		ahead.slot = FormationSlot{.lane = Lane::Inside, .row = Row::Ahead};
		BattleStart	 start = fight({seat("mechanic")}, {raider("rust_buggy"), ahead});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"flank", "overtake", "cut_off"});
		const std::vector<Action> actions = legalActions(state, testContent());
		EXPECT_FALSE(offers(actions, play(0, 0, 1))) << "too slow to flank";
		EXPECT_TRUE(offers(actions, play(0, 1, 1))) << "Overtake's +2 lands first";
		EXPECT_TRUE(offers(actions, play(0, 2, 2))) << "Cut Off's swerve ahead puts the Spike Buggy in Range 1";
		EXPECT_FALSE(offers(actions, play(0, 2, 1))) << "and the Rust Buggy out of it";

		const std::vector<Event> events = apply(state, testContent(), play(0, 1, 1));
		EXPECT_EQ(eventsOf<event::StatusApplied>(events).size(), 1U);
		EXPECT_TRUE(isFlanking(state.vehicle(kFirstVehicle)));
	}

} // namespace
