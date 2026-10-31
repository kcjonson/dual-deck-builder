#pragma once

#include "BattleEvent.h"
#include "BattleState.h"

#include <vector>

namespace rules {

	// A hit on a vehicle: Shield first, then armor, then half of what's left (rounded up) to its structure and
	// to each living occupant, or all of it to structure with nobody aboard (Combat Rules, Damage). Structure-only
	// damage skips the rest. Then it settles who went down, who took the wheel, and the wreck.
	void damageVehicle(BattleState& state, VehicleIndex vehicle, int damage, bool structureOnly, std::vector<Event>& events);

	// Damage that skips the vehicle and lands on one person aboard (Headshot, Berserker).
	void damageDriver(BattleState& state, DriverIndex driver, int damage, std::vector<Event>& events);

} // namespace rules
