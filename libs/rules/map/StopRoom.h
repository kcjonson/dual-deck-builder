#pragma once

#include "RoadNetwork.h"
#include "RouteLegs.h"
#include "StopData.h"

#include <limits>
#include <optional>
#include <span>
#include <vector>

// How many stops a piece of route tree has room for, as the stops stage spaces them (Area Map Generation, 9. Stops;
// route-tree-and-pois.md, Own road): clear of a leg's ends and of junctions partway along it, a gap apart, and half a
// gap in from the ends' clearance. The POI stage seats a POI only where each of its routes' own road has room for its
// need at the tight gap, and the stops stage allocates on the same room, so the two can't disagree.
namespace rules::map {

	// A destination tier's band; a tier past the bands reads as the last.
	[[nodiscard]] const StopBand& bandFor(int tier, const StopTuning& tuning);

	// What a route's own road has to hold: its fight floor or half its band's least stops, whichever is more.
	[[nodiscard]] int ownRoadNeed(int tier, const StopTuning& tuning);

	// POIs in tiers up to this have to be reachable and left in daylight (Guarantees 10).
	inline constexpr int kDaylightTiers = 3;

	// An estimated run, as the daylight check counts it: out and home along the route, its stops, and the objective.
	[[nodiscard]] double runHours(double routeHours, double stopHours, double objectiveHours);

	// The most a route of this tier can be left with once the daylight check has shed all it may: its fight floor,
	// each the costliest fight, and one Find: driver, which a floor can pin to a route.
	[[nodiscard]] double floorRunHours(double routeHours, int tier, double objectiveHours, const StopTuning& tuning);

	// How many roads meet at each node; a stretch from a node to itself is no road.
	[[nodiscard]] std::vector<int> nodeDegrees(const RoadNetwork& network);

	// World units along a leg of each junction partway along it: a node between two of its pieces where three or
	// more roads meet. A class change or a roadside point isn't one.
	[[nodiscard]] std::vector<double> junctionsAlong(const RoadNetwork& network, const Leg& leg, std::span<const int> degrees);

	// World units a stop keeps from either end of a leg this long: the clearance, or a quarter of a short leg.
	[[nodiscard]] double legEnds(double length, const StopTuning& tuning);

	// World units along a leg, from its inner end.
	struct LegSpan {
		double from{0};
		double to{0};
	};

	// Where on a leg this long a stop `gap` from its neighbours can stand: half a gap in from the ends' clearance.
	[[nodiscard]] LegSpan legSpan(double length, double gap, const StopTuning& tuning);

	// The point of [from, to] nearest `target` that keeps `clear` from every junction, the lower of two as near; none
	// where there's none. The nearest such point is the target, an end, or a junction's clearance either side, so
	// those are all it tries.
	[[nodiscard]] std::optional<double> nearestClear(double target, double from, double to, std::span<const double> joins, double clear);

	// The most points of [from, to] at least `gap` apart and `clear` from every junction, packed from `from`, at most
	// `limit`: as many as any spacing fits.
	[[nodiscard]] std::vector<double> packAlong(
		double					from,
		double					to,
		double					gap,
		std::span<const double> joins,
		double					clear,
		size_t					limit = std::numeric_limits<size_t>::max()
	);

	// The most stops a leg this long, with these junctions along it, holds `gap` apart.
	[[nodiscard]] int legRoom(double length, std::span<const double> joins, double gap, const StopTuning& tuning);

	// No POI's routes use the leg, or two or more do.
	inline constexpr int kNoOwner = -1;
	inline constexpr int kShared = -2;

	// Per leg, the one destination whose routes use it, its own road; kNoOwner or kShared otherwise.
	[[nodiscard]] std::vector<int> legOwners(size_t legs, std::span<const std::vector<Route>> routes);

	// Per destination and route, the stops its own road, legs no other destination's routes use, has room for at
	// the tight gap.
	[[nodiscard]] std::vector<std::vector<int>> ownRoadRoom(
		const RoadNetwork&					network,
		std::span<const Leg>				legs,
		std::span<const std::vector<Route>> routes,
		std::span<const int>				degrees,
		const StopTuning&					tuning
	);

} // namespace rules::map
