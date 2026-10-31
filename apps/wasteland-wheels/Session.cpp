#include "Session.h"

#include <utility>

namespace game {

	using rules::campaign::MapLayers;

	SessionMap::SessionMap(rules::campaign::CampaignMap made, const GameRules& gameRules)
		: owned(std::make_unique<rules::campaign::CampaignMap>(std::move(made))),
		  mapLayers(rules::campaign::layersOf(owned->map, owned->origin, gameRules.mapContent, gameRules.routes)) {}

	SessionMap::SessionMap(const MapLayers& borrowed)
		: mapLayers(borrowed) {}

	MapMakers rulesMapMakers(const GameRules& gameRules) {
		return MapMakers{
			.found =
				[&gameRules](uint32_t seed, const rules::campaign::MapMaking& making) {
					rules::campaign::CampaignMap made = rules::campaign::makeCampaignMap(seed, gameRules.mapContent, making);
					rules::campaign::MapOrigin	 origin = made.origin;
					return FoundingMap{.origin = std::move(origin), .map = std::make_unique<SessionMap>(std::move(made), gameRules)};
				},
			.load =
				[&gameRules](const nlohmann::json& save, const rules::campaign::MapMaking& making) {
					rules::campaign::LoadedCampaign loaded =
						rules::campaign::loadCampaign(save, gameRules.content, gameRules.mapContent, making);
					rules::campaign::CampaignMap made{.origin = loaded.campaign.mapOrigin, .map = std::move(loaded.map)};
					return Session{.campaign = std::move(loaded.campaign), .map = std::make_unique<SessionMap>(std::move(made), gameRules)};
				},
		};
	}

} // namespace game
