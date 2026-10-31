#include "Polyline.h"

#include "MapMath.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <utility>

namespace rules::map {

	namespace {

		// Twice the signed area of (a, b, p): positive when p is left of a to b.
		double orientation(Point a, Point b, Point p) {
			return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
		}

		// Whether p, already on the line through a and b, lies between them.
		bool within(Point a, Point b, Point p) {
			return p.x >= (a.x < b.x ? a.x : b.x) && p.x <= (a.x < b.x ? b.x : a.x) && p.y >= (a.y < b.y ? a.y : b.y) &&
				   p.y <= (a.y < b.y ? b.y : a.y);
		}

	} // namespace

	std::vector<double> lengthsAlong(std::span<const Point> line) {
		std::vector<double> along(line.size());
		for (size_t index = 1; index < line.size(); ++index) {
			const double dx = line[index].x - line[index - 1].x;
			const double dy = line[index].y - line[index - 1].y;
			along[index] = along[index - 1] + std::sqrt(dx * dx + dy * dy);
		}
		return along;
	}

	double polylineLength(std::span<const Point> line) {
		double length = 0;
		for (size_t index = 1; index < line.size(); ++index) {
			const double dx = line[index].x - line[index - 1].x;
			const double dy = line[index].y - line[index - 1].y;
			length += std::sqrt(dx * dx + dy * dy);
		}
		return length;
	}

	Point pointAlong(std::span<const Point> line, double distance) {
		double travelled = 0;
		for (size_t index = 1; index < line.size(); ++index) {
			const double dx = line[index].x - line[index - 1].x;
			const double dy = line[index].y - line[index - 1].y;
			const double segment = std::sqrt(dx * dx + dy * dy);
			if (travelled + segment >= distance && segment > 0) {
				const double share = (distance - travelled) / segment;
				return {.x = line[index - 1].x + dx * share, .y = line[index - 1].y + dy * share};
			}
			travelled += segment;
		}
		return line.back();
	}

	std::vector<Point> chaikin(std::span<const Point> line) {
		if (line.size() < 3) {
			return {line.begin(), line.end()};
		}
		std::vector<Point> smoothed{line.front()};
		for (size_t index = 0; index + 1 < line.size(); ++index) {
			const Point a = line[index];
			const Point b = line[index + 1];
			if (index > 0) {
				smoothed.push_back({.x = 0.75 * a.x + 0.25 * b.x, .y = 0.75 * a.y + 0.25 * b.y});
			}
			if (index + 2 < line.size()) {
				smoothed.push_back({.x = 0.25 * a.x + 0.75 * b.x, .y = 0.25 * a.y + 0.75 * b.y});
			}
		}
		smoothed.push_back(line.back());
		return smoothed;
	}

	std::vector<Point> simplify(std::span<const Point> line, std::span<const double> tolerances) {
		if (line.size() < 3) {
			return {line.begin(), line.end()};
		}
		std::vector<uint8_t>				   keep(line.size());
		std::vector<std::pair<size_t, size_t>> pending;
		pending.emplace_back(0, line.size() - 1);
		keep.front() = 1;
		keep.back() = 1;
		while (!pending.empty()) {
			const auto [first, last] = pending.back();
			pending.pop_back();
			const Point	 a = line[first];
			const double dx = line[last].x - a.x;
			const double dy = line[last].y - a.y;
			const double lengthSquared = dx * dx + dy * dy;
			// Each point's squared distance from the chord over its squared tolerance, times the chord's squared
			// length, so no square root is taken.
			double most = lengthSquared > 0 ? lengthSquared : 1;
			size_t farthest = 0;
			for (size_t index = first + 1; index < last; ++index) {
				const double px = line[index].x - a.x;
				const double py = line[index].y - a.y;
				const double cross = dx * py - dy * px;
				const double away = (lengthSquared > 0 ? cross * cross : px * px + py * py) / (tolerances[index] * tolerances[index]);
				if (away > most) {
					most = away;
					farthest = index;
				}
			}
			if (farthest > 0) {
				keep[farthest] = 1;
				pending.emplace_back(first, farthest);
				pending.emplace_back(farthest, last);
			}
		}
		std::vector<Point> simplified;
		for (size_t index = 0; index < line.size(); ++index) {
			if (keep[index] != 0) {
				simplified.push_back(line[index]);
			}
		}
		return simplified;
	}

	std::vector<Point> simplify(std::span<const Point> line, double tolerance) {
		const std::vector<double> tolerances(line.size(), tolerance);
		return simplify(line, tolerances);
	}

	double pointSegmentDistanceSquared(Point p, Point a, Point b) {
		const double dx = b.x - a.x;
		const double dy = b.y - a.y;
		const double lengthSquared = dx * dx + dy * dy;
		double		 t = 0;
		if (lengthSquared > 0) {
			t = clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared);
		}
		const double ex = a.x + dx * t - p.x;
		const double ey = a.y + dy * t - p.y;
		return ex * ex + ey * ey;
	}

	double segmentDistanceSquared(Point a, Point b, Point c, Point d) {
		const double firstX = b.x - a.x;
		const double firstY = b.y - a.y;
		const double secondX = d.x - c.x;
		const double secondY = d.y - c.y;
		const double offsetX = a.x - c.x;
		const double offsetY = a.y - c.y;
		const double first = firstX * firstX + firstY * firstY;
		const double second = secondX * secondX + secondY * secondY;
		const double along = secondX * offsetX + secondY * offsetY;
		double		 s = 0;
		double		 t = 0;
		if (first == 0 && second == 0) {
			return offsetX * offsetX + offsetY * offsetY;
		}
		if (first == 0) {
			t = clamp01(along / second);
		} else {
			const double back = firstX * offsetX + firstY * offsetY;
			if (second == 0) {
				s = clamp01(-back / first);
			} else {
				const double cross = firstX * secondX + firstY * secondY;
				const double denominator = first * second - cross * cross;
				// Parallel segments have no single closest pair: start from a and let the clamps settle it.
				s = denominator > 0 ? clamp01((cross * along - back * second) / denominator) : 0;
				t = (cross * s + along) / second;
				if (t < 0) {
					t = 0;
					s = clamp01(-back / first);
				} else if (t > 1) {
					t = 1;
					s = clamp01((cross - back) / first);
				}
			}
		}
		const double gapX = offsetX + firstX * s - secondX * t;
		const double gapY = offsetY + firstY * s - secondY * t;
		return gapX * gapX + gapY * gapY;
	}

	bool segmentsMeet(Point a, Point b, Point c, Point d) {
		const double first = orientation(c, d, a);
		const double second = orientation(c, d, b);
		const double third = orientation(a, b, c);
		const double fourth = orientation(a, b, d);
		if (((first > 0 && second < 0) || (first < 0 && second > 0)) && ((third > 0 && fourth < 0) || (third < 0 && fourth > 0))) {
			return true;
		}
		return (first == 0 && within(c, d, a)) || (second == 0 && within(c, d, b)) || (third == 0 && within(a, b, c)) ||
			   (fourth == 0 && within(a, b, d));
	}

} // namespace rules::map
