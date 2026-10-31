#pragma once

#include <rules/battle/BattleState.h>
#include <rules/battle/Policy.h>
#include <rules/packs/Pack.h>

namespace ai {

	// Plays a fight on to its end with nobody at the controls: the raiders plan each turn through `raiders`, and
	// each of the player's seats plays its part of the player's turn through `players`, in seat order, choosing
	// among its own plays and the end of its part until it ends it, before the turn ends (call 391). A seat's picks
	// draw from the fight's own "stand-in:<seat>" stream, one event a seat a turn, so a fight replays from its seed.
	// Throws std::logic_error for a fight still going after `mostActions`, since no fight should stall.
	void playFight(
		rules::BattleState&		state,
		const rules::Content&	content,
		const rules::PolicyFor& players,
		const rules::PolicyFor& raiders,
		int						mostActions = 5000
	);

} // namespace ai
