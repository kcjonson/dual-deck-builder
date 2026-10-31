#include <ai/OpponentPolicies.h>

#include <rules/battle/BattleTesting.h>

#include <gtest/gtest.h>

namespace {

	using namespace rules;
	using namespace rules::fights;

	const DriverIndex  kFirstRaider{1};
	const VehicleIndex kFirstVehicle{0};

	const ai::OpponentPolicies& basePolicies() {
		static const ai::OpponentPolicies policies(testContent());
		return policies;
	}

	std::vector<CardId> plannedCards(const BattleState& state, DriverIndex raider) {
		std::vector<CardId> cards;
		for (const PlannedStep& step : state.driver(raider).plan) {
			cards.push_back(step.card.card);
		}
		return cards;
	}

	void planWithTheirPolicies(BattleState& state) {
		state.phase = Phase::Planning;
		(void)planEnemyTurn(state, testContent(), basePolicies().forFight(state));
	}

	TEST(AggressiveFlanker, FlanksFirstThenTakesTheShotItHasFromTheShoulder) {
		// The Scav Bike's speed 6 against the Road Warrior's 2, across from each other.
		BattleStart	 start = fight({seat("road_warrior")}, {raider("scav_bike")});
		BattleState& state = start.state;
		giveHand(state, kFirstRaider, {"point_blank", "flank", "far_shoot"});
		state.driver(kFirstRaider).maxAdrenaline = 5;
		state.driver(kFirstRaider).adrenaline = 5;
		BattleState copy = state;

		planWithTheirPolicies(state);
		EXPECT_EQ(plannedCards(state, kFirstRaider), (std::vector{CardId{"flank"}, CardId{"far_shoot"}}))
			<< "Point Blank can't reach the Rig from the shoulder";
		planWithTheirPolicies(copy);
		EXPECT_TRUE(copy == state) << "a copy plans the same";
	}

	TEST(AggressiveFlanker, NeverSwervesForNothingOrGivesUpAFlankItHolds) {
		BattleStart	 start = fight({seat("road_warrior")}, {raider("scav_bike")});
		BattleState& state = start.state;
		giveHand(state, kFirstRaider, {"lane_change"});
		planWithTheirPolicies(state);
		EXPECT_TRUE(state.driver(kFirstRaider).plan.empty());

		// On the Rig's shoulder, faster than it, with its slot held behind it: Peel Off's draw isn't worth the flank.
		BattleVehicle& bike = state.vehicle(VehicleIndex{1});
		const RoadSlot home = bike.slot;
		bike.slot = RoadSlot{.lane = RoadLane::PlayerShoulder, .row = Row::Center};
		bike.flank = FlankState{.reservedSlot = home, .outran = kFirstVehicle};
		giveHand(state, kFirstRaider, {"peel_off"});
		planWithTheirPolicies(state);
		EXPECT_TRUE(state.driver(kFirstRaider).plan.empty());
	}

	TEST(AggressiveFlanker, ALooterShootsAHaulerOverTheDriverBesideIt) {
		// The Rig and the Fuel Hauler side by side, the Rust Buggy across: its Far Shoot reaches both, armor for armor.
		BattleStart	 start = convoy({seat("road_warrior")}, {"fuel_hauler"}, {raider("rust_buggy")});
		BattleState& state = start.state;
		giveHand(state, kFirstRaider, {"far_shoot"});
		planWithTheirPolicies(state);
		ASSERT_EQ(state.driver(kFirstRaider).plan.size(), 1U);
		EXPECT_EQ(state.driver(kFirstRaider).plan[0].target, VehicleIndex{1});
	}

	TEST(AggressiveFlanker, AKillerShootsADrivenVehicleOverAnEscortItCouldFinish) {
		// The Rig across from the Spike Buggy, and behind it the Interceptor's bike carrying on as an escort, nearly
		// wrecked.
		BattleStart		  start = fight({seat("road_warrior"), seat("interceptor")}, {raider("spike_buggy")});
		BattleState&	  state = start.state;
		const DriverIndex spikeBuggy{2};
		BattleVehicle&	  escort = state.vehicle(VehicleIndex{1});
		state.driver(DriverIndex{1}).hitpoints = 0;
		escort.driver.reset();
		escort.crew = kUnmannedCrew;
		escort.structure = 10;
		giveHand(state, spikeBuggy, {"precision_shot"});

		planWithTheirPolicies(state);
		ASSERT_EQ(state.driver(spikeBuggy).plan.size(), 1U);
		EXPECT_EQ(state.driver(spikeBuggy).plan[0].target, kFirstVehicle);
	}

} // namespace
