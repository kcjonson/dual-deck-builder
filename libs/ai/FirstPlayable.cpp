#include "FirstPlayable.h"

#include "Preferences.h"

namespace ai {

	rules::Action FirstPlayable::choose(
		const rules::BattleState&	   board,
		const rules::Content&		   content,
		std::span<const rules::Action> actions,
		foundation::Rng&
	) const {
		// legalActions offers plays in hand and target order, the end of the turn last.
		return preferredPlays(board, content, actions).front();
	}

} // namespace ai
