#pragma once

#include "Rivers.h"

#include <algorithm>
#include <cmath>
#include <span>
#include <vector>

namespace rules::map {

	// A river crossing a move.
	struct RiverCrossing {
		// 0 to 1 along the move.
		double along{0};
		// World units across the water there.
		double width{0};
		// The sine of the angle between the move and the river: 1 square-on.
		double sine{0};
	};

	// Where the rivers' water is: their segments filed in square buckets over the land, each listing the
	// segments whose water reaches into it. A point is in a river within half the river's width there of its
	// centreline, the width running straight between a segment's ends. So the picture, a save's lines, and
	// play all read the same water. Queries are const and allocate nothing.
	class RiverIndex {
	  public:
		// No rivers.
		RiverIndex() = default;
		// Over a square reaching `halfExtent` from the compound each way.
		RiverIndex(std::span<const River> rivers, double halfExtent);

		[[nodiscard]] bool contains(double x, double y) const;
		// True within `reach` of a river's water: within half its width there plus `reach` of its centreline.
		[[nodiscard]] bool near(double x, double y, double reach) const;

		// Calls `visit` with each river centreline the move from (x0, y0) to (x1, y1) crosses, once each. A move
		// that only touches a centreline, or runs along one, crosses nothing.
		template <typename Visit>
		void forEachCrossing(double x0, double y0, double x1, double y1, Visit&& visit) const {
			const double mx = x1 - x0;
			const double my = y1 - y0;
			const double moveSquared = mx * mx + my * my;
			if (!(moveSquared > 0)) {
				return;
			}
			const int firstColumn = cellOf(std::min(x0, x1));
			const int lastColumn = cellOf(std::max(x0, x1));
			const int firstRow = cellOf(std::min(y0, y1));
			const int lastRow = cellOf(std::max(y0, y1));
			for (int row = firstRow; row <= lastRow; ++row) {
				for (int column = firstColumn; column <= lastColumn; ++column) {
					const auto at = static_cast<size_t>(row * columns + column);
					for (int entry = starts[at]; entry < starts[at + 1]; ++entry) {
						const Segment& segment = segments[static_cast<size_t>(ids[static_cast<size_t>(entry)])];
						// A segment filed in several of the move's buckets counts in the first of them only.
						if (row != std::max(segment.firstRow, firstRow) || column != std::max(segment.firstColumn, firstColumn)) {
							continue;
						}
						const double sx = segment.bx - segment.ax;
						const double sy = segment.by - segment.ay;
						// Which side of the river each end of the move is on, and of the move each end of the river.
						const double startSide = sx * (y0 - segment.ay) - sy * (x0 - segment.ax);
						const double endSide = sx * (y1 - segment.ay) - sy * (x1 - segment.ax);
						if (!((startSide > 0 && endSide < 0) || (startSide < 0 && endSide > 0))) {
							continue;
						}
						// The river side is half-open, its end counted and its start not, so a move through the
						// point where two segments meet crosses the river once.
						const double fromSide = mx * (segment.ay - y0) - my * (segment.ax - x0);
						const double toSide = mx * (segment.by - y0) - my * (segment.bx - x0);
						if (!((fromSide > 0 && toSide <= 0) || (fromSide < 0 && toSide >= 0))) {
							continue;
						}
						const double alongRiver = fromSide / (fromSide - toSide);
						const double cross = mx * sy - my * sx;
						visit(
							RiverCrossing{
								.along = startSide / (startSide - endSide),
								.width = segment.widthA + (segment.widthB - segment.widthA) * alongRiver,
								.sine = std::abs(cross) / std::sqrt(moveSquared * (sx * sx + sy * sy)),
							}
						);
					}
				}
			}
		}

	  private:
		struct Segment {
			double ax;
			double ay;
			double bx;
			double by;
			double widthA;
			double widthB;
			// The buckets it's filed in.
			int firstColumn;
			int lastColumn;
			int firstRow;
			int lastRow;
		};

		double				 origin{0};
		int					 columns{1};
		std::vector<Segment> segments;
		// Bucket b's segments are ids[starts[b]] up to ids[starts[b + 1]].
		std::vector<int> starts{0, 0};
		std::vector<int> ids;

		// The bucket column holding x, or row holding y, held to the buckets.
		[[nodiscard]] int cellOf(double value) const;
	};

} // namespace rules::map
