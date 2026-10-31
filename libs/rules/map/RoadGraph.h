#pragma once

#include "Ground.h"
#include "Places.h"
#include "Polyline.h"
#include "RoadLinks.h"
#include "RoadNetwork.h"

#include <span>
#include <vector>

namespace rules::map {

	// A stretch longer than this many world units is split at roadside nodes into pieces no longer.
	inline constexpr double kLongestStretch = 140;

	// Runs between holds left at each detail level, best first: smoothed, smoothed without the relaxing,
	// simplified, and as cells, the last counting the compound's fallback through its cell too.
	struct RoadGraphStats {
		int smoothed{0};
		int unaveraged{0};
		int simplified{0};
		int cells{0};
		// Runs left as cells three moves long or more: a stair step on the map.
		int stairs{0};
		// Holds put where a smoothed run clipped something.
		int splits{0};
	};

	struct RoadGraph {
		std::vector<RoadNode>	 nodes;
		std::vector<RoadStretch> stretches;
		RoadGraphStats			 stats;
	};

	struct RoadGraphArgs {
		const RoadLinks&	   links;
		std::span<const Place> places;
		// The land with its water and hazards, the links' own.
		const Ground& ground;
	};

	// Map 8, the road graph (Area Map Generation, Pipeline, 5. Roads, Geometry; road-network.md, The graph): the
	// links' moves as nodes and stretches. A node is the compound at the origin, a place, a junction, the metro's
	// edge, a class change, a dead end, or a roadside point splitting a long stretch or a loop; every node but the
	// compound and the roadside points stands on a cell centre, so none are closer than a cell. A stretch is the
	// road between two nodes, its cells relaxed, simplified, and smoothed with its nodes and both ends of every
	// bridge held still. Paths that crossed share a cell, so they share a junction and the network is planar.
	//
	// A smoothed run between holds that clips something is held at the cell nearest where it does, and its two
	// halves settled again, so only the cells by the trouble stay cells. A run that clashes with another falls
	// back to its line smoothed without the relaxing, then simplified, then its cells, which the edge cost field
	// already proved; a run out of the compound has one level more, through the centre of the cell it leaves by.
	[[nodiscard]] RoadGraph buildRoadGraph(const RoadGraphArgs& args);

	// A polyline cut into pieces kLongestStretch long or less at even shares of its length, on a point of the line
	// within a world unit of the share or else a point put on its segment there, moved off any bridge to the nearer
	// end of its deck. A point put on a segment lands on one of the segment's samples, a whole number of
	// kPassableSpacing from its lower-left end, so each piece is sampled where the whole line was and passes
	// wherever it passed.
	[[nodiscard]] std::vector<std::vector<Point>> splitLong(std::span<const Point> points, std::span<const RoadBridge> bridges);

} // namespace rules::map
