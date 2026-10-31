#pragma once

#include "Ids.h"
#include "JsonReader.h"

#include <vector>

namespace rules {

	// `count` copies of one card in a deck list, which keeps the order its data gives.
	struct DeckEntry {
		CardId card;
		int	   count{1};

		bool operator==(const DeckEntry&) const = default;
	};

	// A deck list at `key`: [{"card": "point_blank", "count": 3}, ...]. A card listed twice fails.
	[[nodiscard]] std::vector<DeckEntry> readDeckList(JsonReader& reader, std::string_view key);

} // namespace rules
