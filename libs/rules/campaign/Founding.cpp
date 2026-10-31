#include "Founding.h"

#include "Convoy.h"
#include "Garage.h"
#include "Recruits.h"

#include <rules/map/ParamValidator.h>

#include <random/Rng.h>

#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <string>

namespace rules::campaign {

	std::vector<DriverId> unlockedAtStart(const Content& content) {
		std::vector<DriverId> unlocked;
		for (const auto& [id, driver] : content.drivers) {
			if (driver.unlocked) {
				unlocked.push_back(id);
			}
		}
		return unlocked;
	}

	Campaign foundCampaign(const Content& content, const CampaignRules& rules, const Founding& founding) {
		if (!map::validateMapParams(founding.map.params).clamps.empty() || founding.map.stageAttempts.empty()) {
			throw std::invalid_argument("foundCampaign: a map is made on validated params, and its origin names each stage's attempt");
		}
		std::vector<DriverId> archetypes = founding.unlocked;
		std::ranges::sort(archetypes);
		const auto repeats = std::ranges::unique(archetypes);
		archetypes.erase(repeats.begin(), repeats.end());
		for (const DriverId& archetype : archetypes) {
			if (!content.drivers.contains(archetype)) {
				throw std::invalid_argument("foundCampaign: no loaded pack defines driver " + archetype.value);
			}
		}
		if (archetypes.size() < 2) {
			throw std::invalid_argument("foundCampaign: a run takes two drivers, so two different archetypes have to be unlocked");
		}

		const uint32_t seed = founding.map.params.seed;
		Campaign	   campaign{
				  .packs = {},
				  .seed = seed,
				  .mapOrigin = founding.map,
				  .mapState = {},
				  .day = 1,
				  .stores = rules.start.stores,
				  .unrest = 0,
				  .buildings = rules.start.buildings,
		  };
		for (const PackManifest& pack : content.packs) {
			campaign.packs.push_back(PackRef{.id = pack.id, .version = pack.version});
		}
		// Sorted first, so neither the order they come in nor the order a pack lists them moves a seed's deal.
		foundation::Rng deal = foundation::Rng(seed).fork("founding").fork("pool");
		deal.shuffle(archetypes);
		archetypes.resize(std::min(archetypes.size(), static_cast<size_t>(rules.start.poolSize)));
		for (const DriverId& archetype : archetypes) {
			(void)recruitDriver(campaign, content, archetype);
		}
		for (const EscortId& escort : rules.start.escorts) {
			(void)joinConvoy(campaign, content, escort);
		}
		campaign.garage = rollGarageStock(campaign, content, rules.garage);
		addLog(campaign, "Founded the compound.");
		return campaign;
	}

} // namespace rules::campaign
