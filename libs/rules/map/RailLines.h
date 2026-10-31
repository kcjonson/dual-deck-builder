#pragma once

#include "Ground.h"
#include "Polyline.h"
#include "RoadNetwork.h"

#include <random/Rng.h>

#include <vector>

namespace rules::map {

	// A rail line across the region, rim to rim: drawn with the rail pattern, never a road, and never driven.
	struct RailLine {
		std::vector<Point> points;
		// World units along it.
		double length{0};
		// Its decks over rivers, as world units along it from its first point, in order.
		std::vector<RoadBridge> bridges;
	};

	struct RailArgs {
		// The land with its water and hazards.
		const Ground& ground;
		// Lines to lay; fewer where the land leaves no way across.
		int count{0};
		// The rails' stream: the lines' first bearings draw on it, and each line on its own `rail` fork by its index.
		foundation::Rng stream;
	};

	// Rail lines (Area Map Generation, 11. Dressing; dressing.md, Rail lines), long gentle curves rim to rim along the
	// valleys, each searched by least cost on a grid of two land cells to one, on the land the lines before it left.
	// A move costs its length, more for its grade, for standing above the low ground, for range country, near an earlier
	// line, and past 0.88 of the radius, and a river cell costs a crossing; lakes, craters, and cliffs are closed. Each
	// line is simplified and smoothed, the tolerance stepped down where the curve meets ground no road crosses or puts a
	// deck past 30 units, then the cells themselves; it bridges a river where a road could, and its decks merge across
	// gaps of 2 units. A line that finds no way, doubles back, or runs beside an earlier one too long is drawn again, up
	// to six tries, the last without the rim's cost.
	[[nodiscard]] std::vector<RailLine> railLines(const RailArgs& args);

} // namespace rules::map
