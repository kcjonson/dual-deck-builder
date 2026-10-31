#pragma once

#include "Biome.h"
#include "Ground.h"
#include "MapParams.h"
#include "Places.h"
#include "PoiData.h"
#include "Polyline.h"
#include "RoadNetwork.h"
#include "RouteLegs.h"
#include "RouteTree.h"
#include "StopData.h"

#include <random/Rng.h>

#include <functional>
#include <span>
#include <string>
#include <vector>

namespace rules::map {

	// What the POI stage reads of the land and its places: the ground's, or a test's.
	struct PoiGround {
		// World units: the disc's radius, and the metro's.
		double						 radius{0};
		double						 metroRadius{0};
		std::function<Biome(Point)>	 biome;
		std::function<double(Point)> elevation;
		std::function<double(Point)> moisture;
		std::function<double(Point)> ruin;
	};

	// The land with its water and hazards, and the places' ruins; the places outlive it.
	[[nodiscard]] PoiGround poiGround(const Ground& ground, const Places& places, double radius);

	// Which sector a point is in: sectors start at their boundary and run counterclockwise to the next, `count` of
	// them from `rotation` degrees counterclockwise from east. Plain arithmetic past the boundaries' unit vectors: a
	// point's angle from the first is a diamond angle in its frame, which grows with the true angle.
	class Sectors {
	  public:
		Sectors(double rotation, int count);

		[[nodiscard]] int sectorOf(Point point) const;

	  private:
		Point				startDirection;
		std::vector<double> bounds;

		[[nodiscard]] double angle(Point point) const;
	};

	// Where a POI stands: partway along a meeting stretch, or on a three-way point's node.
	struct PoiSite {
		Point at;
		// The stretch, and world units along it from its `from`; -1 and 0 at a node.
		int	   stretch{-1};
		double along{0};
		// The node, for a three-way point; -1 partway along a stretch.
		int node{-1};
	};

	struct Poi {
		PoiSite site;
		// Its routes' arrivals, quickest first: two, or three at a three-way point.
		Destination arrivals;
		// A key of the tuning's types, which sets its yields, or kStrongholdType.
		std::string type;
		// From the metro's edge out, a stronghold's by where it stands.
		int ring{0};
		// A stand-in until tiers come from hours (stage 8): its ring plus one, a stronghold's 5, or 4 where tiers 1
		// to 3 would leave its quickest route past dark carrying its fight floor and a Find: driver.
		int tier{0};
	};

	struct Stronghold {
		// Its POI, by index.
		int poi{0};
		// A Faction's id, no two alike on a map.
		std::string faction;
		// Counterclockwise from the one that starts at the layer's sectorRotation.
		int sector{0};
	};

	struct RingCount {
		// Its base target times poiDensity, rounded: an aim, not a promise.
		int target{0};
		int placed{0};
		// Of those placed, how many are tier 4 for daylight.
		int promoted{0};
	};

	// Stage 7's product (Area Map Generation, 7. POIs and strongholds): plain data.
	struct PoiLayer {
		// Strongholds first, by sector, then POIs in the order they were placed, best score first. Each is a
		// destination of `legs`, by its index.
		std::vector<Poi>		pois;
		std::vector<Stronghold> strongholds;
		// Degrees counterclockwise from east where sector 0 starts; each spans 360 / strongholds.
		double sectorRotation{0};
		// The route tree pruned to the POIs' routes, cut into legs.
		RouteLegs legs;
		// Per ring, what it aimed for and what it seated. A ring short of its target isn't a failure.
		std::vector<RingCount> rings;
		// Hard guarantees it misses: a sector with no stronghold (Guarantees 6), or a resource the first ring
		// doesn't yield (7). A strict stage fails on any.
		std::vector<std::string> failures;
	};

	struct PoiArgs {
		const RoadNetwork& network;
		const RouteTree&   tree;
		const PoiGround&   ground;
		// Validated: strongholds, poiDensity, and daylightHours are read.
		const MapParams&		 params;
		const PoiTuning&		 tuning;
		std::span<const Faction> factions;
		// Whose bands, gaps, and stop hours say how much own road a route needs.
		const StopTuning& stops;
		// By value, since callers fork it in the call: bound to a reference member there, a Release build drew from
		// a stream already gone.
		foundation::Rng stream;
	};

	// Strongholds, one a sector in the outer band, each on the free meeting point its best untaken faction fits
	// best; then POIs ring by ring, best scored first, kept a spacing apart; each seated only where every route,
	// its own and those seated, keeps own road with room for its need; then types, the first ring's to cover the
	// tuning's resources first; then the legs. Draws on the stream's `sectors`, `factions`, `sites`, and `types`
	// forks. Fewer factions than strongholds is a ContentError.
	[[nodiscard]] PoiLayer placePois(const PoiArgs& args);

} // namespace rules::map
