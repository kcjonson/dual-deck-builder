#pragma once

#include <rules/battle/BattleAction.h>
#include <rules/battle/BattleEvent.h>
#include <rules/battle/BattleState.h>
#include <rules/packs/Pack.h>

#include <optional>
#include <vector>

namespace ai {

	// One target's loss to a play, with how hurt it already was: 1 untouched, up to 2 nearly out.
	struct Loss {
		int	   armor{0};
		int	   structure{0};
		int	   hitpoints{0};
		double hurt{1};
	};

	// What one play did, from the playing side's view, read off a copy of the board it's applied to and the events
	// it returns: what the scoring policies count, so none of them reads a card's effects.
	struct Outcome {
		rules::BattleState		  after;
		std::vector<rules::Event> events;
		rules::Side				  side{rules::Side::Player};
		// The vehicle the card is played from.
		rules::VehicleIndex actor;

		// The other side's vehicles and drivers, as each lost something.
		std::vector<Loss> vehicles;
		std::vector<Loss> drivers;
		int				  vehiclesOut{0};
		int				  wrecks{0};
		int				  driversDown{0};
		// Armor, structure, and HP the other side lost to ramming hits.
		int rammed{0};

		// Its own side's gains.
		int shield{0};
		int armor{0};
		// Each repair's structure and armor, and whether it found the vehicle under 30% structure.
		struct Repair {
			int	 structure{0};
			int	 armor{0};
			bool critical{false};
		};
		std::vector<Repair> repairs;
		int					cardsDrawn{0};
		int					adrenaline{0};
		int					statusesOnThem{0};
		int					speedGained{0};

		// The actor's flank: taken, given up while it would have held, or newly within reach.
		bool tookFlank{false};
		bool gaveUpHeldFlank{false};
		bool opensFlank{false};
		// Range from the actor to the nearest of the other side's driven vehicles in the fight, before and after.
		std::optional<int> rangeBefore;
		std::optional<int> rangeAfter;

		int	 cost{0};
		bool spentAllAdrenaline{false};
	};

	// Plays `play` on a copy of `board` and reads what it did.
	[[nodiscard]] Outcome outcomeOf(const rules::BattleState& board, const rules::Content& content, const rules::action::PlayCard& play);

	// What ending the turn scores in every scoring policy, and a play that does nothing scores under it.
	inline constexpr double kEndTurn = -1000;

	// The highest scoring of `offered`, the first of a tie, so a policy keeps legalActions' order between equals.
	template <typename Score>
	[[nodiscard]] rules::Action bestScored(const std::vector<rules::Action>& offered, Score&& score) {
		size_t best = 0;
		double bestScore = score(offered.front());
		for (size_t index = 1; index < offered.size(); ++index) {
			const double candidate = score(offered[index]);
			if (candidate > bestScore) {
				best = index;
				bestScore = candidate;
			}
		}
		return offered[best];
	}

} // namespace ai
