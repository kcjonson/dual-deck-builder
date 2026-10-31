#pragma once

#include <rules/battle/BattleState.h>
#include <rules/battle/Policy.h>
#include <rules/core/Ids.h>
#include <rules/packs/Pack.h>

#include <map>
#include <memory>

namespace ai {

	// The policy a behavior names, with its weights and difficulty, for a seat on `seat`'s side: aggressive_flanker,
	// intent_aware (the player's seats only), ramming, salvage, mcts, random, or first_playable. Throws
	// std::invalid_argument for a policy, weight, or difficulty the AI doesn't have, or a script, since the Lua host
	// isn't built yet. The balance sim's stand-ins come from here too.
	[[nodiscard]] std::unique_ptr<rules::Policy> makePolicy(const rules::Behavior& behavior, rules::Side seat);

	// Every opponent's behavior bound to the policy it names, read once from the loaded packs (rules-ai-and-packs.md).
	// Anything makePolicy refuses throws a ContentError naming the opponent.
	class OpponentPolicies {
	  public:
		explicit OpponentPolicies(const rules::Content& content);

		[[nodiscard]] const rules::Policy& forOpponent(const rules::OpponentId& opponent) const;

		// The policy each raider plans with, by its opponent, for planEnemyTurn. It reads the seat off the board it's
		// asked about, so a raider that arrives in a later wave plans too. It refers to this, which has to outlive it.
		[[nodiscard]] rules::PolicyFor forRaiders() const;

	  private:
		std::map<rules::OpponentId, std::unique_ptr<rules::Policy>> policies;
	};

} // namespace ai
