#include "Neighbors.h"

#include <rules/map/RouteOutlook.h>

#include <algorithm>
#include <set>

namespace sim {

	using namespace rules;

	std::vector<int> stopsMet(const campaign::MapLayers& layers, std::span<const int> legs, int stage, std::span<const int> cleared) {
		std::vector<int> stops;
		for (const int leg : legs) {
			for (const int stop : map::stopsAtStage(layers.stops.legs[static_cast<size_t>(leg)], layers.stops, stage)) {
				if (std::ranges::find(cleared, stop) == cleared.end()) {
					stops.push_back(stop);
				}
			}
		}
		return stops;
	}

	std::map<int, Neighbor> nearestNeighbors(std::span<const map::RouteOffer> offers) {
		std::map<int, double>		 lengths;
		std::map<int, std::set<int>> legsOf;
		for (const map::RouteOffer& offer : offers) {
			for (const map::OfferedLeg& leg : offer.legs) {
				lengths[leg.leg] = leg.length;
				legsOf[offer.destination.poi].insert(leg.leg);
			}
		}
		std::map<int, Neighbor> nearest;
		for (const auto& [poi, legs] : legsOf) {
			for (const auto& [other, theirs] : legsOf) {
				double shared = 0;
				for (const int leg : legs) {
					shared += theirs.contains(leg) && other != poi ? lengths.at(leg) : 0.0;
				}
				const auto held = nearest.find(poi);
				if (shared > 0 && (held == nearest.end() || shared > held->second.shared)) {
					nearest[poi] = Neighbor{.poi = other, .shared = shared};
				}
			}
		}
		return nearest;
	}

	std::optional<NeighborRun> neighborRun(
		const campaign::MapLayers&		 layers,
		std::span<const map::RouteOffer> offers,
		int								 neighbor,
		std::span<const int>			 mine,
		int								 stage
	) {
		std::optional<NeighborRun> best;
		size_t					   most = 0;
		for (const map::RouteOffer& theirs : offers) {
			if (theirs.destination.poi != neighbor) {
				continue;
			}
			std::vector<int> met = stopsMet(layers, theirs.route.legs, stage);
			const auto		 clears =
				static_cast<size_t>(std::ranges::count_if(mine, [&](int stop) { return std::ranges::find(met, stop) != met.end(); }));
			if (clears > most) {
				most = clears;
				best = NeighborRun{.poi = neighbor, .route = theirs.route.route, .cleared = std::move(met)};
			}
		}
		return best;
	}

} // namespace sim
