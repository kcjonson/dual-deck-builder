#include <rules/battle/BattleTesting.h>

#include <gtest/gtest.h>

namespace {

	using namespace rules;
	using namespace rules::fights;

	const DriverIndex  kFirst{0};
	const VehicleIndex kFirstVehicle{0};
	const VehicleIndex kSecondVehicle{1};
	const VehicleIndex kThirdVehicle{2};

	TEST(Statuses, LastTheirTurnsCountedAtThePlayersTurnAndHeavyDropsBoosts) {
		// The Interceptor's speed 8: the Lightning Bike's 5 and the driver's 3.
		BattleStart	 start = fight({seat("interceptor")}, {raider("rust_buggy")});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"nitro_boost", "berserker"});

		std::vector<Event> events = apply(state, testContent(), play(0, 0));
		EXPECT_TRUE(
			(eventsOf<event::StatusApplied>(events) == std::vector{event::StatusApplied{
														   .vehicle = kFirstVehicle,
														   .status = Status::SpeedBoost,
														   .value = 3,
														   .turns = 2,
													   }})
		);
		EXPECT_EQ(speedOf(state, kFirstVehicle), 11);
		(void)apply(state, testContent(), play(0, 0));
		EXPECT_EQ(state.driver(kFirst).hitpoints, 22);

		(void)endTurn(state);
		EXPECT_EQ(speedOf(state, kFirstVehicle), 11);
		events = endTurn(state);
		EXPECT_TRUE((
			eventsOf<event::StatusEnded>(events) == std::vector{event::StatusEnded{.vehicle = kFirstVehicle, .status = Status::SpeedBoost}}
		));
		EXPECT_EQ(speedOf(state, kFirstVehicle), 8);
		EXPECT_TRUE(hasStatus(state.vehicle(kFirstVehicle), Status::Vulnerable)) << "Berserker's Vulnerable lasts the fight";

		BattleVehicle& bike = state.vehicle(kFirstVehicle);
		bike.armor = 1;
		bike.statuses.push_back({.status = Status::SpeedBoost, .value = 3, .turns = 1});
		bike.statuses.push_back({.status = Status::SpeedReduction, .value = -2, .turns = 1});
		EXPECT_EQ(speedOf(state, kFirstVehicle), 6) << "armor past base cancels the boost, not the slow";
	}

	TEST(Statuses, VulnerableTakesHalfAgainAndEvadeRaisesWhatTheShotHasToBeat) {
		// The Interceptor's gunnery 9 against the Rust Buggy's evade 4, a Point Blank's -1 between them.
		BattleStart	 start = fight({seat("interceptor")}, {raider("rust_buggy")});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"point_blank", "point_blank"});
		BattleVehicle& buggy = state.vehicle(kSecondVehicle);
		buggy.statuses.push_back({.status = Status::Vulnerable, .value = 0, .turns = 1});
		buggy.statuses.push_back({.status = Status::EvadeBoost, .value = 4, .turns = 1});

		std::vector<Event> events = apply(state, testContent(), play(0, 0, 1));
		ASSERT_EQ(eventsOf<event::HitChecked>(events).size(), 1U);
		EXPECT_EQ(eventsOf<event::HitChecked>(events)[0].evade, 7);
		ASSERT_EQ(eventsOf<event::VehicleDamaged>(events).size(), 1U);
		EXPECT_EQ(eventsOf<event::VehicleDamaged>(events)[0].damage, 4);

		state.vehicle(kSecondVehicle).statuses.push_back({.status = Status::EvadeBoost, .value = 2, .turns = 1});
		events = apply(state, testContent(), play(0, 0, 1));
		ASSERT_EQ(eventsOf<event::HitChecked>(events).size(), 1U);
		EXPECT_FALSE(eventsOf<event::HitChecked>(events)[0].hit);
	}

	TEST(Statuses, EmpStunsEveryRaiderForTheEnemyTurnAndTheyComeBackSteady) {
		BattleStart	 start = fight({seat("mechanic")}, {raider("scav_bike"), raider("rust_buggy")});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"emp_blast"});

		std::vector<Event> events = apply(state, testContent(), play(0, 0));
		EXPECT_EQ(eventsOf<event::StatusApplied>(events).size(), 2U);
		events = endTurn(state);
		EXPECT_TRUE(
			(eventsOf<event::RaiderStunned>(events) ==
			 std::vector{event::RaiderStunned{.raider = DriverIndex{1}}, event::RaiderStunned{.raider = DriverIndex{2}}})
		);
		EXPECT_TRUE(eventsOf<event::RaiderActing>(events).empty());
		EXPECT_EQ(state.phase, Phase::PlayerTurn);
		EXPECT_EQ(state.turn, 2);
		EXPECT_EQ(eventsOf<event::BecameSteady>(events).size(), 2U);
		EXPECT_FALSE(hasStatus(state.vehicle(kSecondVehicle), Status::Stunned));

		giveHand(state, kFirst, {"emp_blast"});
		events = apply(state, testContent(), play(0, 0));
		EXPECT_EQ(eventsOf<event::ShookOffStun>(events).size(), 2U);
		EXPECT_TRUE(eventsOf<event::StatusApplied>(events).empty());
		events = endTurn(state);
		EXPECT_EQ(eventsOf<event::RaiderActing>(events).size(), 2U);

		// What a stun does to the player's side isn't in the rules, so a raider's EMP Blast is never on offer.
		struct Watching final : Policy {
			mutable bool offeredEmp{false};
			[[nodiscard]] Action
			choose(const BattleState& board, const Content&, std::span<const Action> actions, foundation::Rng&) const override {
				for (const Action& action : actions) {
					const auto* play = std::get_if<action::PlayCard>(&action);
					offeredEmp = offeredEmp || (play && board.driver(play->driver).hand[static_cast<size_t>(play->handIndex)].card ==
															CardId{"emp_blast"});
				}
				return action::EndTurn{};
			}
		} watching;
		giveHand(state, DriverIndex{1}, {"emp_blast"});
		state.driver(DriverIndex{1}).maxAdrenaline = 3;
		state.driver(DriverIndex{1}).adrenaline = 3;
		(void)replan(state, watching);
		EXPECT_FALSE(watching.offeredEmp);
	}

	TEST(Statuses, WitnessMeTriplesTheTurnsDamageThenTakesItsDriver) {
		BattleStart	 start = fight({seat("interceptor"), seat("road_warrior")}, {raider("rust_buggy")});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"witness_me", "point_blank", "point_blank"});

		(void)apply(state, testContent(), play(0, 0));
		std::vector<Event> events = apply(state, testContent(), play(0, 0, 2));
		ASSERT_EQ(eventsOf<event::VehicleDamaged>(events).size(), 1U);
		EXPECT_EQ(eventsOf<event::VehicleDamaged>(events)[0].damage, 9);

		// Tripled, then Vulnerable's half again: 3, 9, 13.
		state.vehicle(kThirdVehicle).statuses.push_back({.status = Status::Vulnerable, .value = 0, .turns = 1});
		events = apply(state, testContent(), play(0, 0, 2));
		ASSERT_EQ(eventsOf<event::VehicleDamaged>(events).size(), 1U);
		EXPECT_EQ(eventsOf<event::VehicleDamaged>(events)[0].damage, 13);

		events = endTurn(state);
		const std::vector<Event> taken{
			event::DeathMarkTaken{.vehicle = kFirstVehicle, .driver = kFirst},
			event::DriverDamaged{.driver = kFirst, .hitpoints = 25},
			event::DriverDown{.driver = kFirst},
			event::CarriesOnAsEscort{.vehicle = kFirstVehicle},
		};
		EXPECT_TRUE(std::ranges::search(events, taken).begin() != events.end());
		EXPECT_EQ(state.phase, Phase::PlayerTurn) << "the Road Warrior is still in the fight";
	}

	TEST(Statuses, ConditionalsReadTheStatusesOnTheTargetAndTheCaster) {
		BattleStart	 start = fight({seat("road_warrior")}, {raider("rust_buggy")});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"ramming_speed", "ramming_speed"});

		EXPECT_TRUE(eventsOf<event::AdrenalineGained>(apply(state, testContent(), play(0, 0, 1))).empty());
		state.vehicle(kSecondVehicle).statuses.push_back({.status = Status::Vulnerable, .value = 0, .turns = 1});
		std::vector<Event> events = apply(state, testContent(), play(0, 0, 1));
		EXPECT_TRUE((eventsOf<event::AdrenalineGained>(events) == std::vector{event::AdrenalineGained{.driver = kFirst, .adrenaline = 1}}));
		ASSERT_EQ(eventsOf<event::VehicleDamaged>(events).size(), 1U);
		EXPECT_EQ(eventsOf<event::VehicleDamaged>(events)[0].damage, 18);

		// Precision Shot's Speed+ is a speed boost, Nitro Boost's.
		BattleStart bike = fight({seat("interceptor")}, {raider("rust_buggy")});
		giveHand(bike.state, kFirst, {"precision_shot", "precision_shot"});
		EXPECT_EQ(eventsOf<event::VehicleDamaged>(apply(bike.state, testContent(), play(0, 0, 1))).size(), 1U);
		bike.state.vehicle(kFirstVehicle).statuses.push_back({.status = Status::SpeedBoost, .value = 3, .turns = 2});
		const std::vector<event::VehicleDamaged> hits = eventsOf<event::VehicleDamaged>(apply(bike.state, testContent(), play(0, 0, 1)));
		ASSERT_EQ(hits.size(), 2U);
		EXPECT_EQ(hits[1].damage, 5);
	}

	TEST(Statuses, ADamageBonusLastsUntilTheNextAttack) {
		BattleStart	 start = fight({seat("interceptor")}, {raider("rust_buggy")});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"armor_plating", "point_blank", "point_blank"});
		state.vehicle(kFirstVehicle).statuses.push_back({.status = Status::DamageBonus, .value = 50, .turns = 1});

		(void)apply(state, testContent(), play(0, 0));
		EXPECT_TRUE(hasStatus(state.vehicle(kFirstVehicle), Status::DamageBonus)) << "Armor Plating isn't an attack";
		std::vector<Event> events = apply(state, testContent(), play(0, 0, 1));
		ASSERT_EQ(eventsOf<event::VehicleDamaged>(events).size(), 1U);
		EXPECT_EQ(eventsOf<event::VehicleDamaged>(events)[0].damage, 4);
		EXPECT_TRUE((
			eventsOf<event::StatusEnded>(events) == std::vector{event::StatusEnded{.vehicle = kFirstVehicle, .status = Status::DamageBonus}}
		));
		events = apply(state, testContent(), play(0, 0, 1));
		ASSERT_EQ(eventsOf<event::VehicleDamaged>(events).size(), 1U);
		EXPECT_EQ(eventsOf<event::VehicleDamaged>(events)[0].damage, 3);
	}

	TEST(Statuses, BoxInMakesItVulnerableOnlyWithBothDrivenVehiclesInReach) {
		// The Interceptor and the Road Warrior a row behind it, the Rust Buggy across from the Interceptor and the
		// Scav Bike a row behind that.
		BattleStart	 start = fight({seat("interceptor"), seat("road_warrior")}, {raider("rust_buggy"), raider("scav_bike")});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"box_in"});
		EXPECT_FALSE(offers(legalActions(state, testContent()), play(0, 0, 3))) << "the Scav Bike is out of Range 1";

		std::vector<Event>						events = apply(state, testContent(), play(0, 0, 2));
		const std::vector<event::StatusApplied> boxed = eventsOf<event::StatusApplied>(events);
		ASSERT_EQ(boxed.size(), 2U);
		EXPECT_EQ(boxed[0].status, Status::BoxedIn);
		EXPECT_EQ(boxed[1].status, Status::Vulnerable);

		BattleStart alone = fight({seat("interceptor")}, {raider("rust_buggy")});
		giveHand(alone.state, kFirst, {"box_in"});
		events = apply(alone.state, testContent(), play(0, 0, 1));
		ASSERT_EQ(eventsOf<event::StatusApplied>(events).size(), 1U);
		EXPECT_EQ(eventsOf<event::StatusApplied>(events)[0].status, Status::BoxedIn);
	}

} // namespace
