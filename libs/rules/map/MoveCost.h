#pragma once

#include "Ground.h"

#include <rules/core/JsonReader.h>

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

		// The stretches of the move on a bridge: one for each river it crosses that a road could, reaching the
		// bridge's span either side of where it crosses and a unit past that, the metro's bridges however long.
		[[nodiscard]] std::vector<BridgeSpan> bridgeSpans(double x0, double y0, double x1, double y1) const;

	  private:
		const Ground* ground;
		// The grade weight's scale by curviness.
		double gradeScale;
	};

} // namespace rules::map
