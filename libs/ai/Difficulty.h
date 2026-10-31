#pragma once

#include <rules/battle/Policy.h>

#include <memory>

namespace ai {

	// Easy difficulty over any policy (AI System Technical Design 5.1, call 388): three times in ten it picks evenly
	// among the plays on offer instead of the policy's best, drawing from the same stream.
	class Easy final : public rules::Policy {
	  public:
		explicit Easy(std::unique_ptr<rules::Policy> chooser);

		[[nodiscard]] rules::Action choose(
			const rules::BattleState&	   board,
			const rules::Content&		   content,
			std::span<const rules::Action> actions,
			foundation::Rng&			   rng
		) const override;

	  private:
		std::unique_ptr<rules::Policy> best;
	};

} // namespace ai
