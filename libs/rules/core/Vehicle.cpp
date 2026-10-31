#include "Vehicle.h"

namespace rules {

	namespace {

		int readStat(JsonReader& reader, std::string_view key) {
			const int stat = reader.requireInt(key);
			if (stat < 0) {
				reader.failAt(key, "can't be negative");
			}
			return stat;
		}

	} // namespace

	VehicleStats readVehicleStats(JsonReader reader) {
		VehicleStats stats{
			.name = reader.requireString("name"),
			.image = reader.optionalString("image").value_or(""),
			.maxStructure = readStat(reader, "maxStructure"),
			.weight = readStat(reader, "weight"),
			.armor = readStat(reader, "armor"),
			.speed = readStat(reader, "speed"),
			.gunnery = readStat(reader, "gunnery"),
			.evade = readStat(reader, "evade"),
		};
		if (stats.maxStructure < 1) {
			reader.failAt("maxStructure", "must be at least 1");
		}
		reader.finish();
		return stats;
	}

	Skills readSkills(JsonReader reader) {
		const Skills skills{
			.ramming = readStat(reader, "ramming"),
			.gunnery = readStat(reader, "gunnery"),
			.evade = readStat(reader, "evade"),
			.speed = readStat(reader, "speed"),
		};
		reader.finish();
		return skills;
	}

} // namespace rules
