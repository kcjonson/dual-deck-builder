#include "Statuses.h"

#include "Damage.h"

#include <algorithm>

namespace rules {

	namespace {

		// Takes off every status `ends` picks, saying so for each.
		template <typename Ends>
		void endStatuses(BattleVehicle& vehicle, VehicleIndex index, Ends&& ends, std::vector<Event>& events) {
			for (const VehicleStatus& applied : vehicle.statuses) {
				if (ends(applied)) {
					events.emplace_back(event::StatusEnded{.vehicle = index, .status = applied.status});
				}
			}
			std::erase_if(vehicle.statuses, ends);
		}

	} // namespace

	void applyStatus(BattleState& state, VehicleIndex index, const VehicleStatus& status, std::vector<Event>& events) {
		BattleVehicle& vehicle = state.vehicle(index);
		if (status.status == Status::Stunned && vehicle.steady) {
			events.emplace_back(event::ShookOffStun{.vehicle = index});
			return;
		}
		vehicle.statuses.push_back(status);
		events.emplace_back(event::StatusApplied{.vehicle = index, .status = status.status, .value = status.value, .turns = status.turns});
	}

	void tickStatuses(BattleState& state, std::vector<Event>& events) {
		for (int number = 0; number < static_cast<int>(state.vehicles.size()); ++number) {
			const VehicleIndex index{number};
			BattleVehicle&	   vehicle = state.vehicle(index);
			const bool		   wasStunned = hasStatus(vehicle, Status::Stunned);
			for (VehicleStatus& applied : vehicle.statuses) {
				if (applied.turns) {
					--*applied.turns;
				}
			}
			endStatuses(vehicle, index, [](const VehicleStatus& applied) { return applied.turns == 0; }, events);
			vehicle.steady =
				vehicle.side == Side::Raiders && wasStunned && !hasStatus(vehicle, Status::Stunned) && vehicleInFight(state, index);
			if (vehicle.steady) {
				events.emplace_back(event::BecameSteady{.vehicle = index});
			}
		}
	}

	void takeDeathMarks(BattleState& state, Side side, std::vector<Event>& events) {
		for (int number = 0; number < static_cast<int>(state.vehicles.size()); ++number) {
			const VehicleIndex	 index{number};
			const BattleVehicle& vehicle = state.vehicle(index);
			if (vehicle.side != side || !vehicle.driver || !vehicleInFight(state, index) || !hasStatus(vehicle, Status::DeathMark)) {
				continue;
			}
			const DriverIndex marked = *vehicle.driver;
			events.emplace_back(event::DeathMarkTaken{.vehicle = index, .driver = marked});
			damageDriver(state, marked, state.driver(marked).hitpoints, events);
		}
	}

	void useDamageBonus(BattleState& state, VehicleIndex index, std::vector<Event>& events) {
		endStatuses(
			state.vehicle(index), index, [](const VehicleStatus& applied) { return applied.status == Status::DamageBonus; }, events
		);
	}

} // namespace rules
