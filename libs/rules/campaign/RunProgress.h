#pragma once

#include "Campaign.h"
#include "CampaignMap.h"
#include "CampaignRules.h"

#include <rules/map/Stops.h>
#include <rules/packs/Pack.h>

#include <random/Rng.h>

#include <string_view>
#include <vector>

namespace rules::campaign {

	// Where a run on the road is, and moving it on: what the steps down a route (SupplyRun.h, EventStops.h) share.

	// The run on the road's route. Throws std::invalid_argument naming `action` with no run out, or one that hasn't left.
	[[nodiscard]] const RunRoute& routeOnRoad(const Campaign& campaign, std::string_view action);

	// The stop the route is at, by id, and the map's stop. Asserts it's at one.
	[[nodiscard]] int			   stopAt(const RunRoute& route);
	[[nodiscard]] const map::Stop& mapStop(const MapLayers& map, int stop);

	// The leg a route is on, by its place among the route's: the next stop's, or past the last once at the POI.
	[[nodiscard]] int legOn(const RunRoute& route, const MapLayers& map);

	// On past the stop the route is at, whatever was on offer there gone.
	void passStop(RunRoute& route, const MapLayers& map);

	// The run's own stream for a stop, which everything drawn there forks from (call 406), and for the road home, which
	// the return ambush draws on. Assert a run is out.
	[[nodiscard]] foundation::Rng stopStream(const Campaign& campaign, int stop);
	[[nodiscard]] foundation::Rng returnStream(const Campaign& campaign);

	// The reward a won fight, a Find: cards, or an event opens: rewardCards different cards from rollCardOffers on the
	// stream's `reward` fork, order cards only while the convoy has an escort.
	[[nodiscard]] std::vector<CardId>
	rollReward(const foundation::Rng& stream, const Campaign& campaign, const Content& content, const CampaignRules& rules);

} // namespace rules::campaign
