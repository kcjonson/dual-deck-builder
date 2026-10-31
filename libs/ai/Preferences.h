#pragma once

#include <rules/battle/BattleAction.h>
#include <rules/battle/BattleState.h>
#include <rules/packs/Pack.h>

#include <span>
#include <vector>

namespace ai {

	// The acting raider's offers with its target preference applied (Combat Rules, Enemy intents), which belongs
	// to the raider whatever policy plans for it: for each card, only its plays at a preferred target when it has
	// any, a killer's being driven vehicles and a looter's haulers. A play counts as aimed at its target when it
	// lands something there, so a flank, whose target is only the vehicle it outruns, never does. The player's side
	// has no preference, so its offers come back whole.
	[[nodiscard]] std::vector<rules::Action>
	preferredPlays(const rules::BattleState& board, const rules::Content& content, std::span<const rules::Action> actions);

} // namespace ai
