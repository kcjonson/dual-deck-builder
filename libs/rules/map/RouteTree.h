#pragma once

#include "MoveCost.h"
#include "RoadNetwork.h"

#include <array>
#include <vector>

namespace rules::map {

	// World units an hour by RoadClass at travelPace 1 (realistic-map.md, provisional call 6).
	inline constexpr std::array<double, 3> kRoadSpeeds{260, 160, 90};

	// Hours to drive `length` world units of a class; travelPace multiplies hours per unit for every class alike.
	[[nodiscard]] double hoursFor(double length, RoadClass road, double travelPace);

	// Where two or three ways home end, so a POI can go: a stretch no way home uses whose two ends' ways home split
	// early enough, or a place no way home passes through with exactly three roads, from three different
	// neighbours, whose ways home split pairwise early enough.
	struct MeetingPoint {
		// The stretch, for a meeting point on one; -1 for a three-way point.
		int stretch{-1};
		// The leaf node, for a three-way point; -1 for one on a stretch.
		int node{-1};
		// The nodes its routes arrive from: the stretch's `from` and `to`, or the leaf's three neighbours by stretch
		// id; and the stretch each arrives on, the stretch itself twice or the leaf's three.
		std::vector<int> from;
		std::vector<int> via;
	};

	// Stage 6 of area map generation, the route tree (Area Map Generation, Pipeline, 6. The route tree, and 7's
	// meeting points; route-tree-and-pois.md): every node's way home, its quickest route to the compound over the
	// road network at the classes' speeds, and the meeting points where two or three ways home end. Plain data.
	struct RouteTree {
		// Per node, the stretch its way home leaves on and the next node on it; -1 at the compound and on a node
		// no road reaches.
		std::vector<int> parentStretch;
		std::vector<int> parentNode;
		// Per node, stretches on its way home: 0 at the compound, -1 where no road reaches.
		std::vector<int> depth;
		// Per node, hours home at the map's travel pace; infinity where no road reaches.
		std::vector<double> hours;
		// Per stretch, hours to drive it.
		std::vector<double> stretchHours;
		// Those on stretches by stretch id, then the three-way points by node id.
		std::vector<MeetingPoint> meetingPoints;
	};

	struct RouteTreeArgs {
		const RoadNetwork& network;
		double			   travelPace{1};
		// How far along the shorter of two ways home they may still share road, as a share of its hours.
		double routeSplit{0.5};
	};

	// Dijkstra from the compound, node 0, over the stretches either way. A node's parent is the least of every
	// candidate on (hours, stretch id), so the tree doesn't hang on the heap's order, and hours are found at travel
	// pace 1 and scaled after, so the pace can't tip a tie. Takes no draws and reads only the network, so POIs
	// never move it. A stretch from a node to itself is no road anywhere and is left out.
	[[nodiscard]] RouteTree buildRouteTree(const RouteTreeArgs& args);

	// The node where the ways home of `a` and `b` part, the last they share; -1 when either is unreached.
	[[nodiscard]] int splitNode(const RouteTree& tree, int a, int b);

	// Whether the ways home of `a` and `b` split no later than `routeSplit` of the shorter one's hours (Guarantees
	// 5). One running through the other splits where the other is, which passes only at the compound.
	[[nodiscard]] bool splitsInTime(const RouteTree& tree, int a, int b, double routeSplit);

} // namespace rules::map
