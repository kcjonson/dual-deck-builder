#pragma once

#include "AreaMapPipeline.h"
#include "MapParams.h"
#include "MoveCost.h"
#include "Places.h"
#include "PoiData.h"
#include "Pois.h"
#include "RoadNetwork.h"
#include "RouteDescriptors.h"
#include "RouteLegs.h"
#include "RouteOutlook.h"
#include "StopContents.h"
#include "StopData.h"
#include "Stops.h"

#include <array>
#include <optional>
#include <string>
#include <vector>

namespace rules::map {

	// Where a route goes, as a run sets out for it.
	struct OfferedDestination {
		// Its POI, by index.
		int			poi{0};
		std::string name;
		int			tier{0};
		bool		stronghold{false};
		// By Resource, what clearing it yields: its POI type's, meds included; a stronghold's nothing yet (call 22).
		std::array<int, 5> yields{};
	};

	// A stop as a run meets it, whatever the route card knows of it.
	struct OfferedStop {
		int		 stop{0};
		double	 at{0};
		StopType type{StopType::Wreck};
		int		 skulls{0};
		// How many times it's come back, which its contents are rolled at.
		int roll{0};
		// A Find: supplies stop's haul at that roll.
		std::optional<Haul> haul;
		// A run cleared it and it isn't back: a run drives past it.
		bool cleared{false};
	};

	struct OfferedLeg {
		int leg{0};
		// The class most of it is.
		RoadClass roadClass{RoadClass::Highway};
		// World units, and hours of driving it at the map's travel pace.
		double length{0};
		double hours{0};
		// In driving order, its extras on at today's game stage among them.
		std::vector<OfferedStop> stops;
	};

	// One route to one POI, as the run takes it.
	struct RouteOffer {
		OfferedDestination destination;
		// Its place among its POI's routes, its legs, name, class, biome, length, driving hours, and fuel.
		RouteDescriptor route;
		// What's known of it today: the stops the route card shows, its hours, its return against dark, and its risk.
		RouteOutlook outlook;
		// Every leg it drives and every stop on them.
		std::vector<OfferedLeg> legs;
		// The run's risk: its outlook's, and 1 with no fight known, the objective's (call 13).
		int risk{1};
	};

	// A finished map's layers and what's changed on it since. From a generation, network is roads->network(), places,
	// pois, and stops are the products of those names, and biomeAt reads Ground(terrain, water, hazards).
	struct OfferArgs {
		const RoadNetwork& network;
		const Places&	   places;
		const PoiLayer&	   pois;
		const StopLayer&   stops;
		const BiomeAt&	   biomeAt;
		// The validated params the map was made on.
		const MapParams&   params;
		const MapContent&  content;
		const RouteTuning& routes;
		const MapToday&	   today;
	};

	// Every route to every POI, POI by POI and each POI's quickest first (stops-and-routes.md, The run loop's routes):
	// its destination named as poiNames names it, its descriptor and its outlook today, and every stop a run meets
	// on it. Strongholds' routes are among them, and cleared POIs' too; which to offer is the campaign's.
	[[nodiscard]] std::vector<RouteOffer> routeOffers(const OfferArgs& args);

} // namespace rules::map
