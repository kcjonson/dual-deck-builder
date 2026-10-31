#pragma once

#include "BattleState.h"

#include <optional>
#include <variant>

namespace rules {

	namespace action {
		struct PlayCard {
			DriverIndex driver;
			int			handIndex{0};
			// For a card played at a vehicle (enemy_single, ally); none for one that isn't.
			std::optional<VehicleIndex> target;
			// For a card that lands on one person aboard (Medical Kit): which of the driver and passenger.
			std::optional<DriverIndex> occupant;
			// For a card whose move goes to a slot the player picks (Juke, Strafe, Shoulder Check): which.
			std::optional<RoadSlot> destination;

			bool operator==(const PlayCard&) const = default;
		};
		// Ends the player's turn, or during the enemy turn the acting raider's part of it.
		struct EndTurn {
			bool operator==(const EndTurn&) const = default;
		};
	} // namespace action

	using Action = std::variant<action::PlayCard, action::EndTurn>;

} // namespace rules
