#pragma once

#include "Campaign.h"
#include "CampaignRules.h"

#include <rules/packs/Pack.h>

#include <cstdint>
#include <optional>
#include <vector>

namespace rules::campaign {

	// The day clock (day-clock.md) and the scavenging party (scavenging-party.md). A day ends when a run gets home,
	// when one fails (call 64), when the compound rests, and when a party goes out on foot; the caller ends it after
	// the step, as after unloadRun.

	struct DayEnd {
		// The day that ended.
		int day{0};
		// What a scavenging party brought back at dusk.
		Resources haul;
		// What the compound ate, and what it was short of: food and water.
		Resources upkeep;
		Resources shortfall;
		int		  peopleLost{0};
		int		  unrestGained{0};
		// Injured drivers who are fit by dawn.
		std::vector<CrewId> healed;

		bool operator==(const DayEnd&) const = default;
	};

	// Food and water for `people`: one of each per peoplePerFood and peoplePerWater, rounded up (call 109).
	[[nodiscard]] Resources upkeepFor(int people, const CompoundRules& rules);

	// Ends the day, in order: upkeep for the People there at dusk (call 109), each unit short costing people, never more
	// than there are, and unrest (call 110), a day off every injury (call 112), a log line for a short day dated the day
	// that ended (call 113), and the day turns, with the garage's new stock at dawn (call 398). A night that leaves no
	// People with no run out ends the campaign instead, and the day doesn't turn (calls 38 and 39). Throws
	// std::invalid_argument once the campaign is over.
	DayEnd endDay(Campaign& campaign, const Content& content, const CampaignRules& rules);

	struct Need {
		int stock{0};
		int daily{0};
		// Day ends the stock covers in full if nothing changes, 0 when tonight is already short, none with nobody to eat.
		std::optional<int> days;
		bool			   shortTonight{false};

		bool operator==(const Need&) const = default;
	};

	struct Forecast {
		Need food;
		Need water;
	};

	// The needs panel's forecast, "Food runs out in 6 days", exact up to the first short night, since People only
	// changes on one.
	[[nodiscard]] Forecast forecastNeeds(const Resources& stores, const CompoundRules& rules);

	// Why no scavenging party can go: the campaign is over, nobody's left to send (People 0), or a run is out (call 34).
	enum class ScavengeRefusal { CampaignOver, Abandoned, RunOut };

	[[nodiscard]] std::optional<ScavengeRefusal> scavengeBlocker(const Campaign& campaign);

	// What a party brings back on `day`: fuel, then scrap, each evenly in its range, on the seed's fork("scavenge", day),
	// so the button can say the day's exact haul (call 52).
	[[nodiscard]] Resources rollHaul(uint32_t seed, int day, const CompoundRules& rules);

	// Sends a party out for the day (calls 30 to 33): the haul lands at dusk, before upkeep, with its log line, "A
	// scavenging party brought back 2 fuel and 12 scrap.", and the day ends. Throws std::invalid_argument for a party
	// scavengeBlocker refuses.
	DayEnd scavenge(Campaign& campaign, const Content& content, const CampaignRules& rules);

} // namespace rules::campaign
