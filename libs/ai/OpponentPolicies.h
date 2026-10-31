#pragma once

#include <rules/battle/BattleState.h>
#include <rules/battle/Policy.h>
#include <rules/core/Ids.h>
#include <rules/packs/Pack.h>

#include <map>
#include <memory>

namespace ai {

	// Every opponent's behavior bound to the policy it names, with its weights, read once from the loaded packs
	// (rules-ai-and-packs.md). A policy the AI doesn't have, a weight it doesn't take, or a script (the Lua host
	// isn't built yet) throws a ContentError naming the opponent.
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
