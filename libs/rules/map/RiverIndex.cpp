#include "RiverIndex.h"

#include <cassert>
#include <cstddef>

namespace rules::map {

	namespace {

		// World units across a bucket.
		constexpr double kBucket = 16;

	} // namespace

	RiverIndex::RiverIndex(std::span<const River> rivers, double halfExtent)
		: origin(-halfExtent),
		  columns(std::max(1, static_cast<int>(std::ceil(2 * halfExtent / kBucket)))) {
		for (const River& river : rivers) {
			for (size_t point = 0; point + 1 < river.line.size(); ++point) {
				const RiverPoint& a = river.line[point];
				const RiverPoint& b = river.line[point + 1];
				const double	  reach = 0.5 * std::max(a.width, b.width);
				segments.push_back({
					.ax = a.x,
					.ay = a.y,
					.bx = b.x,
					.by = b.y,
					.widthA = a.width,
					.widthB = b.width,
					.firstColumn = cellOf(std::min(a.x, b.x) - reach),
					.lastColumn = cellOf(std::max(a.x, b.x) + reach),
					.firstRow = cellOf(std::min(a.y, b.y) - reach),
					.lastRow = cellOf(std::max(a.y, b.y) + reach),
				});
			}
		}
		const auto buckets = static_cast<size_t>(columns) * static_cast<size_t>(columns);
		starts.assign(buckets + 1, 0);
		for (const Segment& segment : segments) {
			for (int row = segment.firstRow; row <= segment.lastRow; ++row) {
				for (int column = segment.firstColumn; column <= segment.lastColumn; ++column) {
					starts[static_cast<size_t>(row * columns + column) + 1] += 1;
				}
			}
		}
		for (size_t at = 0; at < buckets; ++at) {
			starts[at + 1] += starts[at];
		}
		ids.resize(static_cast<size_t>(starts[buckets]));
		std::vector<int> cursor(starts.begin(), starts.end() - 1);
		for (size_t id = 0; id < segments.size(); ++id) {
			const Segment& segment = segments[id];
			for (int row = segment.firstRow; row <= segment.lastRow; ++row) {
				for (int column = segment.firstColumn; column <= segment.lastColumn; ++column) {
					ids[static_cast<size_t>(cursor[static_cast<size_t>(row * columns + column)]++)] = static_cast<int>(id);
				}
			}
		}
	}

	bool RiverIndex::contains(double x, double y) const {
		const auto at = static_cast<size_t>(cellOf(y) * columns + cellOf(x));
		for (int entry = starts[at]; entry < starts[at + 1]; ++entry) {
			const Segment& segment = segments[static_cast<size_t>(ids[static_cast<size_t>(entry)])];
			const double   dx = segment.bx - segment.ax;
			const double   dy = segment.by - segment.ay;
			const double   lengthSquared = dx * dx + dy * dy;
			const double t = lengthSquared > 0 ? std::clamp(((x - segment.ax) * dx + (y - segment.ay) * dy) / lengthSquared, 0.0, 1.0) : 0;
			const double ox = segment.ax + dx * t - x;
			const double oy = segment.ay + dy * t - y;
			const double half = 0.5 * (segment.widthA + (segment.widthB - segment.widthA) * t);
			if (ox * ox + oy * oy < half * half) {
				return true;
			}
		}
		return false;
	}

	int RiverIndex::cellOf(double value) const {
		assert(std::isfinite(value) && "RiverIndex: a coordinate is a finite number");
		const double cell = std::floor((value - origin) / kBucket);
		return static_cast<int>(std::clamp(cell, 0.0, static_cast<double>(columns - 1)));
	}

} // namespace rules::map
