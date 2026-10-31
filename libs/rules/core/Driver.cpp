#include "Driver.h"

namespace rules {

	DriverDefinition readDriver(JsonReader reader) {
		DriverDefinition driver{
			.id = DriverId{reader.requireString("id")},
			.pack = {},
			.name = reader.requireString("name"),
			.specialty = reader.requireString("specialty"),
			.flavorText = reader.requireString("flavorText"),
			.portrait = reader.optionalString("portrait").value_or(""),
			.unlocked = reader.requireBool("unlocked"),
			.unlockCondition = reader.optionalString("unlockCondition").value_or(""),
			.skills = readSkills(reader.requireObject("skills")),
			.vehicle = readVehicleStats(reader.requireObject("vehicle")),
			.startingDeck = readDeckList(reader, "startingDeck"),
			.maxHitpoints = reader.requireInt("maxHitpoints"),
			.maxAdrenaline = reader.requireInt("maxAdrenaline"),
			.handLimit = reader.requireInt("handLimit"),
		};
		reader.finish();
		if (!driver.unlocked && driver.unlockCondition.empty()) {
			reader.failAt("unlockCondition", "is required for a driver that starts locked");
		}
		if (driver.maxHitpoints < 1) {
			reader.failAt("maxHitpoints", "must be at least 1");
		}
		if (driver.maxAdrenaline < 0) {
			reader.failAt("maxAdrenaline", "can't be negative");
		}
		if (driver.handLimit < 1) {
			reader.failAt("handLimit", "must be at least 1");
		}
		return driver;
	}

} // namespace rules
