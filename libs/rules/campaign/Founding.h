#pragma once

#include "Campaign.h"
#include "CampaignRules.h"

#include <rules/packs/Pack.h>

#include <cstdint>
#include <vector>

namespace rules::campaign {

	// The archetypes the loaded packs start unlocked, in id order, which is what founding takes until meta-progression
	// keeps unlocks of its own.
	[[nodiscard]] std::vector<DriverId> unlockedAtStart(const Content& content);

	struct Founding {
		uint32_t seed{0};
		// The archetypes unlocked so far. Repeats and the order they come in change nothing.
		std::vector<DriverId> unlocked;
	};

	// A new campaign (campaign-founding.md), the same one for the same seed and unlocks: the starting pool dealt from the
	// unlocked archetypes, no two alike, each driver at full HP with their vehicle whole and their archetype's starting
	// deck as their default deck; the start's stores, escorts, and buildings; an empty locker; day 1; and the loaded
	// packs named. The deal is the only draw. Throws std::invalid_argument for an archetype no loaded pack defines, or
	// fewer than two different ones, since a run takes two and the pool only grows on runs.
	[[nodiscard]] Campaign foundCampaign(const Content& content, const CampaignRules& rules, const Founding& founding);

} // namespace rules::campaign
