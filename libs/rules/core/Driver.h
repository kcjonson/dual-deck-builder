#pragma once

#include "Deck.h"
#include "Ids.h"
#include "JsonReader.h"
#include "Vehicle.h"

#include <string>
#include <vector>

namespace rules {

	// A driver archetype the player can recruit, with the vehicle they come with.
	struct DriverDefinition {
		DriverId id;
		// The pack that defined it, or the last one to override it.
		PackId		pack;
		std::string name;
		// A short label, "DEFENSIVE TANK".
		std::string specialty;
		std::string flavorText;
		// Relative to the pack's root; empty for none.
		std::string portrait;
		// Available from a campaign's start; otherwise unlockCondition says how.
		bool				   unlocked{true};
		std::string			   unlockCondition;
		Skills				   skills;
		VehicleStats		   vehicle;
		std::vector<DeckEntry> startingDeck;
		int					   maxHitpoints{0};
		int					   maxAdrenaline{0};
		// How far draws fill the hand.
		int handLimit{0};

		bool operator==(const DriverDefinition&) const = default;
	};

	[[nodiscard]] DriverDefinition readDriver(JsonReader reader);

} // namespace rules
