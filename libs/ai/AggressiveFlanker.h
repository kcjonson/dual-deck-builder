#pragma once

#include <rules/battle/Policy.h>

#include <map>
#include <string>

namespace ai {

	// The base pack's raiders' policy (AI System Technical Design 2.2): takes the flank for its damage bonus and
	// favours its highest-damage plays. It scores each play by playing it out on a copy of the board, so what it
	// counts is what the rules do. It never reads intents, so it never gives up a flank it would hold, and a play
	// that does nothing scores under ending the turn.
	class AggressiveFlanker final : public rules::Policy {
	  public:
		// What a point of each counts for. An opponent's behavior can set any of them by name.
		struct Weights {
			// Armor, structure, or HP the other side loses, scaled up the more hurt the target already is.
			double damage{10};
			// Each vehicle or driver it takes out of the fight.
			double kill{500};
			// Pulling onto the shoulder, and two thirds of it for a boost that opens a flank.
			double flank{600};
			// Each point of structure repaired below 30%.
			double heal{50};
			// Shield, armor, and structure it gains otherwise.
			double defense{2};
			// Each status it puts on the other side.
			double debuff{20};
			// Each card drawn that stays in hand, and each point of adrenaline gained.
			double draw{5};
		};

		// Weights by name, failing on a name it doesn't take.
		[[nodiscard]] static Weights weightsFrom(const std::map<std::string, double>& named);

		explicit AggressiveFlanker(Weights weights);

		[[nodiscard]] rules::Action choose(
			const rules::BattleState&	   board,
			const rules::Content&		   content,
			std::span<const rules::Action> actions,
			foundation::Rng&			   rng
		) const override;

		// What `action` scores on `board`, the end of the turn included.
		[[nodiscard]] double score(const rules::BattleState& board, const rules::Content& content, const rules::Action& action) const;

	  private:
		Weights weights;
	};

} // namespace ai
