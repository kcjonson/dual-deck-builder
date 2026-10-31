#include "CardOffers.h"

#include <algorithm>

namespace rules::campaign {

	bool isOffered(const CardDefinition& card) {
		return std::ranges::find(kDropRates, card.rarity, &DropRate::rarity) != kDropRates.end();
	}

	std::vector<CardId> rollCardOffers(foundation::Rng& rng, const Content& content, int count, bool ownsEscort) {
		std::vector<const CardDefinition*> pool;
		for (const auto& [id, card] : content.cards) {
			if (isOffered(card) && (ownsEscort || !card.hasTag("order"))) {
				pool.push_back(&card);
			}
		}
		std::vector<CardId> picks;
		while (static_cast<int>(picks.size()) < count && !pool.empty()) {
			std::vector<foundation::WeightedEntry<Rarity>> rarities;
			for (const DropRate& rate : kDropRates) {
				if (std::ranges::any_of(pool, [&](const CardDefinition* card) { return card->rarity == rate.rarity; })) {
					rarities.push_back({.value = rate.rarity, .weight = static_cast<double>(rate.weight)});
				}
			}
			const Rarity					   rarity = rng.weighted(rarities);
			std::vector<const CardDefinition*> ofRarity;
			std::ranges::copy_if(pool, std::back_inserter(ofRarity), [&](const CardDefinition* card) { return card->rarity == rarity; });
			const CardDefinition* pick = rng.pick(ofRarity);
			picks.push_back(pick->id);
			std::erase(pool, pick);
		}
		return picks;
	}

} // namespace rules::campaign
