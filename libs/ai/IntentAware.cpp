#include "IntentAware.h"

#include "Outcome.h"
#include "Weights.h"

#include <rules/battle/Battle.h>

#include <algorithm>
#include <optional>

namespace ai {

	namespace {

		using rules::BattleState;
		using rules::Side;
		namespace event = rules::event;

		constexpr WeightNames<IntentAware::Weights, 3> kWeightNames{{
			{"harm", &IntentAware::Weights::harm},
			{"progress", &IntentAware::Weights::progress},
			{"arrival", &IntentAware::Weights::arrival},
		}};

		// A wreck or a driver down costs a run far more than the points it took (call 241).
		constexpr int kLossHarm = 20;

		// A raider vehicle's armor, structure, and the HP aboard it.
		int toughness(const BattleState& state, rules::VehicleIndex index) {
			const rules::BattleVehicle& vehicle = state.vehicle(index);
			int							total = vehicle.armor + vehicle.structure;
			for (const std::optional<rules::DriverIndex>& seat : {vehicle.driver, vehicle.passenger}) {
				total += seat ? state.driver(*seat).hitpoints : 0;
			}
			return total;
		}

	} // namespace

	Threat threatOf(const BattleState& board, const rules::Content& content) {
		Threat threat;
		if (board.phase != rules::Phase::PlayerTurn) {
			return threat;
		}
		BattleState						future = board;
		std::optional<int>				raider;
		const std::vector<rules::Event> events = rules::apply(future, content, rules::action::EndTurn{});
		const auto						harm = [&](int amount) {
			 threat.harm += amount;
			 if (raider) {
				 threat.byRaider[*raider] += amount;
			 }
		};
		for (const rules::Event& happened : events) {
			if (const auto* turn = std::get_if<event::TurnStarted>(&happened); turn && turn->side == Side::Player) {
				break;
			}
			if (const auto* played = std::get_if<event::PlannedStepPlayed>(&happened)) {
				raider = played->raider.value;
			} else if (const auto* acting = std::get_if<event::RaiderActing>(&happened)) {
				raider = acting->raider.value;
			} else if (const auto* hit = std::get_if<event::VehicleDamaged>(&happened)) {
				harm(board.vehicle(hit->vehicle).side == Side::Player ? hit->structure : 0);
			} else if (const auto* hurt = std::get_if<event::DriverDamaged>(&happened)) {
				harm(board.driver(hurt->driver).side == Side::Player ? hurt->hitpoints : 0);
			} else if (const auto* wreck = std::get_if<event::VehicleWrecked>(&happened)) {
				harm(board.vehicle(wreck->vehicle).side == Side::Player ? kLossHarm : 0);
			} else if (const auto* down = std::get_if<event::DriverDown>(&happened)) {
				harm(board.driver(down->driver).side == Side::Player ? kLossHarm : 0);
			} else if (std::holds_alternative<event::RaiderArrived>(happened)) {
				++threat.arrivals;
			}
		}
		return threat;
	}

	IntentAware::Weights IntentAware::weightsFrom(const std::map<std::string, double>& named) {
		return weightsNamed(named, kWeightNames, "intent-aware stand-in");
	}

	IntentAware::IntentAware(Weights weights)
		: weights(weights) {}

	rules::Action IntentAware::choose(
		const BattleState&			   board,
		const rules::Content&		   content,
		std::span<const rules::Action> actions,
		foundation::Rng&
	) const {
		const Threat now = threatOf(board, content);
		return bestScored(std::vector<rules::Action>(actions.begin(), actions.end()), [&](const rules::Action& action) {
			return score(board, content, now, action);
		});
	}

	double
	IntentAware::score(const BattleState& board, const rules::Content& content, const Threat& now, const rules::Action& action) const {
		if (!std::holds_alternative<rules::action::PlayCard>(action)) {
			return kEndTurn;
		}
		BattleState after = board;
		(void)rules::apply(after, content, action);
		const Threat later = threatOf(after, content);
		const double kept = now.harm - later.harm - (later.arrivals - now.arrivals) * weights.arrival;

		double progressed = 0;
		for (const auto& [raider, harm] : now.byRaider) {
			const std::optional<rules::VehicleIndex> vehicle = rules::vehicleCarrying(board, rules::DriverIndex{raider});
			if (harm <= 0 || !vehicle || !rules::vehicleInFight(after, *vehicle)) {
				continue;
			}
			const int before = toughness(board, *vehicle);
			progressed += harm * static_cast<double>(before - toughness(after, *vehicle)) / std::max(1, before);
		}

		const double offense = floor.score(board, content, action);
		const double total = (kept + progressed * weights.progress) * weights.harm + (offense <= kEndTurn ? 0 : offense);
		return total > 0 ? total : kEndTurn * 2;
	}

} // namespace ai
