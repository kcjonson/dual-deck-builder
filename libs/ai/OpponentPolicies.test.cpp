#include <ai/AggressiveFlanker.h>
#include <ai/Difficulty.h>
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

	Behavior behaviorOf(std::string policy, std::map<std::string, double> weights = {}, std::string difficulty = "") {
		return Behavior{.policy = std::move(policy), .weights = std::move(weights), .script = "", .difficulty = std::move(difficulty)};
	}

	TEST(OpponentPolicies, BindsEveryNamedPolicyAndRefusesWhatItDoesntKnow) {
		const ai::OpponentPolicies policies(testContent());
		EXPECT_NE(dynamic_cast<const ai::AggressiveFlanker*>(&policies.forOpponent(OpponentId{"scav_bike"})), nullptr);
		for (const char* policy : {"aggressive_flanker", "ramming", "salvage", "mcts", "random", "first_playable"}) {
			EXPECT_NO_THROW((void)ai::makePolicy(behaviorOf(policy), Side::Raiders)) << policy;
		}
		EXPECT_NO_THROW((void)ai::makePolicy(behaviorOf("intent_aware", {{"harm", 40}}), Side::Player));
		EXPECT_NE(dynamic_cast<const ai::Easy*>(ai::makePolicy(behaviorOf("ramming", {}, "easy"), Side::Raiders).get()), nullptr);
		EXPECT_THROW((void)ai::makePolicy(behaviorOf("mcts", {{"iterations", 2.5}}), Side::Raiders), std::invalid_argument);
		EXPECT_THROW((void)ai::makePolicy(behaviorOf("salvage", {{"ram", 1}}), Side::Raiders), std::invalid_argument);
		EXPECT_THROW((void)ai::makePolicy(behaviorOf("random", {{"damage", 1}}), Side::Raiders), std::invalid_argument);

		Content	   content = testContent();
		Behavior&  behavior = content.opponents.at(OpponentId{"scav_bike"}).behavior;
		const auto refused = [&](Behavior with, std::string_view part) {
			behavior = std::move(with);
			const std::string error = loadError(content);
			EXPECT_NE(error.find(part), std::string::npos) << error;
		};
		refused(behaviorOf("turtle"), "opponent scav_bike's behavior: policy \"turtle\" isn't one the AI has");
		refused(behaviorOf("aggressive_flanker", {{"bravery", 1.0}}), "weight \"bravery\" isn't one the aggressive flanker takes");
		refused(behaviorOf("intent_aware"), "only the player's seats play with it");
		refused(behaviorOf("aggressive_flanker", {}, "nightmare"), "perfect play, which isn't built");
		refused(behaviorOf("aggressive_flanker", {}, "brutal"), "difficulty \"brutal\" isn't one the AI has");
		refused(Behavior{.policy = "", .weights = {}, .script = "behavior.lua", .difficulty = ""}, "the Lua host");
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
