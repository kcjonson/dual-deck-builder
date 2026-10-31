#pragma once

#include <rules/core/Card.h>
#include <rules/packs/Pack.h>

#include <random/Rng.h>

#include <array>
#include <vector>

namespace rules::campaign {

	// The cards a shop's stock, a fight's reward, or a find offers (Card System Design 1.2 and 1.3).

	struct DropRate {
		Rarity rarity{Rarity::Common};
		int	   weight{0};
	};

	// The rarities on offer, at Card System Design 1.2's drop rates. Starter cards only come in starting decks, and an
	// escort's signature card only with its escort.
	inline constexpr std::array<DropRate, 4> kDropRates{{
		{.rarity = Rarity::Common, .weight = 60},
		{.rarity = Rarity::Uncommon, .weight = 30},
		{.rarity = Rarity::Rare, .weight = 9},
		{.rarity = Rarity::Legendary, .weight = 1},
	}};

	// Whether a card is of a rarity on offer, so a shop sells it and a reward can be it.
	[[nodiscard]] bool isOffered(const CardDefinition& card);

	// `count` different cards, or every one there is when there are fewer: each a rarity drawn at the drop rates among
	// those with a card left to offer, then a card of it evenly, in id order. Order cards are offered only while the
	// convoy has an escort (1.3).
	[[nodiscard]] std::vector<CardId> rollCardOffers(foundation::Rng& rng, const Content& content, int count, bool ownsEscort);

} // namespace rules::campaign
