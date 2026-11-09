#pragma once

// What the road shows of a fight (Battle Screen Design 1 and 3, vehicle-token.md, enemy-intent-planning.md): every
// vehicle on the road as a token in its slot, raiders first so focus meets them first, the rows a due wave pulls into,
// where planned raider swerves go, and each intent's line for the end-turn preview. Filled from the fight as the scene's
// playback shows it, which a beat moves on event by event.

#include "road/VehicleToken.h"

#include <rules/battle/BattleState.h>
#include <rules/battle/EnemyTurn.h>
#include <rules/packs/Pack.h>

#include <optional>
#include <span>
#include <string>
#include <vector>

namespace game::road {

	struct RoadVehicle {
		rules::VehicleIndex			   index;
		TokenData					   token;
		rules::RoadSlot				   slot;
		std::optional<rules::RoadSlot> reserved; // a flanker's held formation slot, which no one else takes

		bool operator==(const RoadVehicle&) const = default;
	};

	// A raider's planned swerve: its outlined destination (movement-cards.md, Raider swerves).
	struct PlannedMove {
		rules::VehicleIndex raider;
		rules::RoadSlot		to;

		bool operator==(const PlannedMove&) const = default;
	};

	// One intent's line in the end-turn preview, from the raider to what it hits; none for an area hit, which lands on
	// every vehicle of the player's side.
	struct IntentLine {
		rules::VehicleIndex				   from;
		std::optional<rules::VehicleIndex> to;
		bool							   attack = false; // red; anything else draws muted

		bool operator==(const IntentLine&) const = default;
	};

	struct RoadPicture {
		std::vector<RoadVehicle> vehicles;
		std::vector<rules::Row>	 arrivals; // rows a due wave pulls into, marked in the gutter
		std::vector<PlannedMove> planned;
		std::vector<IntentLine>	 intents;

		bool operator==(const RoadPicture&) const = default;
	};

	// The road as `shown` has it: a token for each vehicle with onRoad set, its intents from `intents` (empty outside the
	// player's turn), and the arrivals' rows from `arrivals`. Names come from Words (fighterName, vehicleName) with the
	// run's seats.
	[[nodiscard]] RoadPicture roadPicture(
		const rules::BattleState&		 shown,
		const rules::Content&			 content,
		std::span<const rules::Intent>	 intents,
		std::span<const rules::RoadSlot> arrivals,
		std::span<const std::string>	 seats
	);

	// One vehicle's token, as roadPicture fills it.
	[[nodiscard]] TokenData tokenData(
		const rules::BattleState&	   state,
		const rules::Content&		   content,
		rules::VehicleIndex			   vehicle,
		std::span<const rules::Intent> intents,
		std::span<const std::string>   seats
	);

} // namespace game::road
