#pragma once

#include "Hazards.h"
#include "MapParams.h"
#include "MapPipeline.h"
#include "Places.h"
#include "RoadLinks.h"
#include "Terrain.h"
#include "Water.h"

#include <random/Rng.h>

namespace rules::map {

	// Stage 5 of area map generation, the roads (Area Map Generation, Pipeline, 5. Roads; road-network.md),
	// after the places, on the `roads` stream: the edge cost field over the land with its water and hazards,
	// and the road links between every place over it, as moves on the land grid. Plain data.
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

		[[nodiscard]] const RoadLinks& links() const { return roadLinks; }
		// Independent loops: moves less the cells they join plus the pieces they make, the compound's four cells
		// one. What a road network's POIs need one each of.
		[[nodiscard]] int loops() const { return loopCount; }
		// Towns, villages, and crossroads: the places a loop can run round, where the exits stand on the rim.
		[[nodiscard]] int inland() const { return inlandCount; }
		// Moves the edge cost field worked out.
		[[nodiscard]] int movesWorked() const { return worked; }

	  private:
		RoadLinks roadLinks;
		int		  loopCount{0};
		int		  inlandCount{0};
		int		  worked{0};
	};

	// The loops the POIs want: poiDensity times 30, rounded up, and one for each stronghold.
	[[nodiscard]] int loopsWanted(const MapParams& params);

	// The loops the POIs want, but no more than the map's `inland` places can close: none for the first four,
	// which only branch, then 0.3 of a loop each at loops 0, rising by 0.9 times loops to at most 0.6. A map in
	// the high ranges with a few villages and crossroads can't hold more, whatever the roads do.
	[[nodiscard]] int loopsNeeded(const MapParams& params, int inland);

	// What fails the roads stage: a place no road reaches, or too few loops.
	[[nodiscard]] Problems checkRoads(const Roads& roads, const MapParams& params);

} // namespace rules::map
