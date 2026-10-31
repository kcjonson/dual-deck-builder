#include "Encounter.h"

#include <algorithm>
#include <string>
#include <string_view>

namespace rules {

	namespace {

		// Raiders only ever open in and pull into their formation's six slots, so no cap past that holds anything back.
		constexpr int kMostOnRoad = 6;

		EncounterWave readWave(JsonReader reader, bool first) {
			EncounterWave wave{.raiders = {}, .arriveAt = std::nullopt, .afterTurns = std::nullopt};
			for (std::string& raider : reader.requireStrings("raiders")) {
				wave.raiders.push_back(OpponentId{std::move(raider)});
			}
			if (wave.raiders.empty()) {
				reader.failAt("raiders", "must name at least one raider");
			}
			if (first) {
				for (const std::string_view timing : {"arriveAt", "afterTurns"}) {
					if (reader.has(timing)) {
						reader.failAt(timing, "is for a later wave; the first is on the road when the fight starts");
					}
				}
				reader.finish();
				return wave;
			}
			wave.arriveAt = reader.optionalInt("arriveAt");
			wave.afterTurns = reader.optionalInt("afterTurns");
			reader.finish();
			if (wave.arriveAt && *wave.arriveAt < 0) {
				reader.failAt("arriveAt", "can't be negative");
			}
			if (wave.afterTurns && *wave.afterTurns < 1) {
				reader.failAt("afterTurns", "must be at least 1");
			}
			return wave;
		}

	} // namespace

	EncounterDefinition readEncounter(JsonReader reader) {
		EncounterDefinition encounter{
			.id = EncounterId{reader.requireString("id")},
			.pack = {},
			.skulls = reader.requireInt("skulls"),
			.tiers = reader.requireInts("tiers"),
			.roadCap = reader.requireInt("roadCap"),
			.waves = {},
			.grow = OpponentId{reader.requireString("grow")},
		};
		std::vector<JsonReader> waves = reader.requireObjects("waves");
		for (size_t index = 0; index < waves.size(); ++index) {
			encounter.waves.push_back(readWave(std::move(waves[index]), index == 0));
		}
		reader.finish();
		if (encounter.skulls < 1 || encounter.skulls > kMostSkulls) {
			reader.failAt("skulls", "must be 1 to " + std::to_string(kMostSkulls));
		}
		if (encounter.tiers.empty()) {
			reader.failAt("tiers", "must name at least one tier");
		}
		for (const int tier : encounter.tiers) {
			if (tier < 1 || tier > kMostTier) {
				reader.failAt("tiers", "has " + std::to_string(tier) + ", and tiers are 1 to " + std::to_string(kMostTier));
			}
			if (std::ranges::count(encounter.tiers, tier) > 1) {
				reader.failAt("tiers", "names tier " + std::to_string(tier) + " twice");
			}
		}
		if (encounter.roadCap < 1 || encounter.roadCap > kMostOnRoad) {
			reader.failAt("roadCap", "must be 1 to " + std::to_string(kMostOnRoad) + ", the slots raiders pull into");
		}
		if (encounter.waves.size() < 2) {
			reader.failAt("waves", "needs a wave after the first, since a fight is reinforced partway through");
		}
		if (static_cast<int>(encounter.waves.front().raiders.size()) > encounter.roadCap) {
			reader.failAt(
				"waves[0]",
				"puts " + std::to_string(encounter.waves.front().raiders.size()) + " raiders on the road, past the road cap of " +
					std::to_string(encounter.roadCap)
			);
		}
		return encounter;
	}

} // namespace rules
