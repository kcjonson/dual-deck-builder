#pragma once

#include <rules/battle/Policy.h>

#include <map>
#include <string>

namespace ai {

	// Builds speed and armor and closes in for ramming hits (AI System Technical Design 2.2). Like the aggressive
	// flanker it scores each play by playing it out on a copy of the board, with rams, speed, armor, and pulling into
	// ram range of a driven vehicle counted up, and a flank only for the place it puts it.
	class Ramming final : public rules::Policy {
	  public:
		struct Weights {
			// Armor, structure, or HP the other side loses, scaled up the more hurt the target already is.
			double damage{10};
			// Each point of that a ramming hit does, on top.
			double ram{30};
			double kill{500};
			// Each point of speed its own vehicle gains, which a ram's formula reads.
			double speed{80};
			// Each point of armor it gains.
			double armor{20};
			// Moving into ram range of a driven vehicle it wasn't in range of.
			double close{300};
			double flank{150};
			// Each point of structure repaired below 30%.
			double heal{50};
			// Shield, and structure repaired otherwise.
			double defense{2};
			double debuff{20};
			double draw{5};
		};

		[[nodiscard]] static Weights weightsFrom(const std::map<std::string, double>& named);

		explicit Ramming(Weights weights);

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
