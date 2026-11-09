#pragma once

// What the battle scene's piece tests share: a real fight on the base pack, the Road Warrior and the Interceptor against
// the scav pack and the wave behind it, played a few turns by a plain hand, each action handed over with the fight before
// and after it and the events it made, as the scene's apply and plan leave them.

#include "GameTesting.h"

#include <rules/battle/Battle.h>
#include <rules/battle/Encounters.h>
#include <rules/battle/EnemyTurn.h>

#include <array>
#include <cstdint>
#include <functional>
#include <string>
#include <variant>
#include <vector>

namespace game::testing {

	inline const std::array<std::string, 2> kSeats{"Road Warrior 1", "Interceptor 2"};

	inline rules::BattleState fieldFight(uint32_t seed) {
		const rules::Content& content = testRules().content;
		const auto			  seat = [&](const char* driver) {
			   const rules::DriverId id{driver};
			   return rules::PlayerSeat{.driver = id, .deck = rules::cardsOf(content.drivers.at(id).startingDeck)};
		};
		rules::BattleSetup setup{.players = {seat("road_warrior"), seat("interceptor")}, .seed = seed};
		rules::fieldEncounter(setup, content, rules::EncounterId{"scav_pack"}, 0);
		rules::BattleState state = rules::startBattle(setup, content).state;
		(void)rules::planEnemyTurn(state, content, testRules().raiders.forRaiders());
		return state;
	}

	struct Played {
		rules::BattleState		  before;
		rules::BattleState		  after;
		std::vector<rules::Event> events;
		bool					  endTurn = false;
	};

	// Up to `turns` player turns of a fight on `seed`: up to three plays a turn, picked round the plays on offer, then
	// the end of the turn, until the fight is over.
	inline void playFight(uint32_t seed, int turns, const std::function<void(const Played&)>& each) {
		const rules::Content& content = testRules().content;
		rules::BattleState	  state = fieldFight(seed);
		for (int turn = 0; turn < turns && state.phase != rules::Phase::Over; ++turn) {
			for (int play = 0; play <= 3 && state.phase != rules::Phase::Over; ++play) {
				std::vector<rules::Action> plays;
				for (const rules::Action& action : rules::legalActions(state, content)) {
					if (std::holds_alternative<rules::action::PlayCard>(action)) {
						plays.push_back(action);
					}
				}
				const bool			endTurn = play == 3 || plays.empty();
				const rules::Action action =
					endTurn ? rules::Action(rules::action::EndTurn{}) : plays[static_cast<size_t>(turn * 7 + play) % plays.size()];
				Played played{.before = state, .endTurn = endTurn};
				played.events = rules::apply(state, content, action);
				if (state.phase == rules::Phase::Planning) {
					(void)rules::planEnemyTurn(state, content, testRules().raiders.forRaiders());
				}
				played.after = state;
				each(played);
				if (endTurn) {
					break;
				}
			}
		}
	}

} // namespace game::testing
