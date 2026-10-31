#pragma once

#include "MapParams.h"
#include "RoadNetwork.h"
#include "RouteDescriptors.h"
#include "RouteLegs.h"
#include "StopData.h"
#include "Stops.h"

#include <map>
#include <optional>
#include <set>
#include <vector>

namespace rules::map {

	// What's known of a leg, least first (Compound and Supply Runs, Fog of war).
	enum class LegKnowledge { Uncharted, Rumored, Charted };

	// What's changed on the map since it was made, as plain data the campaign keeps: everything a route reads that
	// isn't the map's own.
	struct MapToday {
		// By leg id, what's known of it; empty for every leg charted, as the map stands until fog.
		std::vector<LegKnowledge> legs;
		// Stops a run cleared, by id, that haven't come back yet.
		std::set<int> cleared;
		// By stop id, how many times a stop has come back, which rolls its contents again; one not here rolls at 0.
		std::map<int, int> rolls;
		// The campaign's game stage, which turns a route's dormant extras on (Runs and Encounters, Game stage).
		int gameStage{0};
	};

	// A stop as a route shows it.
	struct KnownStop {
		int stop{0};
		int leg{0};
		// Its share of its leg.
		double at{0};
		// Its type on a charted leg; none where only that a stop is there is known: on a rumored leg, or the next stop
		// past charted and rumored road.
		std::optional<StopType> type;
		// A known fight's skulls; 0 otherwise.
		int skulls{0};
		// A run cleared it and it isn't back: a run drives past it.
		bool cleared{false};
	};

	// A run's hours: out, its driving and stops, at the objective, and home down the cleared road.
	struct RouteHours {
		double out{0};
		double objective{0};
		double home{0};
	};

	// A route as far as it's known today (Area Map Generation, Routes; stops-and-routes.md, Route descriptors): what the
	// run route screen shows past its name and fuel.
	struct RouteOutlook {
		// Its least known leg.
		LegKnowledge knowledge{LegKnowledge::Charted};
		// In driving order, as far as they're known, its extras on at today's game stage among them.
		std::vector<KnownStop> stops;
		// Unknown stops count unknownStopHours each, and an uncharted leg as many as its road earns.
		RouteHours hours;
		// Hours of the day: home, leaving at dawn, and dark, dawn plus daylightHours; spare is the daylight left, below
		// 0 past dark.
		double back{0};
		double dark{0};
		double spare{0};
		// Its worst known fight still on the road's skulls; 0 with none known.
		int risk{0};
		// A leg on it isn't charted, so its hours are estimates, settled on the drive.
		bool estimated{false};
	};

	struct OutlookArgs {
		const RoadNetwork&	   network;
		const RouteLegs&	   routeLegs;
		const StopLayer&	   stops;
		const RouteDescriptor& route;
		// Its destination's, objectiveHours gives it.
		double objectiveHours{0};
		// Validated: daylightHours and stopDensity are read.
		const MapParams&  params;
		const StopTuning& tuning;
		const MapToday&	  today;
	};

	// A route as far as it's known today. Past its first uncharted leg nothing more is known, so every leg past it
	// counts as uncharted. A cleared stop is shown cleared and still counts in the hours (call 217).
	[[nodiscard]] RouteOutlook outlookOf(const OutlookArgs& args);

	// A leg's stops on the road at a game stage, by id, in driving order: its stops and the extras on by then.
	[[nodiscard]] std::vector<int> stopsAtStage(const LegStops& leg, const StopLayer& layer, int gameStage);

} // namespace rules::map
