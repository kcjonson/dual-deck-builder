#pragma once

#include <span>
#include <vector>

// Plane geometry the rivers and the roads share. Everything here is adds, multiplies, divides, square roots, and
// compares, which IEEE doubles round exactly, so a result is the same on every platform and generation can branch
// on it.
namespace rules::map {

	struct Point {
		double x{0};
		double y{0};

		bool operator==(const Point&) const = default;
	};

	// World units along the line from its first point, one for each point.
	[[nodiscard]] std::vector<double> lengthsAlong(std::span<const Point> line);
	[[nodiscard]] double			  polylineLength(std::span<const Point> line);
	// The point `distance` along the line from its first; its last past its length.
	[[nodiscard]] Point pointAlong(std::span<const Point> line, double distance);

	// Chaikin's corner cutting on an open line: each segment's inner quarter points replace its corners, and the
	// ends stay put. A line of one segment comes back as it was.
	[[nodiscard]] std::vector<Point> chaikin(std::span<const Point> line);
	// Douglas-Peucker keeping both ends: every point whose removal would move the line more than its own tolerance
	// stays.
	[[nodiscard]] std::vector<Point> simplify(std::span<const Point> line, std::span<const double> tolerances);
	[[nodiscard]] std::vector<Point> simplify(std::span<const Point> line, double tolerance);

	// The squared distance from p to the segment from a to b.
	[[nodiscard]] double pointSegmentDistanceSquared(Point p, Point a, Point b);
	// The squared distance between the segments ab and cd, zero where they touch or cross (Ericson, Real-Time
	// Collision Detection 5.1.9), parallel ones included.
	[[nodiscard]] double segmentDistanceSquared(Point a, Point b, Point c, Point d);
	// Whether the segments ab and cd share a point, crossing or touching, by the signs of the four orientations:
	// exact for crossings well clear of collinear, which is all a road check needs to tell a crossing from a near
	// miss.
	[[nodiscard]] bool segmentsMeet(Point a, Point b, Point c, Point d);

} // namespace rules::map
