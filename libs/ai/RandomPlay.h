#pragma once

#include <rules/battle/Policy.h>

namespace ai {

	// Picks evenly among every play on offer, ending the turn included, after a raider's target preference, drawing
	// from the stream it's handed (AI System Technical Design 2.2).
	class RandomPlay final : public rules::Policy {
	  public:
		[[nodiscard]] rules::Action choose(
			const rules::BattleState&	   board,
			const rules::Content&		   content,
			std::span<const rules::Action> actions,
			foundation::Rng&			   rng
		) const override;
	};

} // namespace ai
