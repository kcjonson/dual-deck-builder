#include "Difficulty.h"

#include "Preferences.h"

#include <cassert>
#include <utility>

namespace ai {

	Easy::Easy(std::unique_ptr<rules::Policy> chooser)
		: best(std::move(chooser)) {
		assert(best && "Easy: a difficulty is over a policy");
	}

	rules::Action Easy::choose(
		const rules::BattleState&	   board,
		const rules::Content&		   content,
		std::span<const rules::Action> actions,
		foundation::Rng&			   rng
	) const {
		if (rng.nextInt(1, 10) <= 3) {
			const std::vector<rules::Action> offered = preferredPlays(board, content, actions);
			return rng.pick(offered);
		}
		return best->choose(board, content, actions, rng);
	}

} // namespace ai
