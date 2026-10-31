#pragma once

#include <rules/campaign/CampaignMap.h>
#include <rules/map/RouteOffers.h>

#include <map>
#include <optional>
#include <span>
#include <vector>

namespace sim {

	// A route's stops and its POI's nearest neighbor, as `gen` audits them and `runs` plays behind them (Balance
	// Simulation, gen and runs).

	// The stops a run on these legs meets at a game stage, by id, in driving order, those cleared left out: as depart
	// reads them.
	[[nodiscard]] std::vector<int>
	stopsMet(const rules::campaign::MapLayers& layers, std::span<const int> legs, int stage, std::span<const int> cleared = {});

	// The other POI whose routes share the most road with a POI's routes, by length, and how much they share.
	struct Neighbor {
		int	   poi{0};
		double shared{0};

		bool operator==(const Neighbor&) const = default;
	};

	// Each POI's among the offers' destinations, the lower POI among ties; none for a POI that shares no road.
	[[nodiscard]] std::map<int, Neighbor> nearestNeighbors(std::span<const rules::map::RouteOffer> offers);

	// A neighbor's run for a route: whichever of the neighbor's routes meets the most of the route's stops, quickest
	// first among ties, and every stop it meets, all of them cleared once it's home.
	struct NeighborRun {
		int				 poi{0};
		int				 route{0};
		std::vector<int> cleared;

		bool operator==(const NeighborRun&) const = default;
	};

	// None when no route to the neighbor meets any of `mine`.
	[[nodiscard]] std::optional<NeighborRun> neighborRun(
		const rules::campaign::MapLayers&		layers,
		std::span<const rules::map::RouteOffer> offers,
		int										neighbor,
		std::span<const int>					mine,
		int										stage
	);

} // namespace sim
