#pragma once

#include "BattleEvent.h"
#include "BattleState.h"

#include <optional>
#include <vector>

namespace rules {

	// Puts a status on a vehicle for `turns` player turn starts, or none for the rest of the fight. A stun
	// passes a Steady raider by.
	void applyStatus(BattleState& state, VehicleIndex vehicle, const VehicleStatus& status, std::vector<Event>& events);

	// The start of the player's turn: each status with turns left counts one off and wears off at none, and a
	// raider whose stun just wore off is Steady until the next one.
	void tickStatuses(BattleState& state, std::vector<Event>& events);

	// The end of `side`'s turn: whoever is at the wheel of each of its vehicles carrying a death_mark goes down.
	void takeDeathMarks(BattleState& state, Side side, std::vector<Event>& events);

	// An attack card played from the vehicle uses up its damage_bonus, hit or miss.
	void useDamageBonus(BattleState& state, VehicleIndex vehicle, std::vector<Event>& events);

} // namespace rules
