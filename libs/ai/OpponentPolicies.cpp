#include "OpponentPolicies.h"

#include "AggressiveFlanker.h"
#include "FirstPlayable.h"

#include <rules/core/ContentError.h>

#include <stdexcept>
#include <string>
#include <vector>

namespace ai {

	namespace {

		std::unique_ptr<rules::Policy> policyFor(const rules::OpponentDefinition& opponent) {
			const rules::Behavior& behavior = opponent.behavior;
			const std::string	   who = "opponent " + opponent.id.value + "'s behavior";
			if (!behavior.script.empty()) {
				throw rules::ContentError(
					who + " names script " + behavior.script + ", and scripted behaviors need the Lua host, which isn't built yet"
				);
			}
			if (behavior.policy == "aggressive_flanker") {
				try {
					return std::make_unique<AggressiveFlanker>(AggressiveFlanker::weightsFrom(behavior.weights));
				} catch (const std::invalid_argument& error) {
					throw rules::ContentError(who + ": " + error.what());
				}
			}
			if (behavior.policy == "first_playable") {
				if (!behavior.weights.empty()) {
					throw rules::ContentError(who + " gives weights, and first_playable takes none");
				}
				return std::make_unique<FirstPlayable>();
			}
			throw rules::ContentError(
				who + " names policy \"" + behavior.policy + "\", which isn't one the AI has (aggressive_flanker, first_playable)"
			);
		}

	} // namespace

	OpponentPolicies::OpponentPolicies(const rules::Content& content) {
		for (const auto& [id, opponent] : content.opponents) {
			policies.emplace(id, policyFor(opponent));
		}
	}

	const rules::Policy& OpponentPolicies::forOpponent(const rules::OpponentId& opponent) const {
		const auto found = policies.find(opponent);
		if (found == policies.end()) {
			throw std::invalid_argument("OpponentPolicies: no loaded pack defines opponent " + opponent.value);
		}
		return *found->second;
	}

	rules::PolicyFor OpponentPolicies::forFight(const rules::BattleState& state) const {
		std::vector<const rules::Policy*> seats;
		for (const rules::BattleDriver& driver : state.drivers) {
			const auto* opponent = std::get_if<rules::OpponentId>(&driver.profile);
			seats.push_back(opponent ? &forOpponent(*opponent) : nullptr);
		}
		return [seats = std::move(seats)](rules::DriverIndex raider) -> const rules::Policy& {
			const rules::Policy* policy = seats.at(static_cast<size_t>(raider.value));
			if (!policy) {
				throw std::logic_error("OpponentPolicies: only a raider plans");
			}
			return *policy;
		};
	}

} // namespace ai
