#pragma once

// Shared by the campaign tests: the base pack's campaign rules, and a campaign founded on them.

#include <rules/battle/BattleTesting.h>
#include <rules/campaign/CampaignRules.h>
#include <rules/campaign/Founding.h>

#include <algorithm>
#include <cassert>
#include <string>
#include <string_view>
#include <vector>

namespace rules::campaigns {

	using namespace rules::campaign;
	using fights::testContent;

	inline const CampaignRules& testRules() {
		static const CampaignRules rules = loadCampaignRules(testContent());
		return rules;
	}

	// Founded on the base pack's start, with `escorts` hired as starters, in roster order.
	inline Campaign foundTestCampaign(std::vector<std::string_view> escorts = {}, uint32_t seed = 7) {
		CampaignRules rules = testRules();
		for (const std::string_view escort : escorts) {
			rules.start.escorts.push_back(EscortId{std::string(escort)});
		}
		return foundCampaign(testContent(), rules, Founding{.seed = seed, .unlocked = unlockedAtStart(testContent())});
	}

	// The first driver in the pool of an archetype.
	inline CrewId crewOf(const Campaign& campaign, std::string_view archetype) {
		const auto found = std::ranges::find(campaign.drivers, DriverId{std::string(archetype)}, &DriverRecord::archetype);
		assert(found != campaign.drivers.end() && "crewOf: the pool has a driver of that archetype");
		return found->id;
	}

	inline CardId card(std::string_view id) {
		return CardId{std::string(id)};
	}

} // namespace rules::campaigns
