#pragma once

#include "AggressiveFlanker.h"

#include <rules/battle/Policy.h>

#include <map>
#include <string>

namespace ai {

	// The harm the coming enemy turn does the player's side if the player ends the turn now, read off that turn played
	// out on a copy, the projection intentsOf and arrivalsOf read too: structure and occupant HP lost, as each hit
	// splits, and 20 more for each wreck or driver down (call 241), with what each raider's steps do and how many
	// raiders pull in behind them. Nothing outside the player's turn.
	struct Threat {
		int				   harm{0};
		std::map<int, int> byRaider;
		int				   arrivals{0};
	};

	[[nodiscard]] Threat threatOf(const rules::BattleState& board, const rules::Content& content);

	// The player stand-ins' ceiling (intent-aware-stand-in.md, AI System Technical Design 2.2): before each card it
	// plays the play that most cuts the harm the raiders' committed plans will do next enemy turn, one step and no
	// search, each play judged on a copy of the board with the enemy turn played out behind it. Hidden elite plans
	// count in full (call 240). Non-lethal damage counts for half a turn of the hurt raider's harm per share of its
	// toughness taken (call 242), each raider a play brings in early counts as some harm (call 389), and the rest is
	// scored as the aggressive flanker scores it (call 243). A play that comes out at nothing or less waits.
	class IntentAware final : public rules::Policy {
	  public:
		struct Weights {
			// Each point of harm a play keeps off.
			double harm{60};
			// Turns of a hurt raider's harm its non-lethal damage counts for, per share of its toughness.
			double progress{0.5};
			// Harm each raider pulled in a turn early counts for.
			double arrival{5};
		};

		[[nodiscard]] static Weights weightsFrom(const std::map<std::string, double>& named);

		explicit IntentAware(Weights weights);

		[[nodiscard]] rules::Action choose(
			const rules::BattleState&	   board,
			const rules::Content&		   content,
			std::span<const rules::Action> actions,
			foundation::Rng&			   rng
		) const override;

		// What `action` scores on `board` against `now`, the threat as it stands.
		[[nodiscard]] double
		score(const rules::BattleState& board, const rules::Content& content, const Threat& now, const rules::Action& action) const;

	  private:
		Weights			  weights;
		AggressiveFlanker floor{AggressiveFlanker::Weights{}};
	};

} // namespace ai
