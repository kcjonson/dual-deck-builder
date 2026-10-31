#pragma once

#include "Ids.h"
#include "JsonReader.h"

#include <optional>
#include <vector>

namespace rules {

	// A fight stop's danger, 1 to 3, and the area map's tiers, 1 to 5 (Runs and Encounters, Fights).
	inline constexpr int kMostSkulls = 3;
	inline constexpr int kMostTier = 5;

	// One of an encounter's waves: its raiders in the order they pull in and act, and for a wave after the first
	// when it's due (Combat Rules, Reinforcements).
	struct EncounterWave {
		std::vector<OpponentId> raiders;
		// Due once the raiders on the road are this many or fewer.
		std::optional<int> arriveAt;
		// Due once this many player turns have passed since the last wave first played (call 193).
		std::optional<int> afterTurns;

		bool operator==(const EncounterWave&) const = default;
	};

	// What a fight stop fields: a group of raiders arriving in waves, for a skull count and the tiers whose roster it
	// draws from (Runs and Encounters, Encounter data).
	struct EncounterDefinition {
		EncounterId id;
		// The pack that defined it, or the last one to override it.
		PackId			 pack;
		int				 skulls{1};
		std::vector<int> tiers;
		// The most raiders on the road at once; the rest of a due wave waits for room.
		int roadCap{0};
		// The first wave, on the road when the fight starts, then the ones queued behind it. At least two, since
		// a fight is reinforced partway through and game stage grows the last.
		std::vector<EncounterWave> waves;
		// The raider game stage queues more of in the last wave.
		OpponentId grow;

		bool operator==(const EncounterDefinition&) const = default;
	};

	[[nodiscard]] EncounterDefinition readEncounter(JsonReader reader);

} // namespace rules
