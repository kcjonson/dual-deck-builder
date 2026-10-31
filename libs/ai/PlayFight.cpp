#include "PlayFight.h"

#include <rules/battle/Battle.h>
#include <rules/battle/EnemyTurn.h>

#include <algorithm>
#include <stdexcept>
#include <string>
#include <vector>

namespace ai {

	namespace {

		// The seat's own plays, then the end of its part of the turn.
		std::vector<rules::Action> offersFor(const std::vector<rules::Action>& actions, rules::DriverIndex seat) {
			std::vector<rules::Action> offers;
			for (const rules::Action& action : actions) {
				const auto* play = std::get_if<rules::action::PlayCard>(&action);
				if (!play || play->driver == seat) {
					offers.push_back(action);
				}
			}
			return offers;
		}

	} // namespace

	void playFight(
		rules::BattleState&		state,
		const rules::Content&	content,
		const rules::PolicyFor& players,
		const rules::PolicyFor& raiders,
		int						mostActions
	) {
		int taken = 0;
		while (state.phase != rules::Phase::Over) {
			if (state.phase == rules::Phase::Planning) {
				(void)rules::planEnemyTurn(state, content, raiders);
				continue;
			}
			for (int seat = 0; seat < static_cast<int>(state.drivers.size()) && state.phase == rules::Phase::PlayerTurn; ++seat) {
				const rules::DriverIndex driver{seat};
				if (state.driver(driver).side != rules::Side::Player) {
					continue;
				}
				const rules::Policy& policy = players(state, driver);
				foundation::Rng		 rng = state.random.next("stand-in:" + std::to_string(seat));
				while (state.phase == rules::Phase::PlayerTurn) {
					const std::vector<rules::Action> offers = offersFor(rules::legalActions(state, content), driver);
					const rules::Action				 choice = policy.choose(state, content, offers, rng);
					if (std::ranges::find(offers, choice) == offers.end()) {
						throw std::logic_error("playFight: a stand-in chose an action that wasn't on offer");
					}
					if (std::holds_alternative<rules::action::EndTurn>(choice)) {
						break;
					}
					(void)rules::apply(state, content, choice);
					if (++taken > mostActions) {
						throw std::logic_error("playFight: the fight is still going after " + std::to_string(mostActions) + " actions");
					}
				}
			}
			if (state.phase == rules::Phase::PlayerTurn) {
				(void)rules::apply(state, content, rules::action::EndTurn{});
				++taken;
			}
		}
	}

} // namespace ai
