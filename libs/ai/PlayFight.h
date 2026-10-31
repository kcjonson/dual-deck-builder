#pragma once

#include <rules/battle/BattleAction.h>
#include <rules/battle/BattleEvent.h>
#include <rules/battle/BattleState.h>
#include <rules/battle/Policy.h>
#include <rules/packs/Pack.h>

#include <functional>
#include <optional>
#include <vector>

namespace ai {

	struct PlayFightOptions {
		// A fight still on once this many player turns have been played stops as the next one opens, unfinished, which
		// the balance sim reads as stalled; none plays it to its end.
		std::optional<int> mostTurns;
		// Called after each action the fight applies, with the board after it and the events it returned, for whoever
		// measures the fight. The raiders' planning isn't an action, and onPlanned reports it.
		std::function<void(const rules::BattleState&, const rules::Action&, const std::vector<rules::Event>&)> onApplied;
		// Called after the raiders plan each enemy turn, with the board after it and the plans committed.
		std::function<void(const rules::BattleState&, const std::vector<rules::Event>&)> onPlanned;
		// No fight should stall, so one still going after this many actions throws.
		int mostActions{5000};
	};

	// Plays a fight on to its end with nobody at the controls: the raiders plan each turn through `raiders`, and
	// each of the player's seats plays its part of the player's turn through `players`, in seat order, choosing
	// among its own plays and the end of its part until it ends it, before the turn ends (call 391). A seat's picks
	// draw from the fight's own "stand-in:<seat>" stream, one event a seat a turn, so a fight replays from its seed.
	// Throws std::logic_error for a fight still going after `options.mostActions`.
	void playFight(
		rules::BattleState&		state,
		const rules::Content&	content,
		const rules::PolicyFor& players,
		const rules::PolicyFor& raiders,
		const PlayFightOptions& options = {}
	);

} // namespace ai
