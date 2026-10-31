#include "Deck.h"

#include <algorithm>

namespace rules {

	std::vector<DeckEntry> readDeckList(JsonReader& reader, std::string_view key) {
		std::vector<DeckEntry> entries;
		for (JsonReader& object : reader.requireObjects(key)) {
			DeckEntry entry{.card = CardId{object.requireString("card")}, .count = object.requireInt("count")};
			if (entry.count < 1) {
				object.failAt("count", "must be at least 1");
			}
			if (std::ranges::any_of(entries, [&](const DeckEntry& listed) { return listed.card == entry.card; })) {
				object.failAt("card", "\"" + entry.card.value + "\" is already in this list; give it one entry with the full count");
			}
			object.finish();
			entries.push_back(std::move(entry));
		}
		if (entries.empty()) {
			reader.failAt(key, "can't be empty");
		}
		return entries;
	}

} // namespace rules
