#pragma once

#include "Ground.h"
#include "Polyline.h"
#include "RoadNetwork.h"

#include <rules/core/JsonReader.h>

#include <cstddef>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace rules::map {

	enum class RoadRule { Structure, Disc, Passable, Bridges, Crossing, Clearance, Reach };

	inline constexpr EnumNames<RoadRule, 7> kRoadRuleNames{{
		{"structure", RoadRule::Structure},
		{"disc", RoadRule::Disc},
		{"passable", RoadRule::Passable},
		{"bridges", RoadRule::Bridges},
		{"crossing", RoadRule::Crossing},
		{"clearance", RoadRule::Clearance},
		{"reach", RoadRule::Reach},
	}};

	struct RoadViolation {
		RoadRule rule{RoadRule::Structure};
		// What broke and where: stretch and point indices, and coordinates.
		std::string detail;
	};

	// World units two stretches keep apart, tapering toward a node they share: near one, they need only
	// kNodeTaper times the farther one's distance from it, up to the clearance.
	inline constexpr double kRoadClearance = 2;
	inline constexpr double kNodeTaper = 0.25;
	// Two stretches ending on one node leave it 20 degrees apart or more: the cosine.
	inline constexpr double kNodeCosine = 0.9396926207859084;
	// World units between the samples a polyline is checked at for impassable ground, along each segment from its
	// lower-left end whichever way the line runs, so a segment cut at one of its samples is sampled at the same
	// points in its two pieces as whole, and a line through cell centres where the edge cost field sampled it.
	inline constexpr double kPassableSpacing = 0.5;

	// A polyline's bridges over the whole line rather than a segment at a time: each crossing a road could bridge
	// (bridgeSpans), as world units along the line from its first point, the decks that meet or overlap one bridge.
	[[nodiscard]] std::vector<RoadBridge> polylineBridges(const Ground& ground, std::span<const Point> points);

	// World units along a polyline to the first sample on impassable ground, bar river water under one of
	// `bridges`; none where every sample passes. The metro's rivers count, though obstacle passes them, bar on
	// Home's own cells. Each segment's ends are sampled, and the points between every kPassableSpacing from its
	// lower-left end, in the order the line runs.
	[[nodiscard]] std::optional<double>
	impassableAlong(const Ground& ground, std::span<const Point> points, std::span<const RoadBridge> bridges);

	// A road for the planarity sweep: its two nodes and its line.
	struct RoadLine {
		int					   from{0};
		int					   to{0};
		std::span<const Point> points;
	};

	// A pair of lines the planarity sweep found breaking a rule, by index, and the segment of each.
	struct RoadClash {
		RoadRule	rule{RoadRule::Crossing};
		size_t		a{0};
		size_t		b{0};
		size_t		segmentA{0};
		size_t		segmentB{0};
		std::string detail;
	};

	// Every pair of segments within kRoadClearance, found through 16-unit buckets, against the rules: a line's
	// own segments touch only where they join; two lines meet only at a node both end on, leaving it 20 degrees
	// apart or more, and otherwise keep the clearance, tapering toward a node they share. Each pair of lines once
	// for each rule it breaks, or with `bySegment` once for each pair of segments.
	[[nodiscard]] std::vector<RoadClash> roadClashes(std::span<const RoadNode> nodes, std::span<const RoadLine> lines, bool bySegment);

	// Every rule the network breaks, up to `limit`, from its plain data and the ground alone, so a loaded map is
	// checked as one just made (Area Map Generation, Guarantees 3; road-network.md, The checks):
	// - structure: node 0 is the compound at the origin and no other is; each stretch, broken spans included, runs
	//   between two different nodes from the one to the other, with its length, its bridges in order, and a
	//   highway's number on a highway and on nothing else.
	// - disc: every point is inside it.
	// - passable: impassableAlong finds nothing under the stretch's own bridges.
	// - bridges: the stretch's bridges are polylineBridges'.
	// - crossing and clearance: roadClashes.
	// - reach: every node reaches the compound.
	[[nodiscard]] std::vector<RoadViolation> checkRoadNetwork(const RoadNetwork& network, const Ground& ground, size_t limit = 20);

} // namespace rules::map
