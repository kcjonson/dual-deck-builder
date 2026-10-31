#include <ai/AggressiveFlanker.h>
#include <ai/OpponentPolicies.h>

#include <rules/battle/BattleTesting.h>
#include <rules/battle/Encounters.h>
#include <rules/core/ContentError.h>

#include <gtest/gtest.h>

namespace {

	using namespace rules;
	using namespace rules::fights;

	std::string loadError(const Content& content) {
		try {
			const ai::OpponentPolicies policies(content);
		} catch (const ContentError& error) {
			return error.what();
		}
		ADD_FAILURE() << "expected a ContentError";
		return "";
	}

	TEST(OpponentPolicies, BindsEveryBaseOpponentAndRefusesABehaviorItDoesntKnow) {
		const ai::OpponentPolicies policies(testContent());
		EXPECT_NE(dynamic_cast<const ai::AggressiveFlanker*>(&policies.forOpponent(OpponentId{"scav_bike"})), nullptr);

		Content	  content = testContent();
		Behavior& behavior = content.opponents.at(OpponentId{"scav_bike"}).behavior;
		behavior.policy = "turtle";
		EXPECT_NE(loadError(content).find("opponent scav_bike's behavior names policy \"turtle\""), std::string::npos);

		behavior.policy = "aggressive_flanker";
		behavior.weights = {{"bravery", 1.0}};
		EXPECT_NE(loadError(content).find("weight \"bravery\" isn't one the aggressive flanker takes"), std::string::npos);

		behavior.weights.clear();
		behavior.policy.clear();
		behavior.script = "behavior.lua";
		EXPECT_NE(loadError(content).find("the Lua host"), std::string::npos);
	}

	TEST(OpponentPolicies, ARaiderArrivingInALaterWavePlansWithItsOwnOpponentsPolicy) {
		// The scav pack's second wave is due once one raider is left: two bikes go down, and it pulls in a turn later.
		const ai::OpponentPolicies policies(testContent());
		BattleSetup				   setup{.players = {seat("road_warrior"), seat("interceptor")}, .seed = 3};
		fieldEncounter(setup, testContent(), EncounterId{"scav_pack"}, 0);
		BattleState state = startBattle(setup, testContent()).state;
		(void)planEnemyTurn(state, testContent(), policies.forRaiders());
		for (const int bike : {2, 3}) {
			state.driver(DriverIndex{bike}).hitpoints = 1;
			giveHand(state, DriverIndex{0}, {"test_slam"});
			(void)apply(state, testContent(), play(0, 0, bike));
		}
		std::vector<Event> plans;
		for (int turn = 0; turn < 2; ++turn) {
			(void)apply(state, testContent(), action::EndTurn{});
			ASSERT_EQ(state.phase, Phase::Planning);
			plans = planEnemyTurn(state, testContent(), policies.forRaiders());
		}
		ASSERT_EQ(state.drivers.size(), 7U) << "both of the second wave pulled in";
		const std::vector<DriverIndex> planned = planners(plans);
		EXPECT_NE(std::ranges::find(planned, DriverIndex{5}), planned.end());
		EXPECT_NE(std::ranges::find(planned, DriverIndex{6}), planned.end());
	}

} // namespace
