#pragma once

#include <rules/battle/Policy.h>

#include <map>
#include <string>

namespace ai {

	// Tries to win while sparing the vehicles it fights, going for their drivers, Headshot first, so the vehicles are
	// left to salvage (AI System Technical Design 2.2). It scores each play on a copy of the board: drivers' HP and a
	// driver taken out count up, structure and a wreck count against, and a play that comes out at nothing or less
	// waits for a better one.
	class Salvage final : public rules::Policy {
	  public:
		struct Weights {
			// Each point of HP the other side's drivers lose, scaled up the more hurt they already are.
			double driver{20};
			// Each point of structure the other side's vehicles lose, which comes off the salvage.
			double structure{-3};
			// Each point of armor they lose.
			double armor{2};
			// Each driver taken out.
			double kill{500};
			// Each vehicle wrecked.
			double wreck{-300};
			double flank{300};
			double heal{50};
			double defense{2};
			double debuff{20};
			double draw{5};
		};

		[[nodiscard]] static Weights weightsFrom(const std::map<std::string, double>& named);

		explicit Salvage(Weights weights);

		[[nodiscard]] rules::Action choose(
			const rules::BattleState&	   board,
			const rules::Content&		   content,
			std::span<const rules::Action> actions,
			foundation::Rng&			   rng
		) const override;

		[[nodiscard]] double score(const rules::BattleState& board, const rules::Content& content, const rules::Action& action) const;

	  private:
		Weights weights;
	};

} // namespace ai
