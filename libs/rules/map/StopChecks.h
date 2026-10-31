#pragma once

#include "MapParams.h"
#include "Pois.h"
#include "RoadNetwork.h"
#include "StopData.h"
#include "StopTables.h"
#include "Stops.h"

#include <rules/core/JsonReader.h>

#include <span>
#include <string>
#include <vector>

namespace rules::map {

	enum class StopRule { Placement, Clearance, Fights, Calm, Floor, FightBand, Extras, Finds, Daylight, Band, OwnRoad };

	inline constexpr EnumNames<StopRule, 11> kStopRuleNames{{
		{"placement", StopRule::Placement},
		{"clearance", StopRule::Clearance},
		{"fights", StopRule::Fights},
		{"calm", StopRule::Calm},
		{"floor", StopRule::Floor},
		{"fightBand", StopRule::FightBand},
		{"extras", StopRule::Extras},
		{"finds", StopRule::Finds},
		{"daylight", StopRule::Daylight},
		{"band", StopRule::Band},
		{"ownRoad", StopRule::OwnRoad},
	}};

	// A hard rule fails the stops stage; a soft one, band or ownRoad, is only reported.
	[[nodiscard]] constexpr bool isHard(StopRule rule) {
		return rule != StopRule::Band && rule != StopRule::OwnRoad;
	}

	struct StopViolation {
		StopRule	rule{StopRule::Placement};
		std::string detail;
	};

	struct StopCheckArgs {
		const RoadNetwork& network;
		const PoiLayer&	   pois;
		const StopLayer&   stops;
		// Validated: driverFinds and daylightHours are read.
		const MapParams&  params;
		const StopTuning& tuning;
		const StopTables& tables;
	};

	// Every rule the layer breaks, from the map's data alone, so a loaded map is checked as one just made (Area Map
	// Generation, 9. Stops, and Guarantees 9 to 11). It never stops at a limit, since the stage keeps the attempt with
	// the fewest problems. Routes read their stops from game stage 0: a dormant extra only ever adds a calm stop, which
	// breaks no rule, so what holds at stage 0 holds at every stage.
	// - placement: a leg's stops for each leg, its tier its routes' lowest and its territory the tables'; each stop on
	//   its leg, inside it, at its share of it, a type the run resolves, skulls on a fight alone and 1 to 3, listed once
	//   among its leg's stops or extras by its stage; stops leg by leg in driving order.
	// - clearance: each stop its clearance from its leg's ends and every junction partway along it, and tightGap from
	//   the stops either side.
	// - fights: no route has three fights in a row.
	// - calm: every three stops in a row on a route hold a non-fight.
	// - floor: every route holds its band's fight floor, all of it on its own road (Guarantees 11). The one rule a kept
	//   attempt may never break.
	// - fightBand: no route holds more fights than its band's most.
	// - extras: a dormant extra is calm, on a game stage the tuning has, on a route's own last leg.
	// - finds: at least driverFinds Find: driver stops on legs in the floor's tiers, where the map has such a leg.
	// - daylight: every POI in tiers 1 to 3 has a route whose estimated run, every extra on, fits in daylightHours,
	//   unless its quickest runs past dark with no stops at all, which no stop can mend (Guarantees 10).
	// - band, soft: every route's stops in its band.
	// - ownRoad, soft: every route's own road holds half its band's least.
	[[nodiscard]] std::vector<StopViolation> checkStopLayer(const StopCheckArgs& args);

	// The stage's problems: the hard rules broken, each as "rule: detail".
	[[nodiscard]] std::vector<std::string> stopProblems(std::span<const StopViolation> violations);

	// Whether a failing stops attempt, its problems as stopProblems words them, may be kept past the stage's cap:
	// never with a route under its fight floor.
	[[nodiscard]] bool keepableStops(const std::vector<std::string>& problems);

} // namespace rules::map
