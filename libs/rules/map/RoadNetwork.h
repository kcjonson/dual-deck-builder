#pragma once

#include "MoveCost.h"
#include "Polyline.h"
#include "RoadLinks.h"

#include <span>
#include <vector>

namespace rules::map {

	// What happens at a node:
	// - Compound: node 0, at the origin, where every road into the metro ends.
	// - Town, Village, Crossroads, Exit: a place the roads join.
	// - Junction: three or more stretches meet away from a place.
	// - MetroEdge: the last cell inside the metro on a road leaving it, so the stretches inside are city streets.
	// - ClassChange: where a road's class changes along it, a back road giving out to a trail say.
	// - End: a dead end, where a spur trail stops.
	// - Roadside: a point splitting a long stretch, so meeting points and legs have places to fall.
	enum class RoadNodeKind { Compound, Town, Village, Crossroads, Exit, Junction, MetroEdge, ClassChange, End, Roadside };

	struct RoadNode {
		RoadNodeKind kind{RoadNodeKind::Compound};
		double		 x{0};
		double		 y{0};
		// The place it stands for, by id; -1 on a node that's no place.
		int place{-1};
	};

	// Where a stretch crosses a river: its deck, in world units along the stretch's polyline from its first point.
	struct RoadBridge {
		double start{0};
		double end{0};
	};

	// The road between two nodes, of one class: what a route drives, either way.
	struct RoadStretch {
		RoadClass roadClass{RoadClass::Highway};
		int		  from{0};
		int		  to{0};
		// World units along its polyline.
		double length{0};
		// From `from` to `to`, two points or more.
		std::vector<Point> points;
		// In order along it.
		std::vector<RoadBridge> bridges;
		// A city street: wholly inside the metro, charted from the start.
		bool street{false};
		// A highway stretch's number, which the shields show: its exit's order among the highway exits, from 0.
		// Where highways merge into a trunk, the trunk is the first one laid's. -1 on any other class.
		int highway{-1};
	};

	// Every road on the map as plain data a save can hold (Area Map Generation, Pipeline, 5. Roads): nodes where
	// something happens, and stretches between them. A real network with loops, not a tree: a stretch runs either
	// way, and the route tree chooses each place's way home over it.
	struct RoadNetwork {
		// Node 0 is the compound.
		std::vector<RoadNode>	 nodes;
		std::vector<RoadStretch> stretches;
		// Highway spans that collapsed: drawn with their gap, never driven, in no node's stretches.
		std::vector<RoadStretch> broken;
		std::vector<RoadPass>	 passes;
	};

	// Independent loops: stretches less nodes plus the pieces they make. What the POIs need one each of.
	[[nodiscard]] int loopCount(size_t nodes, std::span<const RoadStretch> stretches);

} // namespace rules::map
