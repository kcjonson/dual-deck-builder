#pragma once

#include "BattleEvent.h"
#include "BattleState.h"

#include <rules/core/Effect.h>

#include <optional>
#include <string>
#include <vector>

namespace rules {

	// The board's move rules (Combat Rules, Flanking and Swerving; movement-cards.md), which targeting and play
	// both ask, so a move is legal by the same rule it's carried out by.

	// The vehicle the caster's partner rides in, driving or not, at any distance; none without a partner in the
	// fight, or when they ride together.
	[[nodiscard]] std::optional<VehicleIndex> partnerVehicleOf(const BattleState& state, DriverIndex caster);

	// Why `flanker` can't outrun `target` onto the shoulder: it's already flanking or boxed in, the target isn't
	// in its formation or isn't slower, or the shoulder slot in the target's row is taken. `speedBonus` is what
	// the card's own boost adds first.
	[[nodiscard]] std::optional<std::string>
	flankBlocker(const BattleState& state, VehicleIndex flanker, VehicleIndex target, int speedBonus);

	// Where a swerve, a move, or a drop-back can take `mover` from `from`: none or one slot for a fixed
	// direction, each legal one for a pick. Always the mover's own formation, empty and unreserved, and never
	// for a flanker, except a drop-back, which is a flanker back to its reserved slot.
	[[nodiscard]] std::vector<RoadSlot> moveDestinations(
		const BattleState&			  state,
		const effect::ChangePosition& move,
		VehicleIndex				  mover,
		RoadSlot					  from,
		std::optional<VehicleIndex>	  partner
	);

	// Why the vehicle `caster` rides in can't swap slots with `other`: it has to be the partner's vehicle, or an
	// escort next to it, and neither can be flanking.
	[[nodiscard]] std::optional<std::string> swapBlocker(const BattleState& state, DriverIndex caster, VehicleIndex other);

	// Moves a vehicle and says so. A card's move counts as the vehicle swerving this turn.
	void moveVehicle(
		BattleState&			  state,
		VehicleIndex			  vehicle,
		RoadSlot				  to,
		std::optional<FlankState> flank,
		MoveCause				  cause,
		std::vector<Event>&		  events
	);

	// Every vehicle on `side`'s formation trades lanes within its row, wrecks included, and a flanker's reserved
	// slot trades with its row (call 291).
	void shiftFormation(BattleState& state, Side side, std::vector<Event>& events);

	// The end of every turn: a flanker no longer faster than the vehicle it outran drops back to its reserved
	// slot. One that outran a vehicle now out of the fight holds, as an ambusher does.
	void dropBackFlankers(BattleState& state, std::vector<Event>& events);

	// The end of every enemy turn, after wrecks clear: each empty raider inside slot across from one of the
	// player's driven vehicles takes the nearest raider in formation not across from one already (Combat Rules,
	// Raider formation and stuns). Flankers never move and reserved slots stay empty.
	void closeUpRaiders(BattleState& state, std::vector<Event>& events);

} // namespace rules
