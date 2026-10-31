#include "Salvage.h"

#include "Outcome.h"
#include "Preferences.h"
#include "Weights.h"

namespace ai {

	namespace {

		constexpr WeightNames<Salvage::Weights, 10> kWeightNames{{
			{"driver", &Salvage::Weights::driver},
			{"structure", &Salvage::Weights::structure},
			{"armor", &Salvage::Weights::armor},
			{"kill", &Salvage::Weights::kill},
			{"wreck", &Salvage::Weights::wreck},
			{"flank", &Salvage::Weights::flank},
			{"heal", &Salvage::Weights::heal},
			{"defense", &Salvage::Weights::defense},
			{"debuff", &Salvage::Weights::debuff},
			{"draw", &Salvage::Weights::draw},
		}};

	} // namespace

	Salvage::Weights Salvage::weightsFrom(const std::map<std::string, double>& named) {
		return weightsNamed(named, kWeightNames, "salvage policy");
	}

	Salvage::Salvage(Weights weights)
		: weights(weights) {}

	rules::Action Salvage::choose(
		const rules::BattleState&	   board,
		const rules::Content&		   content,
		std::span<const rules::Action> actions,
		foundation::Rng&
	) const {
		return bestScored(preferredPlays(board, content, actions), [&](const rules::Action& action) {
			return score(board, content, action);
		});
	}

	double Salvage::score(const rules::BattleState& board, const rules::Content& content, const rules::Action& action) const {
		const auto* play = std::get_if<rules::action::PlayCard>(&action);
		if (!play) {
			return kEndTurn;
		}
		const Outcome outcome = outcomeOf(board, content, *play);
		const bool	  lastsIntoItsTurn = outcome.side == rules::Side::Player;

		double total = 0;
		for (const Loss& loss : outcome.vehicles) {
			total += loss.structure * weights.structure + loss.armor * weights.armor;
		}
		for (const Loss& loss : outcome.drivers) {
			total += loss.hitpoints * weights.driver * loss.hurt;
		}
		total += outcome.driversDown * weights.kill + outcome.wrecks * weights.wreck;
		total += outcome.armor * weights.defense + (lastsIntoItsTurn ? outcome.shield * weights.defense : 0);
		for (const Outcome::Repair& repair : outcome.repairs) {
			total += repair.critical ? 1000 + repair.structure * weights.heal : (repair.structure + repair.armor) * weights.defense;
		}
		total += outcome.statusesOnThem * weights.debuff + (lastsIntoItsTurn ? outcome.cardsDrawn : 0) * weights.draw;
		total += outcome.adrenaline * weights.draw + (outcome.tookFlank ? weights.flank : 0);
		return total > 0 ? total : kEndTurn * 2;
	}

} // namespace ai
