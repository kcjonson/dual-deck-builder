#pragma once

#include "Biome.h"
#include "Polyline.h"
#include "RoadNetwork.h"
#include "RouteTree.h"

#include <array>
#include <functional>
#include <span>
#include <vector>

namespace rules::map {

	// A route into a POI: the way home of the node it arrives from, driven outward, then the road in.
	struct Arrival {
		// The node it arrives from.
		int from{0};
		// The stretch it drives into the POI, and world units along it from `from`: the whole stretch into a
		// three-way POI, part of it into one partway along.
		int	   stretch{0};
		double length{0};
		// From the compound to the POI along it.
		double hours{0};
	};

	// Where routes go, as legs are cut for them: a POI's arrivals, quickest first.
	using Destination = std::vector<Arrival>;

	// The arrivals at a POI on a meeting point, quickest first, ties to the lower node: for one on a stretch,
	// `along` world units from the stretch's `from`, strictly inside it, splitting it in two; a three-way point
	// takes 0, and its three roads in whole.
	[[nodiscard]] Destination arrivalsAt(const RoadNetwork& network, const RouteTree& tree, const MeetingPoint& point, double along);

	// A piece of road a leg drives, outward.
	struct LegPiece {
		int stretch{0};
		// Driven the way its points run, `from` to `to`, or against them.
		bool forward{true};
		// World units driven from the end it enters at: the stretch's length, or less into a POI partway along it.
		double length{0};
	};

	// A piece of the route tree between places where something happens to routes: the compound, a place where
	// routes split, or a POI (Area Map Generation, 6. The route tree). The unit stops, knowledge, and hours work
	// in, driven one way only, outward.
	struct Leg {
		// The leg it carries on from, toward the compound; -1 for one leaving the compound. Parents come first.
		int parent{-1};
		// The node it starts at: the compound or a place where routes split.
		int from{0};
		// The node it ends at: a place where routes split, a three-way POI's node, or -1 for a POI partway along a
		// stretch.
		int to{-1};
		// The destination it ends at, by index; -1 where routes split.
		int					  destination{-1};
		std::vector<LegPiece> pieces;
		double				  length{0};
		double				  hours{0};
	};

	// The route tree pruned to what the destinations' routes use, cut into legs.
	struct RouteLegs {
		// Parents first, from the compound, each node's branches in order: the tree on toward higher node ids,
		// then the arrivals leaving it by destination and arrival.
		std::vector<Leg> legs;
		// Per destination, each arrival's last leg, the one into it, in the arrivals' order.
		std::vector<std::vector<int>> lastLegs;
	};

	struct LegArgs {
		const RoadNetwork& network;
		const RouteTree&   tree;
		// No route passes another's POI: at most one on a stretch, and none on a node another's routes pass.
		std::span<const Destination> destinations;
	};

	// The ways home of every arrival's node, cut where two or more ways go on (branches of the pruned tree, and
	// arrivals leaving it) and at the compound, each leg running on along the tree to the next such node, or into
	// its POI where the only way on is an arrival.
	[[nodiscard]] RouteLegs buildLegs(const LegArgs& args);

	// One route to a destination: its legs from the compound out, the one into the POI last, and their totals.
	struct Route {
		std::vector<int> legs;
		double			 length{0};
		double			 hours{0};
	};

	// Each of a destination's routes, in its arrivals' order, by walking parent legs from each one's last leg.
	[[nodiscard]] std::vector<Route> routesTo(const RouteLegs& legs, int destination);

	// A leg's road as one polyline, outward from its first node, ending at the POI where it ends at one.
	[[nodiscard]] std::vector<Point> legPoints(const RoadNetwork& network, const Leg& leg);

	// What a leg's road is made of.
	struct LegProfile {
		// World units of each RoadClass along it...
		std::array<double, 3> classLengths{};
		// ...and of each Biome, sampled at even steps no longer than the step asked for.
		std::array<double, 6> biomeLengths{};
		// The highway with the most length on it, by its index (RoadStretch::highway), ties to the lower; -1 with
		// none.
		int highway{-1};
		// The point halfway along it.
		Point middle;
	};

	// The biome at a point: the ground's, or a test's.
	using BiomeAt = std::function<Biome(Point)>;

	// `biomeStep` is world units, above 0.
	[[nodiscard]] LegProfile profileLeg(const RoadNetwork& network, const Leg& leg, const BiomeAt& biomeAt, double biomeStep);

} // namespace rules::map
