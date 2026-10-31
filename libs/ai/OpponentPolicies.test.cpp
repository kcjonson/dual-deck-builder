#include <ai/AggressiveFlanker.h>
#include <ai/OpponentPolicies.h>

#include <rules/battle/BattleTesting.h>
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

} // namespace
