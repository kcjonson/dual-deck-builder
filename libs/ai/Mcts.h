#pragma once

#include <rules/battle/Policy.h>

#include <map>
#include <string>

namespace ai {

	// Monte Carlo tree search (AI System Technical Design 2.2): each iteration picks a play by UCB1, applies it to a
	// copy of the board, and plays the copy out with even random picks to the start of the next player turn, or the
	// fight's end, scoring where it lands by what each side has left in the fight (call 390). It keeps the play whose
	// playouts score best. Every draw comes from the stream it's handed, and the math is adds, multiplies, divides,
	// and square roots, so a seed plays the same on every platform.
	class Mcts final : public rules::Policy {
	  public:
		struct Weights {
			// Playouts a decision runs, a whole number from 1 to 10000.
			double iterations{48};
			// UCB1's exploration constant, 0 or more.
			double exploration{1};
		};

		// Weights by name, failing on a name it doesn't take or a value out of range.
		[[nodiscard]] static Weights weightsFrom(const std::map<std::string, double>& named);

		explicit Mcts(Weights weights);

		[[nodiscard]] rules::Action choose(
			const rules::BattleState&	   board,
			const rules::Content&		   content,
			std::span<const rules::Action> actions,
			foundation::Rng&			   rng
		) const override;

		// What `side` has left on `board`, its vehicles' armor and structure and its drivers' HP in the fight, the
		// queue counted for the raiders, less the other side's, and the fight's end on top.
		[[nodiscard]] static double valueOf(const rules::BattleState& board, rules::Side side);

	  private:
		int	   iterations;
		double exploration;
	};

} // namespace ai
