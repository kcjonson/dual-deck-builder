#include "AggressiveFlanker.h"

#include "Outcome.h"
#include "Preferences.h"
#include "Weights.h"

namespace ai {

	namespace {

		using rules::BattleState;

		constexpr WeightNames<AggressiveFlanker::Weights, 7> kWeightNames{{
			{"damage", &AggressiveFlanker::Weights::damage},
			{"kill", &AggressiveFlanker::Weights::kill},
			{"flank", &AggressiveFlanker::Weights::flank},
			{"heal", &AggressiveFlanker::Weights::heal},
			{"defense", &AggressiveFlanker::Weights::defense},
			{"debuff", &AggressiveFlanker::Weights::debuff},
			{"draw", &AggressiveFlanker::Weights::draw},
		}};

	} // namespace

	AggressiveFlanker::Weights AggressiveFlanker::weightsFrom(const std::map<std::string, double>& named) {
		return weightsNamed(named, kWeightNames, "aggressive flanker");
	}

	AggressiveFlanker::AggressiveFlanker(Weights weights)
		: weights(weights) {}

	rules::Action AggressiveFlanker::choose(
		const BattleState&			   board,
		const rules::Content&		   content,
		std::span<const rules::Action> actions,
		foundation::Rng&
	) const {
		return bestScored(preferredPlays(board, content, actions), [&](const rules::Action& action) {
			return score(board, content, action);
		});
	}

	double AggressiveFlanker::score(const BattleState& board, const rules::Content& content, const rules::Action& action) const {
		const auto* play = std::get_if<rules::action::PlayCard>(&action);
		if (!play) {
			return kEndTurn;
		}
		const Outcome outcome = outcomeOf(board, content, *play);
		// Shield clears and a drawn card is discarded as the player's turn starts, so for a raider planning its
		// enemy turn both are worth nothing (call 355).
		const bool lastsIntoItsTurn = outcome.side == rules::Side::Player;

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
		for (int kill = 0; kill < outcome.vehiclesOut + outcome.driversDown; ++kill) {
			add(weights.kill);
		}
		add(lastsIntoItsTurn ? outcome.shield * weights.defense : 0);
		add(outcome.armor * weights.defense);
		for (const Outcome::Repair& repair : outcome.repairs) {
			add(repair.critical ? 1000 + repair.structure * weights.heal : (repair.structure + repair.armor) * weights.defense);
		}
		for (int status = 0; status < outcome.statusesOnThem; ++status) {
			add(weights.debuff);
		}
		for (int card = 0; card < (lastsIntoItsTurn ? outcome.cardsDrawn : 0); ++card) {
			add(weights.draw);
		}
		add(outcome.adrenaline * weights.draw);

		if (outcome.gaveUpHeldFlank) {
			return kEndTurn * 2;
		}
		if (outcome.tookFlank) {
			add(weights.flank);
		} else if (outcome.opensFlank) {
			add(weights.flank * 2 / 3);
		}
		if (!counted) {
			return kEndTurn * 2;
		}
		if (outcome.cost > 3) {
			total *= 0.9;
		}
		if (outcome.spentAllAdrenaline && board.turn < 3) {
			total *= 0.8;
		}
		return total;
	}

} // namespace ai
