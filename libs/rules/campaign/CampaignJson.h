#pragma once

#include "Campaign.h"

#include <rules/core/JsonReader.h>
#include <rules/packs/Pack.h>

#include <nlohmann/json.hpp>

#include <limits>
#include <string_view>
#include <vector>

namespace rules::campaign {

	// The save format's version: the campaign's JSON carries it, and the game hands it to salal's SaveFormat when it
	// writes the JSON to a slot. Any change to the JSON's shape bumps it, and a save of another version doesn't load.
	inline constexpr int kSaveVersion = 1;

	// The campaign's save (campaign.md, The save). Writing reads the JSON back the way a load would, and throws
	// std::logic_error when this build made a campaign its own save can't hold, so the bug fails where it happened
	// rather than at the next load.
	[[nodiscard]] nlohmann::json writeCampaign(const Campaign& campaign, const Content& content);

	// A save read strictly: this version, every pack it was made with loaded, exactly its fields, every card, driver, and
	// escort it names defined by a loaded pack, and every rule the campaign keeps holding. Anything else throws a
	// ContentError naming the path in the save: "campaign.drivers[1].status".
	[[nodiscard]] Campaign readCampaign(const nlohmann::json& json, const Content& content);

	// What the campaign's pack files share with the save: a whole number in a range, the six stores, each a whole number
	// from 0, and the buildings standing, each once, which come back in building order.
	[[nodiscard]] int		requireIntIn(JsonReader& reader, std::string_view key, int least, int most = std::numeric_limits<int>::max());
	[[nodiscard]] Resources readResources(JsonReader reader);
	[[nodiscard]] std::vector<Building> readBuildings(JsonReader& reader, std::string_view key);

} // namespace rules::campaign
