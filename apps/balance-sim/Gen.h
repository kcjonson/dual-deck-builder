#pragma once

#include "Fights.h"
#include "Measures.h"
#include "Neighbors.h"
#include "Runs.h"

#include <rules/map/Pois.h>
#include <rules/map/StopData.h>

#include <nlohmann/json.hpp>

#include <cstdint>
#include <map>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace sim {

	// The balance sim's generator audit (Balance Simulation, gen): maps made from rollParams seeds as founding makes
	// them, every route to every POI read as a run gets it (offersToday on a fresh campaign, game stage 0), and what
	// Runs and Encounters asks of a route measured on each, by destination tier.

	struct GenConfig {
		// rollParams seeds, each a map.
		std::vector<uint32_t> maps;

		bool operator==(const GenConfig&) const = default;
	};

	// Reads a config:
	//
	//   maps   a count, seeds 1 to it, or a list of seeds; 30
	//
	// Anything else fails as a ContentError naming `where` and the path in it.
	[[nodiscard]] GenConfig readGenConfig(const nlohmann::json& config, const std::string& where);

	[[nodiscard]] nlohmann::json genConfigJson(const GenConfig& config);

	// What the audit found on one route.
	struct RouteAudit {
		int			poi{0};
		int			route{0};
		int			tier{1};
		bool		stronghold{false};
		std::string name;
		// The stops a run on it meets, in driving order, and of them the fights' skulls.
		std::vector<rules::map::StopType> stops;
		std::vector<int>				  skulls;
		// Stops of a type no run resolves, which the stops stage never places.
		int unresolved{0};
		// Out, at the objective, and home, and whether that's home past dark, leaving at dawn; the fuel it costs.
		double hours{0};
		bool   pastDark{false};
		int	   fuel{0};
		// Its own road, the legs no other POI's routes use: their length, the stops and fights on them, the most stops
		// they have room for at the stops stage's tight gap, and whether it's the last leg alone.
		int	   ownLegs{0};
		double ownLength{0};
		int	   ownStops{0};
		int	   ownFights{0};
		int	   ownRoom{0};
		bool   ownIsLastLeg{false};
		// Its last leg, into the POI.
		double lastLength{0};
		int	   lastStops{0};
		int	   lastRoom{0};
		// Its POI's nearest neighbor and the neighbor's run for it: how many of its stops that run clears, and the fights it
		// leaves on the road.
		std::optional<Neighbor> neighbor;
		std::optional<int>		neighborRoute;
		int						cleared{0};
		int						fightsLeft{0};

		[[nodiscard]] int fights() const { return static_cast<int>(skulls.size()); }

		bool operator==(const RouteAudit&) const = default;
	};

	// One map's routes audited, and what its POI and stops stages recorded.
	struct MapAudit {
		uint32_t seed{0};
		uint32_t settled{0};
		uint64_t fingerprint{0};
		// Hard guarantees the POIs missed, and what the stops stage couldn't keep and only reports.
		std::vector<std::string> poiFailures;
		std::vector<std::string> stopFailures;
		// Stops the daylight check took off routes that ran past dark.
		int thinned{0};
		// By ring from the metro out, the POIs it aimed for, seated, and seated as tier 4 for daylight.
		std::vector<rules::map::RingCount> rings;
		std::vector<RouteAudit>			   routes;
	};

	// Every route on a map, strongholds' among them, POI by POI and each POI's quickest first.
	[[nodiscard]] MapAudit auditMap(const SimRules& shared, const RunMap& map);

	// One destination tier's routes against its band (Runs and Encounters, How many stops), over every map.
	struct GenTierRow {
		int tier{1};
		int routes{0};
		// The band at game stage 0, its fight floor, and what a route's own road has to hold: the floor or half the
		// band's least stops, whichever is more.
		int	   fewestStops{0};
		int	   mostStops{0};
		int	   fightFloor{0};
		int	   fightCeiling{0};
		int	   ownNeed{0};
		Spread stops;
		Rate   inBand;
		Rate   belowBand;
		Rate   aboveBand;
		Spread fights;
		Rate   noFight;
		Rate   floorMet;
		// Over every stop on the tier's routes, a stop two routes share counted on each.
		std::map<std::string, int> types;
		int						   unresolved{0};
		Spread					   skulls;
		std::optional<double>	   hours;
		Rate					   pastDark;
		// Own road's share of a route's stops, over routes with stops; the routes whose own road holds their fight floor,
		// half their band's least stops, and has room for both; whose own road is the last leg alone; and whose last leg
		// has no room.
		std::optional<double> ownShare;
		Rate				  floorOnOwn;
		Rate				  halfBandOnOwn;
		Rate				  roomForBoth;
		Rate				  ownIsLastLeg;
		Rate				  lastLegNoRoom;
		// The share of a route's stops its neighbor's run clears, over routes with stops and a neighbor, and the routes
		// that run leaves with no fight, over routes with one.
		std::optional<double> neighborClears;
		Rate				  neighborTakesEveryFight;

		bool operator==(const GenTierRow&) const = default;
	};

	// One ring's POIs over every map: aimed for, seated, and seated as tier 4, and how many a map seated.
	struct GenRingRow {
		int	   ring{0};
		int	   target{0};
		int	   placed{0};
		int	   promoted{0};
		Spread perMap;

		bool operator==(const GenRingRow&) const = default;
	};

	struct GenReport {
		GenConfig				config;
		std::vector<MapAudit>	maps;
		std::vector<GenTierRow> tiers;
		std::vector<GenRingRow> rings;
		// Over every map's routes, by type.
		std::map<std::string, int> unresolved;
		double					   seconds{0};
		int						   workers{1};
	};

	// Every map audited, spread over `workers` threads, each map its own.
	[[nodiscard]] GenReport auditMaps(const GenConfig& config, const SimRules& shared, std::span<const RunMap> maps, int workers);

} // namespace sim
