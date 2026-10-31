#include "BattleState.h"

#include <algorithm>
#include <cassert>

namespace rules {

	BattleDriver& BattleState::driver(DriverIndex index) {
		assert(index.value >= 0 && index.value < static_cast<int>(drivers.size()) && "BattleState::driver: no such driver");
		return drivers[static_cast<size_t>(index.value)];
	}

	const BattleDriver& BattleState::driver(DriverIndex index) const {
		assert(index.value >= 0 && index.value < static_cast<int>(drivers.size()) && "BattleState::driver: no such driver");
		return drivers[static_cast<size_t>(index.value)];
	}

	BattleVehicle& BattleState::vehicle(VehicleIndex index) {
		assert(index.value >= 0 && index.value < static_cast<int>(vehicles.size()) && "BattleState::vehicle: no such vehicle");
		return vehicles[static_cast<size_t>(index.value)];
	}

	const BattleVehicle& BattleState::vehicle(VehicleIndex index) const {
		assert(index.value >= 0 && index.value < static_cast<int>(vehicles.size()) && "BattleState::vehicle: no such vehicle");
		return vehicles[static_cast<size_t>(index.value)];
	}

	std::optional<VehicleIndex> vehicleCarrying(const BattleState& state, DriverIndex driver) {
		for (size_t index = 0; index < state.vehicles.size(); ++index) {
			const BattleVehicle& vehicle = state.vehicles[index];
			if (vehicle.driver == driver || vehicle.passenger == driver) {
				return VehicleIndex{static_cast<int>(index)};
			}
		}
		return std::nullopt;
	}

	bool vehicleInFight(const BattleState& state, VehicleIndex index) {
		const BattleVehicle& vehicle = state.vehicle(index);
		return vehicle.onRoad && vehicle.structure > 0 && (vehicle.isEscort() || vehicle.driver.has_value());
	}

	bool driverInFight(const BattleState& state, DriverIndex index) {
		const BattleDriver& driver = state.driver(index);
		if (!driver.isAlive() || driver.crashedOut) {
			return false;
		}
		const std::optional<VehicleIndex> vehicle = vehicleCarrying(state, index);
		return vehicle && vehicleInFight(state, *vehicle);
	}

	std::optional<DriverIndex> partnerOf(const BattleState& state, DriverIndex index) {
		if (state.driver(index).side != Side::Player) {
			return std::nullopt;
		}
		const auto seats = std::ranges::count_if(state.drivers, [](const BattleDriver& driver) { return driver.side == Side::Player; });
		if (seats < 2) {
			return std::nullopt;
		}
		assert(seats == 2 && index.value < 2 && "partnerOf: a fight seats one or two players, first");
		return DriverIndex{1 - index.value};
	}

	bool hasStatus(const BattleVehicle& vehicle, Status status) {
		return std::ranges::any_of(vehicle.statuses, [&](const VehicleStatus& applied) { return applied.status == status; });
	}

	int statusTotal(const BattleVehicle& vehicle, Status status) {
		int total = 0;
		for (const VehicleStatus& applied : vehicle.statuses) {
			total += applied.status == status ? applied.value : 0;
		}
		return total;
	}

	bool isHeavy(const BattleVehicle& vehicle) {
		return vehicle.armor > vehicle.baseArmor;
	}

	int speedOf(const BattleState& state, VehicleIndex index) {
		const BattleVehicle& vehicle = state.vehicle(index);
		const int			 driverSpeed = !vehicle.isEscort() && vehicle.driver ? state.driver(*vehicle.driver).skills.speed : 0;
		const int			 boost = isHeavy(vehicle) ? 0 : statusTotal(vehicle, Status::SpeedBoost);
		return std::max(0, vehicle.baseSpeed + driverSpeed + boost + statusTotal(vehicle, Status::SpeedReduction));
	}

	int evadeOf(const BattleState& state, VehicleIndex index) {
		const BattleVehicle& vehicle = state.vehicle(index);
		const int			 boost = statusTotal(vehicle, Status::EvadeBoost);
		if (vehicle.crew) {
			return vehicle.crew->evade + boost;
		}
		assert(vehicle.driver && "evadeOf: a driven vehicle with nobody at the wheel is out of the fight");
		return state.driver(*vehicle.driver).skills.evade + boost;
	}

	bool isFlanking(const BattleVehicle& vehicle) {
		return isShoulder(vehicle.slot.lane);
	}

} // namespace rules
