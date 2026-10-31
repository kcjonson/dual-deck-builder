#include "DayClock.h"

#include "CampaignEnd.h"
#include "Infirmary.h"

#include <random/Rng.h>

#include <algorithm>
#include <stdexcept>
#include <string>

namespace rules::campaign {

	namespace {

		DayEnd nightFall(Campaign& campaign, const Content& content, const CampaignRules& rules, const Resources& haul) {
			refuseOver(campaign, "endDay");
			const CompoundRules& compound = rules.compound;
			DayEnd				 night{.day = campaign.day, .haul = haul};
			Resources&			 stores = campaign.stores;
			if (haul != Resources{}) {
				stores = stores + haul;
				addLog(campaign, "A scavenging party brought back " + listed(resourceAmounts(haul)) + ".");
			}

			night.upkeep = upkeepFor(stores.people, compound);
			night.shortfall.food = std::max(0, night.upkeep.food - stores.food);
			night.shortfall.water = std::max(0, night.upkeep.water - stores.water);
			stores.food -= night.upkeep.food - night.shortfall.food;
			stores.water -= night.upkeep.water - night.shortfall.water;
			const int unitsShort = night.shortfall.food + night.shortfall.water;
			night.peopleLost = std::min(stores.people, unitsShort * compound.peopleLostPerUnit);
			night.unrestGained = unitsShort * compound.unrestPerUnit;
			stores.people -= night.peopleLost;
			campaign.unrest += night.unrestGained;

			for (DriverRecord& driver : campaign.drivers) {
				if (driver.status != DriverStatus::Injured) {
					continue;
				}
				healDays(driver, 1, maxHitpointsOf(content, driver));
				if (driver.status == DriverStatus::Ready) {
					night.healed.push_back(driver.id);
				}
			}

			if (unitsShort > 0) {
				const std::string			   shortOf = "Ran short of " + listed(resourceAmounts(night.shortfall));
				const std::vector<std::string> lost = resourceAmounts(Resources{.people = night.peopleLost});
				addLog(campaign, shortOf + (lost.empty() ? "." : "; " + lost.front() + " lost."));
			}
			if (stores.people == 0 && !campaign.run) {
				endCampaign(campaign, compound, EndCause::NoPeople);
			} else {
				++campaign.day;
			}
			return night;
		}

		Need needOf(int stock, int daily) {
			return Need{
				.stock = stock,
				.daily = daily,
				.days = daily > 0 ? std::optional(stock / daily) : std::nullopt,
				.shortTonight = stock < daily,
			};
		}

	} // namespace

	Resources upkeepFor(int people, const CompoundRules& rules) {
		return Resources{
			.food = (people + rules.peoplePerFood - 1) / rules.peoplePerFood,
			.water = (people + rules.peoplePerWater - 1) / rules.peoplePerWater,
		};
	}

	DayEnd endDay(Campaign& campaign, const Content& content, const CampaignRules& rules) {
		return nightFall(campaign, content, rules, Resources{});
	}

	Forecast forecastNeeds(const Resources& stores, const CompoundRules& rules) {
		const Resources daily = upkeepFor(stores.people, rules);
		return Forecast{.food = needOf(stores.food, daily.food), .water = needOf(stores.water, daily.water)};
	}

	std::optional<ScavengeRefusal> scavengeBlocker(const Campaign& campaign) {
		if (campaign.end) {
			return ScavengeRefusal::CampaignOver;
		}
		if (campaign.stores.people == 0) {
			return ScavengeRefusal::Abandoned;
		}
		if (campaign.run) {
			return ScavengeRefusal::RunOut;
		}
		return std::nullopt;
	}

	Resources rollHaul(uint32_t seed, int day, const CompoundRules& rules) {
		foundation::Rng rng = foundation::Rng(seed).fork("scavenge", day);
		const int		fuel = rng.nextInt(rules.scavengedFuel.least, rules.scavengedFuel.most);
		return Resources{.fuel = fuel, .scrap = rng.nextInt(rules.scavengedScrap.least, rules.scavengedScrap.most)};
	}

	DayEnd scavenge(Campaign& campaign, const Content& content, const CampaignRules& rules) {
		if (scavengeBlocker(campaign)) {
			throw std::invalid_argument("scavenge: no party can go out, with the campaign over, nobody at the compound, or a run out");
		}
		return nightFall(campaign, content, rules, rollHaul(campaign.seed, campaign.day, rules.compound));
	}

} // namespace rules::campaign
