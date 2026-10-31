#include "RandomPlay.h"

#include "Preferences.h"

namespace ai {

	rules::Action RandomPlay::choose(
		const rules::BattleState&	   board,
		const rules::Content&		   content,
		std::span<const rules::Action> actions,
		foundation::Rng&			   rng
	) const {
		const std::vector<rules::Action> offered = preferredPlays(board, content, actions);
		return rng.pick(offered);
	}

} // namespace ai
