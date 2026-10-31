#include "RunProgress.h"

#include "CardOffers.h"

#include <algorithm>
#include <cassert>
#include <stdexcept>
#include <string>

namespace rules::campaign {

	const RunRoute& routeOnRoad(const Campaign& campaign, std::string_view action) {
		if (!campaign.run || !campaign.run->route) {
			throw std::invalid_argument(std::string(action) + ": no run is on the road");
		}
		return *campaign.run->route;
	}

	int stopAt(const RunRoute& route) {
		assert(static_cast<size_t>(route.next) < route.stops.size() && "stopAt: the route is at a stop");
		return route.stops[static_cast<size_t>(route.next)];
	}

	const map::Stop& mapStop(const MapLayers& map, int stop) {
		return map.stops.stops[static_cast<size_t>(stop)];
	}

	int legOn(const RunRoute& route, const MapLayers& map) {
		if (static_cast<size_t>(route.next) >= route.stops.size()) {
			return static_cast<int>(route.legs.size());
		}
		const int leg = mapStop(map, stopAt(route)).leg;
		return static_cast<int>(std::ranges::find(route.legs, leg) - route.legs.begin());
	}

	void passStop(RunRoute& route, const MapLayers& map) {
		++route.next;
		route.reward.clear();
		route.handOff.reset();
		route.leg = legOn(route, map);
	}

	foundation::Rng stopStream(const Campaign& campaign, int stop) {
		assert(campaign.run && "stopStream: a run is out");
		return foundation::Rng(campaign.seed).fork("run", *idNumber(campaign.run->id.value, kRunPrefix)).fork("stop", stop);
	}

	foundation::Rng returnStream(const Campaign& campaign) {
		assert(campaign.run && "returnStream: a run is out");
		return foundation::Rng(campaign.seed).fork("run", *idNumber(campaign.run->id.value, kRunPrefix)).fork("return");
	}

	std::vector<CardId>
	rollReward(const foundation::Rng& stream, const Campaign& campaign, const Content& content, const CampaignRules& rules) {
		foundation::Rng reward = stream.fork("reward");
		return rollCardOffers(reward, content, rules.compound.rewardCards, !campaign.convoy.empty());
	}

} // namespace rules::campaign
