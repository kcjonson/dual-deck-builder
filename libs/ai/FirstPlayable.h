#pragma once

#include <rules/battle/Policy.h>

namespace ai {

	// The first affordable card in hand order at its first legal target (AI System Technical Design 2.2), after the
	// raider's target preference, until nothing's left to play.
	class FirstPlayable final : public rules::Policy {
	  public:
		[[nodiscard]] rules::Action choose(
			const rules::BattleState&	   board,
			const rules::Content&		   content,
			std::span<const rules::Action> actions,
			foundation::Rng&			   rng
		) const override;
	};

} // namespace ai
