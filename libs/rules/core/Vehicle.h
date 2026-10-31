#pragma once

#include "JsonReader.h"

#include <string>

namespace rules {

	// A driven vehicle as it comes off the line: a driver's or an opponent's.
	struct VehicleStats {
		std::string name;
		// Relative to the pack's root; empty for none.
		std::string image;
		int			maxStructure{0};
		// How hard it rams.
		int weight{0};
		// Armor it starts a fight with.
		int armor{0};
		// Base speed; the driver's speed skill adds to it.
		int speed{0};
		int gunnery{0};
		int evade{0};

		bool operator==(const VehicleStats&) const = default;
	};

	[[nodiscard]] VehicleStats readVehicleStats(JsonReader reader);

	// The skills a hit check reads, and the speed a driver adds to their vehicle's.
	struct Skills {
		int ramming{0};
		int gunnery{0};
		int evade{0};
		int speed{0};

		bool operator==(const Skills&) const = default;
	};

	[[nodiscard]] Skills readSkills(JsonReader reader);

} // namespace rules
