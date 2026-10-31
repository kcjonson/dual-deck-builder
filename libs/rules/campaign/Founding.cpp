#include "Founding.h"

#include <random/Rng.h>

#include <algorithm>
#include <stdexcept>
#include <string>

namespace rules::campaign {

	namespace {

		void recruit(Campaign& campaign, const DriverDefinition& archetype) {
			CardCounts deck;
			for (const DeckEntry& entry : archetype.startingDeck) {
				addCards(deck, entry.card, entry.count);
			}
			campaign.drivers.push_back(
				DriverRecord{
					.id = CrewId{std::string(kCrewPrefix) + std::to_string(campaign.nextDriverNumber++)},
					.archetype = archetype.id,
					.status = DriverStatus::Ready,
					.hitpoints = archetype.maxHitpoints,
					.injuredDays = 0,
					.vehicle = {.structure = archetype.vehicle.maxStructure, .armor = archetype.vehicle.armor},
					.defaultDeck = std::move(deck),
				}
			);
		}

		void hire(Campaign& campaign, const EscortDefinition& type) {
			campaign.convoy.push_back(
				ConvoyEscort{
					.id = ConvoyId{std::string(kConvoyPrefix) + std::to_string(campaign.nextEscortNumber++)},
					.type = type.id,
					.structure = type.structure,
				}
			);
		}

	} // namespace

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

		Campaign campaign{
			.packs = {},
			.seed = founding.seed,
			.day = 1,
			.stores = rules.start.stores,
			.unrest = 0,
			.buildings = rules.start.buildings,
		};
		for (const PackManifest& pack : content.packs) {
			campaign.packs.push_back(PackRef{.id = pack.id, .version = pack.version});
		}
		// Sorted first, so neither the order they come in nor the order a pack lists them moves a seed's deal.
		foundation::Rng deal = foundation::Rng(founding.seed).fork("founding").fork("pool");
		deal.shuffle(archetypes);
		archetypes.resize(std::min(archetypes.size(), static_cast<size_t>(rules.start.poolSize)));
		for (const DriverId& archetype : archetypes) {
			recruit(campaign, content.drivers.at(archetype));
		}
		for (const EscortId& escort : rules.start.escorts) {
			hire(campaign, content.escorts.at(escort));
		}
		return campaign;
	}

} // namespace rules::campaign
