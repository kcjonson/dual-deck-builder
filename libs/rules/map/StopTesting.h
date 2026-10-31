#pragma once

// The rules every stop layer keeps, checked apart from checkStopLayer so the tests pin what the stops do and not only
// what the check says. Tests only: nothing in the library includes it.

#include "Pois.h"
#include "RoadNetwork.h"
#include "RouteLegs.h"
#include "StopChecks.h"
#include "StopData.h"
#include "StopRoom.h"
#include "Stops.h"

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <string>
#include <vector>

namespace rules::map::fixtures {

	// Every stop on its leg's road at its point, within the clearance of the leg's ends, and at least tightGap past the
	// stop before it.
	inline void expectStopsOnTheirLegs(const RoadNetwork& network, const PoiLayer& pois, const StopLayer& layer, const StopTuning& tuning) {
		const std::vector<Leg>& legs = pois.legs.legs;
		ASSERT_EQ(layer.legs.size(), legs.size());
		for (size_t id = 0; id < layer.stops.size(); ++id) {
			const Stop& stop = layer.stops[id];
			ASSERT_GE(stop.leg, 0);
			ASSERT_LT(static_cast<size_t>(stop.leg), legs.size());
			const Leg&	 leg = legs[static_cast<size_t>(stop.leg)];
			const double ends = legEnds(leg.length, tuning);
			EXPECT_GE(stop.along, ends - 1e-9) << "stop " << id;
			EXPECT_LE(stop.along, leg.length - ends + 1e-9) << "stop " << id;
			const Point at = pointAlong(legPoints(network, leg), stop.along);
			EXPECT_NEAR(stop.point.x, at.x, 1e-9) << "stop " << id;
			EXPECT_NEAR(stop.point.y, at.y, 1e-9) << "stop " << id;
			if (id > 0 && layer.stops[id - 1].leg == stop.leg) {
				EXPECT_GE(stop.along - layer.stops[id - 1].along, tuning.tightGap - 1e-9) << "stop " << id;
			}
		}
	}

	// Every route holds its band's fight floor, from game stage 0, on its own road: legs no other POI's routes use.
	inline void expectFloorsOnOwnRoad(const PoiLayer& pois, const StopLayer& layer, const StopTuning& tuning) {
		std::vector<std::vector<Route>> routes;
		for (size_t poi = 0; poi < pois.pois.size(); ++poi) {
			routes.push_back(routesTo(pois.legs, static_cast<int>(poi)));
		}
		const std::vector<int> owners = legOwners(pois.legs.legs.size(), routes);
		for (size_t poi = 0; poi < routes.size(); ++poi) {
			const int floor = bandFor(pois.pois[poi].tier, tuning).fights.min;
			for (size_t place = 0; place < routes[poi].size(); ++place) {
				int own = 0;
				for (const int leg : routes[poi][place].legs) {
					for (const int id : layer.legs[static_cast<size_t>(leg)].stops) {
						own +=
							owners[static_cast<size_t>(leg)] == static_cast<int>(poi) && isFight(layer.stops[static_cast<size_t>(id)].type)
								? 1
								: 0;
					}
				}
				EXPECT_GE(own, floor) << "poi " << poi << " route " << place;
			}
		}
	}

	// Every POI in tiers 1 to 3 has a route whose estimated run, every extra on, is home by dark. The POI stage tiers 4 a
	// POI whose quickest route can't be home carrying its fight floor and a Find: driver (floorRunHours), so the stops
	// stage always can thin one that far.
	inline void expectHomeByDark(const PoiLayer& pois, const StopLayer& layer, const StopTuning& tuning, double daylightHours) {
		for (size_t poi = 0; poi < pois.pois.size(); ++poi) {
			const Poi& destination = pois.pois[poi];
			if (destination.tier > kDaylightTiers) {
				continue;
			}
			const std::vector<Route> routes = routesTo(pois.legs, static_cast<int>(poi));
			bool					 home = false;
			for (size_t place = 0; place < routes.size(); ++place) {
				double stopHours = 0;
				for (const int leg : routes[place].legs) {
					const LegStops& held = layer.legs[static_cast<size_t>(leg)];
					for (const auto* ids : {&held.stops, &held.extras}) {
						for (const int id : *ids) {
							stopHours += tuning.types[static_cast<size_t>(layer.stops[static_cast<size_t>(id)].type)].hours;
						}
					}
				}
				home = home || runHours(destination.arrivals[place].hours, stopHours, objectiveHours(destination, tuning)) <= daylightHours;
			}
			EXPECT_TRUE(home) << "poi " << poi << " (tier " << destination.tier << ") isn't home by dark";
		}
	}

	// Whether two layers hold the same stops, each the same type on the same spot of the same leg, and the same seed for
	// their contents.
	inline bool sameStops(const StopLayer& a, const StopLayer& b) {
		return a.contentSeed == b.contentSeed && a.thinned == b.thinned &&
			   std::ranges::equal(a.stops, b.stops, [](const Stop& left, const Stop& right) {
				   return left.leg == right.leg && left.along == right.along && left.type == right.type && left.skulls == right.skulls &&
						  left.stage == right.stage;
			   });
	}

	// No hard rule broken, and each soft rule broken on a route the layer's failures name.
	inline void expectEveryHardRule(const StopCheckArgs& args) {
		for (const StopViolation& violation : checkStopLayer(args)) {
			if (isHard(violation.rule)) {
				ADD_FAILURE() << violation.detail;
				continue;
			}
			const std::string route = violation.detail.substr(0, violation.detail.find(':'));
			EXPECT_TRUE(std::ranges::any_of(args.stops.failures, [&](const std::string& failure) {
				return failure.starts_with(route + ":");
			})) << violation.detail;
		}
	}

} // namespace rules::map::fixtures
