#include "Ramming.h"

#include "Outcome.h"
#include "Preferences.h"
#include "Weights.h"

namespace ai {

	namespace {

		constexpr WeightNames<Ramming::Weights, 11> kWeightNames{{
			{"damage", &Ramming::Weights::damage},
			{"ram", &Ramming::Weights::ram},
			{"kill", &Ramming::Weights::kill},
			{"speed", &Ramming::Weights::speed},
			{"armor", &Ramming::Weights::armor},
			{"close", &Ramming::Weights::close},
			{"flank", &Ramming::Weights::flank},
			{"heal", &Ramming::Weights::heal},
			{"defense", &Ramming::Weights::defense},
			{"debuff", &Ramming::Weights::debuff},
			{"draw", &Ramming::Weights::draw},
		}};

		// What a ram reaches, the range Ram and Ramming Speed play at.
		constexpr int kRamRange = 1;

	} // namespace

	Ramming::Weights Ramming::weightsFrom(const std::map<std::string, double>& named) {
		return weightsNamed(named, kWeightNames, "ramming policy");
	}

	Ramming::Ramming(Weights weights)
		: weights(weights) {}

	rules::Action Ramming::choose(
		const rules::BattleState&	   board,
		const rules::Content&		   content,
		std::span<const rules::Action> actions,
		foundation::Rng&
	) const {
		return bestScored(preferredPlays(board, content, actions), [&](const rules::Action& action) {
			return score(board, content, action);
		});
	}

	double Ramming::score(const rules::BattleState& board, const rules::Content& content, const rules::Action& action) const {
		const auto* play = std::get_if<rules::action::PlayCard>(&action);
		if (!play) {
			return kEndTurn;
		}
		const Outcome outcome = outcomeOf(board, content, *play);
		const bool	  lastsIntoItsTurn = outcome.side == rules::Side::Player;

		double	   total = 0;
		bool	   counted = false;
		const auto add = [&](double amount) {
			if (amount > 0) {
				total += amount;
				counted = true;
			}
		};
		for (const Loss& loss : outcome.vehicles) {
			add((loss.armor + loss.structure) * weights.damage * loss.hurt);
		}
		for (const Loss& loss : outcome.drivers) {
			add(loss.hitpoints * weights.damage * loss.hurt);
		}
		add(outcome.rammed * weights.ram);
		add((outcome.vehiclesOut + outcome.driversDown) * weights.kill);
		add(outcome.speedGained * weights.speed);
		add(outcome.armor * weights.armor);
		add(lastsIntoItsTurn ? outcome.shield * weights.defense : 0);
		for (const Outcome::Repair& repair : outcome.repairs) {
			add(repair.critical ? 1000 + repair.structure * weights.heal : (repair.structure + repair.armor) * weights.defense);
		}
		add(outcome.statusesOnThem * weights.debuff);
		add((lastsIntoItsTurn ? outcome.cardsDrawn : 0) * weights.draw);
		add(outcome.adrenaline * weights.draw);
		const bool closes =
			outcome.rangeAfter && *outcome.rangeAfter <= kRamRange && (!outcome.rangeBefore || *outcome.rangeBefore > kRamRange);
		add(closes ? weights.close : 0);
		add(outcome.tookFlank ? weights.flank : 0);
		return counted ? total : kEndTurn * 2;
	}

} // namespace ai
