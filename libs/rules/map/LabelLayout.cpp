#include "LabelLayout.h"

#include <algorithm>
#include <array>
#include <cassert>
#include <cstddef>
#include <utility>

namespace rules::map {

	namespace {

		bool boxesMeet(const LabelBox& a, const LabelBox& b, double pad) {
			return a.minX < b.maxX + pad && b.minX < a.maxX + pad && a.minY < b.maxY + pad && b.minY < a.maxY + pad;
		}

		bool inside(Point point, const LabelBox& box) {
			return point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;
		}

		// The squared distance from the segment to the box, 0 where it touches or crosses it.
		double segmentBoxDistanceSquared(Point a, Point b, const LabelBox& box) {
			if (inside(a, box) || inside(b, box)) {
				return 0;
			}
			const std::array<Point, 4> corners{{
				{.x = box.minX, .y = box.minY},
				{.x = box.maxX, .y = box.minY},
				{.x = box.maxX, .y = box.maxY},
				{.x = box.minX, .y = box.maxY},
			}};
			double					   nearest = segmentDistanceSquared(a, b, corners[3], corners[0]);
			for (size_t corner = 1; corner < corners.size(); ++corner) {
				nearest = std::min(nearest, segmentDistanceSquared(a, b, corners[corner - 1], corners[corner]));
			}
			return nearest;
		}

		bool pathMeetsBox(const PlacedLabel& line, const LabelBox& box, double reach) {
			for (size_t point = 1; point < line.path.size(); ++point) {
				if (segmentBoxDistanceSquared(line.path[point - 1], line.path[point], box) < reach * reach) {
					return true;
				}
			}
			return false;
		}

		bool pathsMeet(const PlacedLabel& a, const PlacedLabel& b, double reach) {
			for (size_t first = 1; first < a.path.size(); ++first) {
				for (size_t second = 1; second < b.path.size(); ++second) {
					if (segmentDistanceSquared(a.path[first - 1], a.path[first], b.path[second - 1], b.path[second]) < reach * reach) {
						return true;
					}
				}
			}
			return false;
		}

		PlacedLabel boxAround(int label, Point centre, const LabelSize& size) {
			return {
				.label = label,
				.box =
					{
						.minX = centre.x - size.halfLength,
						.minY = centre.y - size.halfHeight,
						.maxX = centre.x + size.halfLength,
						.maxY = centre.y + size.halfHeight,
					},
				.path = {},
				.halfHeight = 0,
			};
		}

		PlacedLabel along(int label, std::vector<Point> path, double halfHeight) {
			LabelBox box{.minX = path.front().x, .minY = path.front().y, .maxX = path.front().x, .maxY = path.front().y};
			for (const Point point : path) {
				box = {
					.minX = std::min(box.minX, point.x),
					.minY = std::min(box.minY, point.y),
					.maxX = std::max(box.maxX, point.x),
					.maxY = std::max(box.maxY, point.y),
				};
			}
			box = {
				.minX = box.minX - halfHeight, .minY = box.minY - halfHeight, .maxX = box.maxX + halfHeight, .maxY = box.maxY + halfHeight
			};
			return {.label = label, .box = box, .path = std::move(path), .halfHeight = halfHeight};
		}

		// Where a label could go, in the order it tries them.
		std::vector<PlacedLabel> spotsFor(int index, const MapLabel& label, const LabelSize& size) {
			if (!label.path.empty()) {
				const double length = polylineLength(label.path);
				if (2 * size.halfLength > length) {
					return {};
				}
				return {along(index, sliceAlong(label.path, length / 2 - size.halfLength, length / 2 + size.halfLength), size.halfHeight)};
			}
			const Point at = label.at;
			if (!(size.offset > 0)) {
				return {boxAround(index, at, size)};
			}
			const double across = size.offset + size.halfLength;
			const double up = size.offset + size.halfHeight;
			return {
				boxAround(index, {.x = at.x + across, .y = at.y}, size),
				boxAround(index, {.x = at.x - across, .y = at.y}, size),
				boxAround(index, {.x = at.x, .y = at.y + up}, size),
				boxAround(index, {.x = at.x, .y = at.y - up}, size),
			};
		}

	} // namespace

	bool labelsMeet(const PlacedLabel& a, const PlacedLabel& b, double pad) {
		if (!boxesMeet(a.box, b.box, pad)) {
			return false;
		}
		if (a.path.empty() && b.path.empty()) {
			return true;
		}
		if (b.path.empty()) {
			return pathMeetsBox(a, b.box, a.halfHeight + pad);
		}
		if (a.path.empty()) {
			return pathMeetsBox(b, a.box, b.halfHeight + pad);
		}
		return pathsMeet(a, b, a.halfHeight + b.halfHeight + pad);
	}

	std::vector<PlacedLabel> placeLabels(const LabelLayoutArgs& args) {
		assert(args.sizes.size() == args.labels.size() && "placeLabels: a size for every label");
		std::vector<PlacedLabel> taken;
		for (const LabelBox& box : args.blocked) {
			taken.push_back({.label = -1, .box = box, .path = {}, .halfHeight = 0});
		}
		std::vector<PlacedLabel> placed;
		for (size_t index = 0; index < args.labels.size(); ++index) {
			for (PlacedLabel& spot : spotsFor(static_cast<int>(index), args.labels[index], args.sizes[index])) {
				const bool clear = std::ranges::none_of(taken, [&](const PlacedLabel& other) { return labelsMeet(spot, other, args.pad); });
				if (clear) {
					taken.push_back(spot);
					placed.push_back(std::move(spot));
					break;
				}
			}
		}
		return placed;
	}

} // namespace rules::map
