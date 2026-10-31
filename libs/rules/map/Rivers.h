#pragma once

#include "LandGrid.h"
#include "Noise.h"

#include <span>
#include <vector>

namespace rules::map {

	// Where a river rises: the head of a stream, or where a lake drains.
	enum class RiverStart { Source, Lake };
	// Where it ends: joining a bigger one, in a lake, where the region's drainage leaves it, or at a closed
	// basin's sink.
	enum class RiverEnd { Confluence, Lake, Edge, Sink };

	// One river's cells, from its source down to where it ends.
	struct RiverChain {
		// Downstream. A river leaving a lake starts on the lake's last cell, and one ending at a confluence or
		// in a lake ends on the cell it meets.
		std::vector<int> cells;
		RiverStart		 start{RiverStart::Source};
		RiverEnd		 end{RiverEnd::Edge};
		// The river a confluence joins, or the lake a river ends in; -1 otherwise.
		int into{-1};
	};

	struct RiverPoint {
		double x{0};
		double y{0};
		// World units across the water.
		double width{0};
	};

	// A river as the map keeps it.
	struct River {
		RiverChain chain;
		// The rain-weighted area where it ends, before any confluence: how big a river it is.
		double area{0};
		// Its centreline, downstream, with the width at each point: what the map draws, what a save keeps,
		// and where the water is.
		std::vector<RiverPoint> line;
	};

	// Rain-weighted drainage area a cell needs to show as a stream, in cells of average rain, by
	// riverDensity. Area isn't per world unit, and cells are about the same size on any map, so one
	// threshold serves every radius.
	[[nodiscard]] double riverThreshold(double riverDensity);
	// Width across the water, world units, where the rain-weighted drainage area is `area`.
	[[nodiscard]] double riverWidth(double area, double threshold);

	struct TraceArgs {
		std::span<const int>	receivers;
		std::span<const double> area;
		double					threshold{0};
		// The lake each cell lies in, -1 for none.
		std::span<const int> lakeOf;
		// Whether the cells with no receiver are a closed basin's sink rather than the edge.
		bool closedBasin{false};
	};

	// Every river, as chains of cells. A river cell is one whose area passes the threshold and isn't under a
	// lake. At a confluence the river carries on from its biggest tributary, ties to the lower cell, and the
	// others end on the cell where they join, so a main river is one chain from its source to where it
	// leaves and every river cell is in exactly one chain. Chains are listed by their first cell's index.
	[[nodiscard]] std::vector<RiverChain> traceRivers(const TraceArgs& args);

	struct RiverLineArgs {
		LandGrid				grid;
		std::span<const double> area;
		double					threshold{0};
		// The land's elevation per cell: rivers keep to the valley floor where it's steep, and wander where
		// it's flat.
		std::span<const double> elevation;
		// 0 to 1.
		double meander{0};
	};

	// Each chain as a line: its cell centres simplified, less on steep ground, smoothed, resampled a cell
	// apart, given a meander, and smoothed once more, with a width per point by the drainage area there. A
	// tributary is drawn after the river it joins and ends on that river's line, so every confluence touches.
	[[nodiscard]] std::vector<River> drawRivers(std::vector<RiverChain> chains, const RiverLineArgs& args, const NoiseLayer& meander);

} // namespace rules::map
