#pragma once

#include "GameRules.h"

#include <rules/campaign/Campaign.h>
#include <rules/campaign/CampaignMap.h>

#include <nlohmann/json.hpp>

#include <cstdint>
#include <functional>
#include <memory>

namespace game {

	// The area map a campaign is played on, held beside it for its scenes: one founding or a load made, which it owns,
	// or a test's fixture layers, which it borrows. The map is never saved (campaign.md, The map on the campaign).
	class SessionMap {
	  public:
		SessionMap(rules::campaign::CampaignMap made, const GameRules& gameRules);
		explicit SessionMap(const rules::campaign::MapLayers& borrowed);

		SessionMap(const SessionMap&) = delete;
		SessionMap& operator=(const SessionMap&) = delete;
		SessionMap(SessionMap&&) = delete;
		SessionMap& operator=(SessionMap&&) = delete;

		// What a run reads of it.
		[[nodiscard]] const rules::campaign::MapLayers& layers() const { return mapLayers; }
		// The whole map, which the area map view will draw; null for borrowed layers.
		[[nodiscard]] const rules::map::AreaMap* areaMap() const { return owned ? &owned->map : nullptr; }

	  private:
		// Before the layers, which point into it.
		std::unique_ptr<rules::campaign::CampaignMap> owned;
		rules::campaign::MapLayers					  mapLayers;
	};

	// The campaign being played and its map. The campaign is the value play changes and the store saves; the map is
	// what its ids name.
	struct Session {
		rules::campaign::Campaign	campaign;
		std::unique_ptr<SessionMap> map;

		[[nodiscard]] const rules::campaign::MapLayers& layers() const { return map->layers(); }
	};

	// A new campaign's map, before the campaign is founded on it.
	struct FoundingMap {
		rules::campaign::MapOrigin	origin;
		std::unique_ptr<SessionMap> map;
	};

	// What founding and Continue make a map with, each a whole generation run off the frame (map-pipeline-worker.md):
	// the rules' own, or a test's that hands back a fixture at once or waits on its cancel. Each throws what the rules'
	// throw: a rules::ContentError for a save that can't load, a map::MapPipelineError for a seed whose attempts all
	// failed, and a map::MapPipelineCancelled once the making's cancel is asked for.
	struct MapMakers {
		std::function<FoundingMap(uint32_t seed, const rules::campaign::MapMaking& making)>			 found;
		std::function<Session(const nlohmann::json& save, const rules::campaign::MapMaking& making)> load;
	};

	// makeCampaignMap and loadCampaign over the packs, keeping the map they make.
	[[nodiscard]] MapMakers rulesMapMakers(const GameRules& gameRules);

} // namespace game
