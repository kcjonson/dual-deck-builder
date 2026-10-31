#pragma once

#include "Ground.h"

#include <rules/core/JsonReader.h>

#include <array>
#include <optional>
#include <vector>

namespace rules::map {

	enum class RoadClass { Highway, BackRoad, Trail };

	inline constexpr EnumNames<RoadClass, 3> kRoadClassNames{{
		{"highway", RoadClass::Highway},
		{"backRoad", RoadClass::BackRoad},
		{"trail", RoadClass::Trail},
	}};

	// What a move costs a road: in all, and the bridges' share of it.
	struct RoadCost {
		// World units of flat road; infinity where the road can't go.
		double cost{0};
		double bridge{0};
	};

	// The parts of a move's cost no class changes, which each class weighs its own way.
	struct MoveParts {
		// World units.
		double length{0};
		// Rise over run along the move, and across it at its middle.
		double grade{0};
		double across{0};
		// Per bridge outside the metro's, one plus its length over a bridge's span, summed: a class's bridge
		// cost is its own weight times this.
		double bridges{0};
		// It crosses a river on a bridge, the metro's included.
		bool bridged{false};
		// What stands at its middle.
		Obstacle middle{Obstacle::None};
		// No class can take it.
		bool blocked{false};
	};

	// A move between two points whose land's elevation is known, the terrain's own there.
	struct MoveEnds {
		double x0{0};
		double y0{0};
		double x1{0};
		double y1{0};
		double height0{0};
		double height1{0};
	};

	// Where a move runs on a bridge, from `from` to `to` along it, 0 to 1.
	struct BridgeSpan {
		double from{0};
		double to{0};
	};

	// What a road pays to move over the ground (Area Map Generation, Pipeline, 3. Biomes, hazards, and cost;
	// water-and-biomes.md, The cost of a move): the distance, times one plus the grade along the move squared,
	// weighted by class and by curviness, plus the slope across it squared, weighted by class; and a bridge for
	// each river it crosses, dearer the longer the bridge, which keeps crossings short and square-on. Cost along
	// a move, rather than of a point, is what makes roads follow the contours and the valley floors. Highways
	// mind grades most and bridges least.
	class MoveCost {
	  public:
		// The ground has to outlive it.
		MoveCost(const Ground& ground, double curviness);

		// A short move of a few world units, a land cell or so: the ground between its end and its middle isn't
		// sampled. Infinity where its end or middle is impassable, short of river water it bridges, where a
		// bridge would run longer than 24 world units or cross its river under 30 degrees off its line, or where
		// a highway or back road would climb a grade past 1.1. The metro's rivers cost nothing to cross.
		[[nodiscard]] RoadCost cost(double x0, double y0, double x1, double y1, RoadClass road) const;

		// cost's parts, before any class weighs them: blocked wherever it's infinite for every class.
		[[nodiscard]] MoveParts parts(double x0, double y0, double x1, double y1) const;
		// The same where the ends' elevations are already known, as the edge cost field knows its cells'.
		[[nodiscard]] MoveParts parts(const MoveEnds& ends) const;
		// What a class pays for a move with these parts.
		[[nodiscard]] RoadCost weigh(const MoveParts& parts, RoadClass road) const;

	  private:
		const Ground* ground;
		// The grade weight's scale by curviness.
		double gradeScale;

		// The ends' elevations are sampled only once nothing has blocked the move, unless they're given.
		[[nodiscard]] MoveParts
		partsOf(double x0, double y0, double x1, double y1, const std::optional<std::array<double, 2>>& heights) const;
	};

	// The stretches of a move from (x0, y0) to (x1, y1) on a bridge: one for each river it crosses that a road
	// could, reaching the bridge's span either side of where it crosses and a unit past that, the metro's bridges
	// however long. Every class bridges alike.
	[[nodiscard]] std::vector<BridgeSpan> bridgeSpans(const Ground& ground, double x0, double y0, double x1, double y1);

} // namespace rules::map
