#pragma once

#include "Biome.h"
#include "MapParams.h"
#include "MoveCost.h"
#include "Pois.h"
#include "Polyline.h"
#include "RoadNetwork.h"
#include "RouteLegs.h"
#include "StopData.h"
#include "StopTables.h"

#include <random/Rng.h>

#include <cstdint>
#include <string>
#include <vector>

namespace rules::map {

	// A stop, fixed with the map (Area Map Generation, 9. Stops). Its id is its place in the layer's stops: stable for
	// a given map, and what its contents' stream is keyed by.
	struct Stop {
		int leg{0};
		// World units along its leg from the leg's inner end, and that as a share of the leg's length.
		double	 along{0};
		double	 at{0};
		Point	 point;
		StopType type{StopType::Wreck};
		// A fight's danger, 1 to 3, which the route card shows before the stop is revealed; 0 for any other stop.
		int skulls{0};
		// What its type was drawn by: the class of the road it stands on, and the biome there.
		RoadClass roadClass{RoadClass::Highway};
		Biome	  biome{Biome::Scrub};
		// The game stage it's on the road from: 0, or a dormant calm extra's (Runs and Encounters, Game stage).
		int stage{0};
	};

	// What a leg holds.
	struct LegStops {
		// Its stops on from game stage 0, by id, in driving order...
		std::vector<int> stops;
		// ...and its dormant calm extras, each on from its own stage: only a route's own last leg has any.
		std::vector<int> extras;
		// The lowest tier of the POIs whose routes use it, until stage 8 sets tiers in hours (call 10).
		int tier{0};
		// The stop tables' territory: no one's until stage 8 (kNoTerritory).
		std::string territory;
	};

	// Stage 9's product: plain data.
	struct StopLayer {
		// Leg by leg, each leg's in driving order, its extras among them.
		std::vector<Stop> stops;
		// By leg id, one for each of the POI layer's legs.
		std::vector<LegStops> legs;
		// The seed every stop's contents fork from, by its id and roll count (rollStop).
		uint32_t contentSeed{0};
		// How many stops the daylight check took off routes that ran past dark.
		int thinned{0};
		// What the stage couldn't keep and only reports: a route outside its band or short of half its band's least
		// stops on its own road, a POI in tiers 1 to 3 whose quickest route runs past dark with no stops at all, or a
		// Find: driver floor short where no leg in its tiers has room. A route under its fight floor is never here: that
		// fails the stage.
		std::vector<std::string> failures;
	};

	struct StopArgs {
		const RoadNetwork& network;
		const PoiLayer&	   pois;
		const BiomeAt&	   biomeAt;
		// Validated: stopDensity, dangerCurve, driverFinds, and daylightHours are read.
		const MapParams&  params;
		const StopTuning& tuning;
		const StopTables& tables;
		// By value, since callers fork it in the call.
		foundation::Rng stream;
	};

	// Stops on every leg the POIs' routes use, and nowhere else. Each route's stops come to its destination tier's band
	// and its fights to the band's fights, allocated over the route tree parents first, its need (its fight floor and
	// half its band) on its own road; each leg's fights arranged so no route breaks the per-route rules, its stops
	// spread along it clear of its ends and junctions, and each typed from the tables; dormant calm extras on each
	// route's own last leg; then the Find: driver floor and rates, the daylight check (Guarantees 10), and a top-up for
	// routes it left under their band. Draws on the stream's `leg` forks by leg id, then `finds`, `fill`, `rates`, and
	// `contents`, so a change to one never moves another.
	[[nodiscard]] StopLayer placeStops(const StopArgs& args);

	// Per leg, the lowest tier of the POIs whose routes use it.
	[[nodiscard]] std::vector<int> legTiers(const PoiLayer& pois);

	// The stops a leg's road earns before a draw rounds them: for each class along it, its length over the class's
	// spacing, times stopDensity. An estimate counts as many where its stops aren't known.
	[[nodiscard]] double legEarns(const RoadNetwork& network, const Leg& leg, double stopDensity, const StopTuning& tuning);

	// Hours at a destination's objective: a stronghold's, or any other POI's.
	[[nodiscard]] double objectiveHours(const Poi& poi, const StopTuning& tuning);

} // namespace rules::map
