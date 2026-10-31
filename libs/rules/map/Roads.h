#pragma once

#include "Ground.h"
#include "Hazards.h"
#include "MapParams.h"
#include "MapPipeline.h"
#include "Places.h"
#include "RoadGraph.h"
#include "RoadLinks.h"
#include "RoadNetwork.h"
#include "Terrain.h"
#include "Water.h"

#include <random/Rng.h>

#include <span>
#include <vector>

namespace rules::map {

	// Stage 5 of area map generation, the roads (Area Map Generation, Pipeline, 5. Roads; road-network.md),
	// after the places, on the `roads` stream: the edge cost field over the land with its water and hazards, the
	// road links between every place over it (the `links` and `spur` forks), the road graph from them, and the
	// broken highways (the `broken` fork). Plain data.
	class Roads {
	  public:
		// The params are validated, and the layers are theirs; `stream` is this stage's.
		Roads(
			const MapParams&	   params,
			const Terrain&		   terrain,
			const Water&		   water,
			const Hazards&		   hazards,
			const Places&		   places,
			const foundation::Rng& stream
		);

		[[nodiscard]] const RoadNetwork& network() const { return roadNetwork; }
		// The moves the network is drawn from.
		[[nodiscard]] const RoadLinks&		links() const { return roadLinks; }
		[[nodiscard]] const RoadGraphStats& graphStats() const { return graph; }
		// The network's independent loops, the broken spans gone: what its POIs need one each of.
		[[nodiscard]] int loops() const { return networkLoops; }
		// Towns, villages, and crossroads: the places a loop can run round, where the exits stand on the rim.
		[[nodiscard]] int inland() const { return inlandCount; }
		// Moves the edge cost field worked out.
		[[nodiscard]] int movesWorked() const { return worked; }

	  private:
		RoadLinks	   roadLinks;
		RoadNetwork	   roadNetwork;
		RoadGraphStats graph;
		int			   networkLoops{0};
		int			   inlandCount{0};
		int			   worked{0};
	};

	struct BreakArgs {
		std::span<const RoadNode> nodes;
		std::vector<RoadStretch>  stretches;
		std::span<const Place>	  places;
		// brokenHighways.
		int count{0};
		// The disc's, world units.
		int				 radius{0};
		foundation::Rng& rng;
	};

	struct BrokenHighways {
		std::vector<RoadStretch> stretches;
		std::vector<RoadStretch> broken;
	};

	// Highway spans that collapsed (brokenHighways): highway stretches 70 units long or more whose middle point
	// lies past 0.35 of the radius, tried in an order shuffled on `rng`, each taken out only where every node still
	// reaches the compound without it, and where it isn't the last highway stretch ending on a highway exit, so
	// the highway still leaves the area where the map says it does.
	[[nodiscard]] BrokenHighways breakHighways(BreakArgs args);

	// The loops the POIs want: poiDensity times 30, rounded up, and one for each stronghold.
	[[nodiscard]] int loopsWanted(const MapParams& params);

	// The loops the POIs want, but no more than the map's `inland` places can close: none for the first four,
	// which only branch, then 0.3 of a loop each at loops 0, rising by 0.9 times loops to at most 0.6. A map in
	// the high ranges with a few villages and crossroads can't hold more, whatever the roads do.
	[[nodiscard]] int loopsNeeded(const MapParams& params, int inland);

	// What fails the roads stage: a place no road reaches, too few loops, or any rule checkRoadNetwork finds the
	// network breaking on the ground it was laid over.
	[[nodiscard]] Problems checkRoads(const Roads& roads, const MapParams& params, const Ground& ground);

} // namespace rules::map
