#include "OpponentPolicies.h"

#include "AggressiveFlanker.h"
#include "Difficulty.h"
#include "FirstPlayable.h"
#include "IntentAware.h"
#include "Mcts.h"
#include "Ramming.h"
#include "RandomPlay.h"
#include "Salvage.h"

#include <rules/core/ContentError.h>

#include <stdexcept>
#include <string>

namespace ai {

	namespace {

		std::unique_ptr<rules::Policy> chooserFor(const rules::Behavior& behavior, rules::Side seat) {
			const std::string& name = behavior.policy;
			if (name == "aggressive_flanker") {
				return std::make_unique<AggressiveFlanker>(AggressiveFlanker::weightsFrom(behavior.weights));
			}
			if (name == "intent_aware") {
				if (seat != rules::Side::Player) {
					throw std::invalid_argument("intent_aware reads the raiders' plans, so only the player's seats play with it");
				}
				return std::make_unique<IntentAware>(IntentAware::weightsFrom(behavior.weights));
			}
			if (name == "ramming") {
				return std::make_unique<Ramming>(Ramming::weightsFrom(behavior.weights));
			}
			if (name == "salvage") {
				return std::make_unique<Salvage>(Salvage::weightsFrom(behavior.weights));
			}
			if (name == "mcts") {
				return std::make_unique<Mcts>(Mcts::weightsFrom(behavior.weights));
			}
			if (name == "random" || name == "first_playable") {
				if (!behavior.weights.empty()) {
					throw std::invalid_argument(name + " takes no weights");
				}
				return name == "random" ? std::unique_ptr<rules::Policy>(std::make_unique<RandomPlay>())
										: std::unique_ptr<rules::Policy>(std::make_unique<FirstPlayable>());
			}
			throw std::invalid_argument(
				"policy \"" + name +
				"\" isn't one the AI has (aggressive_flanker, intent_aware, ramming, salvage, mcts, random, first_playable)"
			);
		}

	} // namespace

	std::unique_ptr<rules::Policy> makePolicy(const rules::Behavior& behavior, rules::Side seat) {
		if (!behavior.script.empty()) {
			throw std::invalid_argument("script " + behavior.script + " needs the Lua host, which isn't built yet");
		}
		std::unique_ptr<rules::Policy> chooser = chooserFor(behavior, seat);
		const std::string&			   difficulty = behavior.difficulty;
		if (difficulty.empty() || difficulty == "normal" || difficulty == "hard") {
			return chooser;
		}
		if (difficulty == "easy") {
			return std::make_unique<Easy>(std::move(chooser));
		}
		if (difficulty == "nightmare") {
			throw std::invalid_argument("difficulty nightmare is perfect play, which isn't built");
		}
		throw std::invalid_argument("difficulty \"" + difficulty + "\" isn't one the AI has (easy, normal, hard)");
	}

	OpponentPolicies::OpponentPolicies(const rules::Content& content) {
		for (const auto& [id, opponent] : content.opponents) {
			try {
				policies.emplace(id, makePolicy(opponent.behavior, rules::Side::Raiders));
			} catch (const std::invalid_argument& error) {
				throw rules::ContentError("opponent " + id.value + "'s behavior: " + error.what());
			}
		}
	}

	const rules::Policy& OpponentPolicies::forOpponent(const rules::OpponentId& opponent) const {
		const auto found = policies.find(opponent);
		if (found == policies.end()) {
			throw std::invalid_argument("OpponentPolicies: no loaded pack defines opponent " + opponent.value);
		}
		return *found->second;
	}

	rules::PolicyFor OpponentPolicies::forRaiders() const {
		return [this](const rules::BattleState& board, rules::DriverIndex raider) -> const rules::Policy& {
			const auto* opponent = std::get_if<rules::OpponentId>(&board.driver(raider).profile);
			if (!opponent) {
				throw std::logic_error("OpponentPolicies: only a raider plans");
			}
			return forOpponent(*opponent);
		};
	}

} // namespace ai
