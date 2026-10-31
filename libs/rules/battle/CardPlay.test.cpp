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

	TEST(CardPlay, AShotHitsOnGunneryOverEvadeAndItsModifier) {
		// The Road Warrior's gunnery 4 against the Scav Bike's evade 4, a range apart.
		BattleStart	 start = fight({seat("road_warrior")}, {raider("scav_bike")});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"point_blank", "far_shoot"});

		std::vector<Event> events = apply(state, testContent(), play(0, 0, 1));
		ASSERT_EQ(eventsOf<event::HitChecked>(events).size(), 1U);
		EXPECT_TRUE(
			(eventsOf<event::HitChecked>(events)[0] == event::HitChecked{
														   .attacker = kFirstVehicle,
														   .defender = kSecondVehicle,
														   .attackType = AttackType::Ranged,
														   .skill = 4,
														   .evade = 3,
														   .hit = true,
													   })
		);
		EXPECT_EQ(state.vehicle(kSecondVehicle).structure, 10);
		EXPECT_EQ(state.driver(kSecond).hitpoints, 3);

		events = apply(state, testContent(), play(0, 0, 1));
		ASSERT_EQ(eventsOf<event::HitChecked>(events).size(), 1U);
		EXPECT_FALSE(eventsOf<event::HitChecked>(events)[0].hit);
		EXPECT_EQ(eventsOf<event::HitChecked>(events)[0].evade, 4);
		EXPECT_TRUE(eventsOf<event::VehicleDamaged>(events).empty());
		EXPECT_EQ(state.vehicle(kSecondVehicle).structure, 10);
	}

	TEST(CardPlay, AHitTakesShieldThenArmorThenHalvesTheRestAndAHeadshotSkipsThemAll) {
		BattleStart	 start = fight({seat("interceptor")}, {raider("rust_buggy")});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"test_slam", "headshot"});
		state.vehicle(kSecondVehicle).shield = 2;

		std::vector<Event> events = apply(state, testContent(), play(0, 0, 1));
		ASSERT_EQ(eventsOf<event::VehicleDamaged>(events).size(), 1U);
		EXPECT_TRUE(
			(eventsOf<event::VehicleDamaged>(events)[0] == event::VehicleDamaged{
															   .vehicle = kSecondVehicle,
															   .damage = 10,
															   .shield = 2,
															   .armor = 5,
															   .structure = 2,
														   })
		);
		EXPECT_TRUE((eventsOf<event::DriverDamaged>(events) == std::vector{event::DriverDamaged{.driver = kSecond, .hitpoints = 2}}));
		EXPECT_EQ(state.vehicle(kSecondVehicle).structure, 28);
		EXPECT_EQ(state.vehicle(kSecondVehicle).armor, 0);

		state.vehicle(kSecondVehicle).shield = 5;
		state.vehicle(kSecondVehicle).armor = 4;
		events = apply(state, testContent(), play(0, 0, 1));
		EXPECT_TRUE(eventsOf<event::VehicleDamaged>(events).empty());
		EXPECT_TRUE((eventsOf<event::DriverDamaged>(events) == std::vector{event::DriverDamaged{.driver = kSecond, .hitpoints = 5}}));
		EXPECT_EQ(state.vehicle(kSecondVehicle).shield, 5);
		EXPECT_EQ(state.vehicle(kSecondVehicle).armor, 4);
	}

	TEST(CardPlay, ARamHitsOnRammingAndAddsArmorAndTheSpeedGap) {
		// Speed 2 against the Rust Buggy's 5: Armor / 10 + the gap, or upgraded Armor / 7 + twice it.
		BattleStart	 start = fight({seat("road_warrior")}, {raider("rust_buggy")});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"ram"});
		state.driver(kFirst).hand.push_back(BattleCard{.card = CardId{"ram"}, .upgraded = true});
		state.vehicle(kFirstVehicle).armor = 60;
		state.vehicle(kFirstVehicle).shield = 9;

		std::vector<Event> events = apply(state, testContent(), play(0, 0, 1));
		ASSERT_EQ(eventsOf<event::HitChecked>(events).size(), 1U);
		EXPECT_EQ(eventsOf<event::HitChecked>(events)[0].attackType, AttackType::Ramming);
		EXPECT_EQ(eventsOf<event::HitChecked>(events)[0].skill, 8);
		ASSERT_EQ(eventsOf<event::VehicleDamaged>(events).size(), 1U);
		EXPECT_EQ(eventsOf<event::VehicleDamaged>(events)[0].damage, 3);

		events = apply(state, testContent(), play(0, 0, 1));
		ASSERT_EQ(eventsOf<event::VehicleDamaged>(events).size(), 1U);
		EXPECT_EQ(eventsOf<event::VehicleDamaged>(events)[0].damage, 2);

		// The Interceptor's gunnery 9 would hit the Rust Buggy, but a ram reads its ramming 3.
		BattleStart bike = fight({seat("interceptor")}, {raider("rust_buggy")});
		giveHand(bike.state, kFirst, {"ram"});
		events = apply(bike.state, testContent(), play(0, 0, 1));
		ASSERT_EQ(eventsOf<event::HitChecked>(events).size(), 1U);
		EXPECT_FALSE(eventsOf<event::HitChecked>(events)[0].hit);
	}

	TEST(CardPlay, AttackingFromTheShoulderDealsHalfAgain) {
		BattleStart	 start = fight({seat("interceptor")}, {raider("rust_buggy"), raider("scav_bike")});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"headshot"});
		state.vehicle(kFirstVehicle).slot = RoadSlot{.lane = RoadLane::RaiderShoulder, .row = Row::Center};
		state.vehicle(kFirstVehicle).flank = FlankState{};
		const std::vector<Event> events = apply(state, testContent(), play(0, 0, 1));
		EXPECT_TRUE((eventsOf<event::DriverDamaged>(events) == std::vector{event::DriverDamaged{.driver = kSecond, .hitpoints = 7}}));
	}

	TEST(CardPlay, BonusesReadWhereTheVehiclesStand) {
		// The Interceptor at inside center against raiders at inside center, behind, and ahead.
		BattleStart	 start = fight({seat("interceptor")}, {raider("scav_bike"), raider("rust_buggy"), raider("spike_buggy")});
		BattleState& state = start.state;
		const int	 spikeBuggy = 3;
		giveHand(state, kFirst, {"tail_gunner", "tail_gunner", "point_man", "point_man"});
		state.driver(kFirst).adrenaline = 10;
		const auto damageOf = [&](action::PlayCard card) {
			const std::vector<event::VehicleDamaged> hits = eventsOf<event::VehicleDamaged>(apply(state, testContent(), card));
			return hits.size() == 1 ? hits[0].damage : -1;
		};

		EXPECT_EQ(damageOf(play(0, 0, spikeBuggy)), 3) << "Tail Gunner on a raider a row ahead";
		EXPECT_EQ(damageOf(play(0, 0, 1)), 1) << "Tail Gunner on one in the same row";
		EXPECT_EQ(damageOf(play(0, 0, spikeBuggy)), 1) << "Point Man from the center row";
		state.vehicle(kFirstVehicle).slot.row = Row::Ahead;
		EXPECT_EQ(damageOf(play(0, 0, spikeBuggy)), 4) << "Point Man from the ahead row";
	}

	TEST(CardPlay, CoordinatedAttackHitsAgainOnceThePartnerHasAttacked) {
		// The Interceptor at inside center and the Road Warrior behind it, the Rust Buggy across from the Road Warrior.
		BattleStart	 start = fight({seat("interceptor"), seat("road_warrior")}, {raider("scav_bike"), raider("rust_buggy")});
		BattleState& state = start.state;
		const int	 rustBuggy = 3;
		giveHand(state, kFirst, {"coordinated_attack", "coordinated_attack"});
		giveHand(state, kSecond, {"point_blank"});
		state.driver(kFirst).adrenaline = 6;

		EXPECT_EQ(eventsOf<event::VehicleDamaged>(apply(state, testContent(), play(0, 0, rustBuggy))).size(), 1U);
		(void)apply(state, testContent(), play(1, 0, rustBuggy));
		const std::vector<event::VehicleDamaged> hits = eventsOf<event::VehicleDamaged>(apply(state, testContent(), play(0, 0, rustBuggy)));
		ASSERT_EQ(hits.size(), 2U);
		EXPECT_EQ(hits[0].damage, 3);
		EXPECT_EQ(hits[1].damage, 3);
	}

	TEST(CardPlay, RepairOverflowsIntoArmorAndMedicalKitHealsSomeoneAboard) {
		BattleStart	 start = fight({seat("road_warrior"), seat("interceptor")}, {raider("scav_bike")});
		BattleState& state = start.state;
		giveHand(state, kFirst, {"repair_kit", "medical_kit", "medical_kit"});
		state.driver(kFirst).adrenaline = 5;
		state.vehicle(kFirstVehicle).structure = 75;
		state.driver(kFirst).hitpoints = 34;

		std::vector<Event> events = apply(state, testContent(), play(0, 0));
		EXPECT_TRUE(
			(eventsOf<event::Repaired>(events) == std::vector{event::Repaired{.vehicle = kFirstVehicle, .structure = 5, .armor = 3}})
		);
		EXPECT_EQ(state.vehicle(kFirstVehicle).armor, 13);

		const action::PlayCard	  onSelf{.driver = kFirst, .handIndex = 0, .target = kFirstVehicle, .occupant = kFirst};
		const std::vector<Action> actions = legalActions(state, testContent());
		EXPECT_TRUE(offers(actions, onSelf));
		EXPECT_FALSE(offers(actions, action::PlayCard{.driver = kFirst, .handIndex = 0, .target = kSecondVehicle, .occupant = kSecond}));
		EXPECT_FALSE(offers(actions, action::PlayCard{.driver = kFirst, .handIndex = 0, .target = kFirstVehicle, .occupant = kSecond}));
		EXPECT_FALSE(offers(actions, play(0, 0, 0)));

		events = apply(state, testContent(), onSelf);
		EXPECT_TRUE((eventsOf<event::DriverHealed>(events) == std::vector{event::DriverHealed{.driver = kFirst, .hitpoints = 4}}));
		state.driver(kFirst).adrenaline = 2;
		events = apply(state, testContent(), onSelf);
		EXPECT_TRUE((eventsOf<event::DriverHealed>(events) == std::vector{event::DriverHealed{.driver = kFirst, .hitpoints = 2}}));
		EXPECT_EQ(state.driver(kFirst).hitpoints, 40);
	}

	TEST(CardPlay, AWrecksDriverRidesOnWithTheirPartnerAndCantAttack) {
		BattleStart		  start = fight({seat("road_warrior"), seat("interceptor")}, {raider("rust_buggy"), raider("scav_bike")});
		BattleState&	  state = start.state;
		const DriverIndex rustBuggy{2};
		state.vehicle(kFirstVehicle).structure = 1;
		state.vehicle(kFirstVehicle).armor = 0;

		(void)apply(state, testContent(), action::EndTurn{});
		ASSERT_EQ(state.actingRaider, rustBuggy);
		giveHand(state, rustBuggy, {"point_blank"});
		std::vector<Event>		 events = apply(state, testContent(), play(2, 0, 0));
		const std::vector<Event> wrecked{
			event::VehicleDamaged{.vehicle = kFirstVehicle, .damage = 3, .shield = 0, .armor = 0, .structure = 1},
			event::DriverDamaged{.driver = kFirst, .hitpoints = 2},
			event::VehicleWrecked{.vehicle = kFirstVehicle},
			event::JumpedAboard{.driver = kFirst, .vehicle = kSecondVehicle},
		};
		EXPECT_TRUE(std::ranges::search(events, wrecked).begin() != events.end());
		EXPECT_EQ(state.vehicle(kSecondVehicle).passenger, kFirst);
		EXPECT_TRUE(state.vehicle(kFirstVehicle).onRoad);

		(void)apply(state, testContent(), action::EndTurn{});
		events = apply(state, testContent(), action::EndTurn{});
		EXPECT_TRUE((eventsOf<event::LeftRoad>(events) == std::vector{event::LeftRoad{.vehicle = kFirstVehicle}}));
		EXPECT_EQ(state.phase, Phase::PlayerTurn);
		EXPECT_EQ(state.driver(kFirst).hand.size(), 5U);

		giveHand(state, kFirst, {"point_blank", "armor_plating"});
		ASSERT_TRUE(cardBlocker(state, testContent(), kFirst, 0));
		EXPECT_EQ(*cardBlocker(state, testContent(), kFirst, 0), "a passenger can't play attack cards");
		events = apply(state, testContent(), play(0, 1));
		EXPECT_TRUE((eventsOf<event::ArmorGained>(events) == std::vector{event::ArmorGained{.vehicle = kSecondVehicle, .armor = 8}}));
	}

	TEST(CardPlay, ADriverDownLeavesTheirVehicleAnEscortAndTheLastOneDownLoses) {
		BattleStart		  start = fight({seat("road_warrior"), seat("interceptor")}, {raider("rust_buggy")});
		BattleState&	  state = start.state;
		const DriverIndex rustBuggy{2};
		state.driver(kFirst).hitpoints = 1;
		state.vehicle(kFirstVehicle).armor = 0;
		state.driver(kSecond).hitpoints = 1;

		(void)apply(state, testContent(), action::EndTurn{});
		giveHand(state, rustBuggy, {"test_slam", "test_slam", "test_slam"});
		std::vector<Event> events = apply(state, testContent(), play(2, 0, 1));
		EXPECT_EQ(eventsOf<event::DriverDown>(events).size(), 1U);
		EXPECT_EQ(eventsOf<event::CarriesOnAsEscort>(events).size(), 1U);
		EXPECT_EQ(state.vehicle(kSecondVehicle).crew, kUnmannedCrew);
		EXPECT_TRUE(vehicleInFight(state, kSecondVehicle));
		EXPECT_EQ(state.phase, Phase::EnemyTurn);

		events = apply(state, testContent(), play(2, 0, 1));
		EXPECT_TRUE(eventsOf<event::HitChecked>(events).empty());
		EXPECT_TRUE(
			(eventsOf<event::VehicleDamaged>(events) == std::vector{event::VehicleDamaged{
															.vehicle = kSecondVehicle,
															.damage = 10,
															.shield = 0,
															.armor = 0,
															.structure = 10,
														}})
		);
		EXPECT_TRUE(eventsOf<event::DriverDamaged>(events).empty());

		events = apply(state, testContent(), play(2, 0, 0));
		ASSERT_FALSE(events.empty());
		EXPECT_TRUE((events.back() == Event{event::FightEnded{.outcome = Outcome::Lost}}));
		EXPECT_EQ(state.outcome, Outcome::Lost);
	}

} // namespace
