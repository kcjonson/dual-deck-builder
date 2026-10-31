#include "AggressiveFlanker.h"

#include "Preferences.h"

#include <rules/battle/Battle.h>
#include <rules/battle/CardPlay.h>
#include <rules/battle/Movement.h>

#include <algorithm>
#include <array>
#include <stdexcept>
#include <string_view>
#include <utility>

namespace ai {

	namespace {

		using rules::BattleState;
		using rules::BattleVehicle;
		using rules::Side;
		using rules::VehicleIndex;
		namespace event = rules::event;

		// What ending the turn scores. A play that does nothing scores under it.
		constexpr double kEndTurn = -1000;

		constexpr std::array<std::pair<std::string_view, double AggressiveFlanker::Weights::*>, 7> kWeightNames{{
			{"damage", &AggressiveFlanker::Weights::damage},
			{"kill", &AggressiveFlanker::Weights::kill},
			{"flank", &AggressiveFlanker::Weights::flank},
			{"heal", &AggressiveFlanker::Weights::heal},
			{"defense", &AggressiveFlanker::Weights::defense},
			{"debuff", &AggressiveFlanker::Weights::debuff},
			{"draw", &AggressiveFlanker::Weights::draw},
		}};

		bool canFlankAnyone(const BattleState& state, VehicleIndex flanker) {
			if (!rules::vehicleInFight(state, flanker)) {
				return false;
			}
			for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
				const VehicleIndex other{index};
				if (state.vehicle(other).side != state.vehicle(flanker).side && !rules::flankBlocker(state, flanker, other, 0)) {
					return true;
				}
			}
			return false;
		}

		// A flanker holds the shoulder past the turn's end while it's faster than what it outran, or when there's no
		// slot to drop back to or nobody left to drop back from.
		bool holdsFlank(const BattleState& state, VehicleIndex flanker) {
			const std::optional<rules::FlankState>& flank = state.vehicle(flanker).flank;
			if (!flank || !flank->reservedSlot || !flank->outran || !rules::vehicleInFight(state, *flank->outran)) {
				return true;
			}
			return rules::speedOf(state, flanker) > rules::speedOf(state, *flank->outran);
		}

		double hurtFactor(int now, int most) {
			return 2.0 - static_cast<double>(now) / static_cast<double>(std::max(1, most));
		}

	} // namespace

	AggressiveFlanker::Weights AggressiveFlanker::weightsFrom(const std::map<std::string, double>& named) {
		Weights weights;
		for (const auto& [name, value] : named) {
			const auto found = std::ranges::find(kWeightNames, name, &std::pair<std::string_view, double Weights::*>::first);
			if (found == kWeightNames.end()) {
				std::string known;
				for (const auto& [candidate, member] : kWeightNames) {
					known += known.empty() ? "" : ", ";
					known += candidate;
				}
				throw std::invalid_argument("weight \"" + name + "\" isn't one the aggressive flanker takes (" + known + ")");
			}
			weights.*(found->second) = value;
		}
		return weights;
	}

	AggressiveFlanker::AggressiveFlanker(Weights weights)
		: weights(weights) {}

	rules::Action AggressiveFlanker::choose(
		const BattleState&			   board,
		const rules::Content&		   content,
		std::span<const rules::Action> actions,
		foundation::Rng&
	) const {
		const std::vector<rules::Action> offered = preferredPlays(board, content, actions);
		size_t							 best = 0;
		double							 bestScore = score(board, content, offered.front());
		for (size_t index = 1; index < offered.size(); ++index) {
			const double candidate = score(board, content, offered[index]);
			if (candidate > bestScore) {
				best = index;
				bestScore = candidate;
			}
		}
		return offered[best];
	}

	double AggressiveFlanker::score(const BattleState& board, const rules::Content& content, const rules::Action& action) const {
		const auto* play = std::get_if<rules::action::PlayCard>(&action);
		if (!play) {
			return kEndTurn;
		}
		BattleState						after = board;
		const std::vector<rules::Event> events = rules::apply(after, content, action);
		const Side						mine = board.driver(play->driver).side;
		const VehicleIndex				actor = *rules::vehicleCarrying(board, play->driver);
		// Shield clears and a drawn card is discarded as the player's turn starts, so for a raider planning its
		// enemy turn both are worth nothing (call 355).
		const bool lastsIntoItsTurn = mine == Side::Player;

		double	   total = 0;
		bool	   counted = false;
		const auto add = [&](double amount) {
			if (amount > 0) {
				total += amount;
				counted = true;
			}
		};

		for (int index = 0; index < static_cast<int>(board.vehicles.size()); ++index) {
			const BattleVehicle& was = board.vehicles[static_cast<size_t>(index)];
			const BattleVehicle& now = after.vehicles[static_cast<size_t>(index)];
			if (was.side == mine) {
				continue;
			}
			const int lost = std::max(0, was.armor - now.armor) + std::max(0, was.structure - now.structure);
			add(lost * weights.damage * hurtFactor(was.structure, was.maxStructure));
			if (rules::vehicleInFight(board, VehicleIndex{index}) && !rules::vehicleInFight(after, VehicleIndex{index})) {
				add(weights.kill);
			}
		}
		for (size_t index = 0; index < board.drivers.size(); ++index) {
			const rules::BattleDriver& was = board.drivers[index];
			const rules::BattleDriver& now = after.drivers[index];
			if (was.side == mine) {
				continue;
			}
			add(std::max(0, was.hitpoints - now.hitpoints) * weights.damage * hurtFactor(was.hitpoints, was.maxHitpoints));
			if (was.isAlive() && !now.isAlive()) {
				add(weights.kill);
			}
		}

		const auto ours = [&](VehicleIndex vehicle) {
			return board.vehicle(vehicle).side == mine;
		};
		for (const rules::Event& happened : events) {
			if (const auto* shield = std::get_if<event::ShieldGained>(&happened)) {
				add(ours(shield->vehicle) && lastsIntoItsTurn ? shield->shield * weights.defense : 0);
			} else if (const auto* armor = std::get_if<event::ArmorGained>(&happened)) {
				add(ours(armor->vehicle) ? armor->armor * weights.defense : 0);
			} else if (const auto* repair = std::get_if<event::Repaired>(&happened)) {
				const BattleVehicle& repaired = board.vehicle(repair->vehicle);
				if (ours(repair->vehicle)) {
					const bool critical = repaired.structure * 10 < repaired.maxStructure * 3;
					add(critical ? 1000 + repair->structure * weights.heal : (repair->structure + repair->armor) * weights.defense);
				}
			} else if (const auto* status = std::get_if<event::StatusApplied>(&happened)) {
				add(ours(status->vehicle) ? 0 : weights.debuff);
			} else if (const auto* drawn = std::get_if<event::CardDrawn>(&happened)) {
				add(board.driver(drawn->driver).side == mine && lastsIntoItsTurn ? weights.draw : 0);
			} else if (const auto* gained = std::get_if<event::AdrenalineGained>(&happened)) {
				add(board.driver(gained->driver).side == mine ? gained->adrenaline * weights.draw : 0);
			}
		}

		const bool wasFlanking = rules::isFlanking(board.vehicle(actor));
		const bool nowFlanking = rules::isFlanking(after.vehicle(actor));
		if (wasFlanking && !nowFlanking && holdsFlank(board, actor)) {
			return kEndTurn * 2;
		}
		if (!wasFlanking && nowFlanking) {
			add(weights.flank);
		} else if (!nowFlanking && !canFlankAnyone(board, actor) && canFlankAnyone(after, actor)) {
			add(weights.flank * 2 / 3);
		}
		if (!counted) {
			return kEndTurn * 2;
		}

		const rules::BattleCard& card = board.driver(play->driver).hand[static_cast<size_t>(play->handIndex)];
		if (rules::cardCost(rules::definitionOf(content, card.card), card.upgraded) > 3) {
			total *= 0.9;
		}
		if (after.driver(play->driver).adrenaline == 0 && board.turn < 3) {
			total *= 0.8;
		}
		return total;
	}

} // namespace ai
