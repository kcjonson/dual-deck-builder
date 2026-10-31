#include "RoadChecks.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <set>
#include <string_view>
#include <utility>

namespace rules::map {

	namespace {

		// World units across the planarity sweep's buckets.
		constexpr double kBucket = 16;

		// On Home's own four cells round the origin: the compound can stand in a river, so roads leave it through
		// the water.
		bool atHome(double x, double y, double cell) {
			return x <= cell && x >= -cell && y <= cell && y >= -cell;
		}

		std::string_view classNamed(RoadClass road) {
			for (const auto& [name, value] : kRoadClassNames) {
				if (value == road) {
					return name;
				}
			}
			return "?";
		}

		std::string where(Point point) {
			return "(" + std::to_string(point.x) + ", " + std::to_string(point.y) + ")";
		}

		struct Segment {
			size_t line{0};
			// Its index along its line.
			size_t index{0};
			Point  a;
			Point  b;
			double minX{0};
			double maxX{0};
			double minY{0};
			double maxY{0};
		};

		// The squared distance from a node to a segment: exactly 0 when the segment ends on it, which the
		// projection's rounding can miss.
		double distanceToNode(Point node, const Segment& segment) {
			if (segment.a == node || segment.b == node) {
				return 0;
			}
			return pointSegmentDistanceSquared(node, segment.a, segment.b);
		}

		// Whether two segments both end exactly on the node and leave it at least 20 degrees apart.
		bool meetAtAngle(Point node, const Segment& first, const Segment& second) {
			if ((first.a != node && first.b != node) || (second.a != node && second.b != node)) {
				return false;
			}
			const Point	 away = first.a == node ? first.b : first.a;
			const Point	 other = second.a == node ? second.b : second.a;
			const double ax = away.x - node.x;
			const double ay = away.y - node.y;
			const double bx = other.x - node.x;
			const double by = other.y - node.y;
			return (ax * bx + ay * by) / std::sqrt((ax * ax + ay * ay) * (bx * bx + by * by)) <= kNodeCosine;
		}

		struct PairBreak {
			RoadRule	rule;
			std::string detail;
		};

		// One pair of segments against the rules, or nothing where they keep them.
		std::optional<PairBreak>
		checkPair(std::span<const RoadNode> nodes, std::span<const RoadLine> lines, const Segment& first, const Segment& second) {
			const double clearance = kRoadClearance;
			if (second.minY > first.maxY + clearance || first.minY > second.maxY + clearance || second.minX > first.maxX + clearance ||
				first.minX > second.maxX + clearance) {
				return std::nullopt;
			}
			const double distanceSquared = segmentDistanceSquared(first.a, first.b, second.a, second.b);
			if (distanceSquared >= clearance * clearance) {
				return std::nullopt;
			}
			const std::string at = "lines " + std::to_string(first.line) + " and " + std::to_string(second.line) + ", segments " +
								   std::to_string(first.index) + " and " + std::to_string(second.index) + ", near " + where(first.b);
			const auto meet = [&] {
				return segmentsMeet(first.a, first.b, second.a, second.b);
			};
			if (first.line == second.line) {
				if (first.index + 1 == second.index || second.index + 1 == first.index) {
					return std::nullopt;
				}
				const RoadLine& line = lines[first.line];
				// A loop's two ends meet at its node.
				if (line.from == line.to && ((first.index == 0 && second.b == first.a) || (second.index == 0 && first.b == second.a))) {
					return std::nullopt;
				}
				if (meet()) {
					return PairBreak{.rule = RoadRule::Crossing, .detail = "a line touches itself at " + at};
				}
				return std::nullopt;
			}
			const RoadLine&	   a = lines[first.line];
			const RoadLine&	   b = lines[second.line];
			std::array<int, 2> shared{};
			size_t			   sharedCount = 0;
			for (const int node : {a.from, a.to}) {
				if (node == b.from || node == b.to) {
					shared[sharedCount++] = node;
				}
			}
			const std::string apart = std::to_string(std::sqrt(distanceSquared)) + " apart";
			if (sharedCount == 0) {
				return PairBreak{.rule = meet() ? RoadRule::Crossing : RoadRule::Clearance, .detail = apart + " at " + at};
			}
			double gap = clearance;
			int	   near = shared[0];
			for (size_t index = 0; index < sharedCount; ++index) {
				const RoadNode& node = nodes[static_cast<size_t>(shared[index])];
				const Point		point{.x = node.x, .y = node.y};
				const double	reach =
					std::min(clearance, kNodeTaper * std::sqrt(std::max(distanceToNode(point, first), distanceToNode(point, second))));
				if (reach < gap) {
					gap = reach;
					near = shared[index];
				}
			}
			if (gap > 0) {
				if (distanceSquared < gap * gap) {
					return PairBreak{
						.rule = meet() ? RoadRule::Crossing : RoadRule::Clearance,
						.detail = apart + ", under " + std::to_string(gap) + " near node " + std::to_string(near) + ", at " + at,
					};
				}
				return std::nullopt;
			}
			const RoadNode& node = nodes[static_cast<size_t>(near)];
			if (meetAtAngle({.x = node.x, .y = node.y}, first, second)) {
				return std::nullopt;
			}
			return PairBreak{
				.rule = RoadRule::Crossing,
				.detail = "meet at node " + std::to_string(near) + " other than end to end 20 degrees apart, at " + at,
			};
		}

		class Report {
		  public:
			explicit Report(size_t most)
				: limit(most) {}

			void operator()(RoadRule rule, std::string detail) {
				if (found.size() < limit) {
					found.push_back({.rule = rule, .detail = std::move(detail)});
				}
			}

			[[nodiscard]] bool						 any() const { return !found.empty(); }
			[[nodiscard]] std::vector<RoadViolation> take() { return std::move(found); }

		  private:
			size_t					   limit;
			std::vector<RoadViolation> found;
		};

		void checkStructure(const RoadNetwork& network, Report& report) {
			const auto& nodes = network.nodes;
			if (nodes.empty() || nodes[0].kind != RoadNodeKind::Compound || nodes[0].x != 0 || nodes[0].y != 0) {
				report(RoadRule::Structure, "node 0 is not the compound at the origin");
				return;
			}
			for (size_t id = 1; id < nodes.size(); ++id) {
				if (nodes[id].kind == RoadNodeKind::Compound) {
					report(RoadRule::Structure, "node " + std::to_string(id) + " is a second compound");
				}
			}
			const auto count = static_cast<int>(nodes.size());
			const auto check = [&](const RoadStretch& stretch, const std::string& id) {
				if (!(stretch.from >= 0 && stretch.from < count && stretch.to >= 0 && stretch.to < count && stretch.from != stretch.to)) {
					report(
						RoadRule::Structure,
						id + " runs between nodes " + std::to_string(stretch.from) + " and " + std::to_string(stretch.to)
					);
					return;
				}
				const bool numbered = stretch.highway >= 0;
				if (stretch.roadClass == RoadClass::Highway ? !numbered : stretch.highway != -1) {
					report(
						RoadRule::Structure,
						id + ", a " + std::string(classNamed(stretch.roadClass)) + ", has highway number " + std::to_string(stretch.highway)
					);
				}
				const auto& points = stretch.points;
				const bool	finite =
					std::ranges::all_of(points, [](const Point& point) { return std::isfinite(point.x) && std::isfinite(point.y); });
				if (points.size() < 2 || !finite) {
					report(RoadRule::Structure, id + " has " + std::to_string(points.size()) + " points, or one that isn't finite");
					return;
				}
				const RoadNode& from = nodes[static_cast<size_t>(stretch.from)];
				const RoadNode& to = nodes[static_cast<size_t>(stretch.to)];
				if (points.front() != Point{.x = from.x, .y = from.y}) {
					report(RoadRule::Structure, id + " doesn't start at node " + std::to_string(stretch.from));
				}
				if (points.back() != Point{.x = to.x, .y = to.y}) {
					report(RoadRule::Structure, id + " doesn't end at node " + std::to_string(stretch.to));
				}
				const double length = polylineLength(points);
				if (!(std::abs(length - stretch.length) <= 1e-9 * length + 1e-9)) {
					report(
						RoadRule::Structure,
						id + " is " + std::to_string(length) + " long, not the " + std::to_string(stretch.length) + " it says"
					);
				}
				double last = 0;
				for (size_t bridge = 0; bridge < stretch.bridges.size(); ++bridge) {
					const RoadBridge& deck = stretch.bridges[bridge];
					if (!(deck.start >= last && deck.end > deck.start && deck.end <= length)) {
						report(
							RoadRule::Structure,
							id + "'s bridge " + std::to_string(bridge) + " runs from " + std::to_string(deck.start) + " to " +
								std::to_string(deck.end) + ", out of order or off its " + std::to_string(length) + " units"
						);
					}
					last = deck.end;
				}
			};
			for (size_t index = 0; index < network.stretches.size(); ++index) {
				check(network.stretches[index], "stretch " + std::to_string(index));
			}
			for (size_t index = 0; index < network.broken.size(); ++index) {
				check(network.broken[index], "broken span " + std::to_string(index));
			}
		}

		void checkGround(const RoadNetwork& network, const Ground& ground, Report& report) {
			const double radius = ground.terrain().radius();
			for (size_t id = 0; id < network.stretches.size(); ++id) {
				const RoadStretch& stretch = network.stretches[id];
				const std::string  name = "stretch " + std::to_string(id);
				for (size_t index = 0; index < stretch.points.size(); ++index) {
					const Point point = stretch.points[index];
					if (point.x * point.x + point.y * point.y > radius * radius) {
						report(RoadRule::Disc, name + " point " + std::to_string(index) + " " + where(point) + " is outside the disc");
					}
				}
				const std::vector<RoadBridge> found = polylineBridges(ground, stretch.points);
				const bool					  same = found.size() == stretch.bridges.size() &&
								  std::ranges::equal(found, stretch.bridges, [](const RoadBridge& a, const RoadBridge& b) {
									  return std::abs(a.start - b.start) <= 1e-6 && std::abs(a.end - b.end) <= 1e-6;
								  });
				if (!same) {
					report(
						RoadRule::Bridges,
						name + " records " + std::to_string(stretch.bridges.size()) + " bridges, but its polyline crosses rivers at " +
							std::to_string(found.size())
					);
				}
				if (const std::optional<double> blocked = impassableAlong(ground, stretch.points, stretch.bridges)) {
					report(
						RoadRule::Passable,
						name + " is impassable " + std::to_string(*blocked) + " units along, at " +
							where(pointAlong(stretch.points, *blocked))
					);
				}
			}
		}

		void checkReach(const RoadNetwork& network, Report& report) {
			const auto&						 nodes = network.nodes;
			std::vector<std::vector<size_t>> linked(nodes.size());
			for (const RoadStretch& stretch : network.stretches) {
				linked[static_cast<size_t>(stretch.from)].push_back(static_cast<size_t>(stretch.to));
				linked[static_cast<size_t>(stretch.to)].push_back(static_cast<size_t>(stretch.from));
			}
			std::vector<uint8_t> reached(nodes.size());
			std::vector<size_t>	 pending{0};
			reached[0] = 1;
			while (!pending.empty()) {
				const size_t node = pending.back();
				pending.pop_back();
				for (const size_t next : linked[node]) {
					if (reached[next] == 0) {
						reached[next] = 1;
						pending.push_back(next);
					}
				}
			}
			for (size_t id = 0; id < nodes.size(); ++id) {
				if (reached[id] == 0) {
					report(
						RoadRule::Reach,
						"node " + std::to_string(id) + " at " + where({.x = nodes[id].x, .y = nodes[id].y}) + " doesn't reach the compound"
					);
				}
			}
		}

	} // namespace

	std::vector<RoadBridge> polylineBridges(const Ground& ground, std::span<const Point> points) {
		std::vector<RoadBridge> decks;
		double					along = 0;
		for (size_t index = 1; index < points.size(); ++index) {
			const Point	 a = points[index - 1];
			const Point	 b = points[index];
			const double length = std::sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
			for (const BridgeSpan& span : bridgeSpans(ground, a.x, a.y, b.x, b.y)) {
				decks.push_back({.start = along + span.from * length, .end = along + span.to * length});
			}
			along += length;
		}
		std::ranges::stable_sort(decks, [](const RoadBridge& first, const RoadBridge& second) { return first.start < second.start; });
		std::vector<RoadBridge> merged;
		for (const RoadBridge& deck : decks) {
			const double start = std::max(deck.start, 0.0);
			const double end = std::min(deck.end, along);
			if (!merged.empty() && start <= merged.back().end) {
				merged.back().end = std::max(end, merged.back().end);
			} else {
				merged.push_back({.start = start, .end = end});
			}
		}
		return merged;
	}

	std::optional<double> impassableAlong(const Ground& ground, std::span<const Point> points, std::span<const RoadBridge> bridges) {
		const double home = ground.terrain().surface().grid.cellSize;
		const auto	 blocked = [&](Point point, double at) {
			  const Obstacle obstacle = ground.obstacle(point.x, point.y);
			  if (obstacle == Obstacle::None) {
				  if (!(ground.bridged(point.x, point.y) && ground.waterAt(point.x, point.y) == WaterKind::River)) {
					  return false;
				  }
			  } else if (obstacle != Obstacle::River) {
				  return true;
			  }
			  const bool decked = std::ranges::any_of(bridges, [&](const RoadBridge& deck) { return at >= deck.start && at <= deck.end; });
			  return !(atHome(point.x, point.y, home) || decked);
		};
		if (points.empty()) {
			return std::nullopt;
		}
		if (blocked(points.front(), 0)) {
			return 0.0;
		}
		double along = 0;
		for (size_t index = 1; index < points.size(); ++index) {
			const Point	 a = points[index - 1];
			const Point	 b = points[index];
			const double length = std::sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
			const bool	 forward = a.x < b.x || (a.x == b.x && a.y <= b.y);
			const Point	 start = forward ? a : b;
			const Point	 end = forward ? b : a;
			const auto	 inner = static_cast<int>(std::ceil(length / kPassableSpacing)) - 1;
			// The samples between in the order the line runs, then the segment's end.
			for (int sample = 1; sample <= inner; ++sample) {
				const int	 step = forward ? sample : inner + 1 - sample;
				const double share = step * kPassableSpacing / length;
				const double at = along + (forward ? share : 1 - share) * length;
				if (blocked({.x = start.x + (end.x - start.x) * share, .y = start.y + (end.y - start.y) * share}, at)) {
					return at;
				}
			}
			along += length;
			if (blocked(b, along)) {
				return along;
			}
		}
		return std::nullopt;
	}

	std::vector<RoadClash> roadClashes(std::span<const RoadNode> nodes, std::span<const RoadLine> lines, bool bySegment) {
		const double		 clearance = kRoadClearance;
		std::vector<Segment> segments;
		for (size_t line = 0; line < lines.size(); ++line) {
			const auto& points = lines[line].points;
			for (size_t index = 0; index + 1 < points.size(); ++index) {
				const Point a = points[index];
				const Point b = points[index + 1];
				segments.push_back({
					.line = line,
					.index = index,
					.a = a,
					.b = b,
					.minX = std::min(a.x, b.x),
					.maxX = std::max(a.x, b.x),
					.minY = std::min(a.y, b.y),
					.maxY = std::max(a.y, b.y),
				});
			}
		}
		std::vector<RoadClash> clashes;
		if (segments.empty()) {
			return clashes;
		}
		double left = std::numeric_limits<double>::infinity();
		double bottom = left;
		double right = -left;
		double top = -left;
		for (const Segment& segment : segments) {
			left = std::min(left, segment.minX - clearance);
			bottom = std::min(bottom, segment.minY - clearance);
			right = std::max(right, segment.maxX + clearance);
			top = std::max(top, segment.maxY + clearance);
		}
		const auto columns = static_cast<size_t>(std::floor((right - left) / kBucket)) + 1;
		const auto rows = static_cast<size_t>(std::floor((top - bottom) / kBucket)) + 1;
		const auto columnOf = [&](double x) {
			return static_cast<size_t>(std::floor((x - left) / kBucket));
		};
		const auto rowOf = [&](double y) {
			return static_cast<size_t>(std::floor((y - bottom) / kBucket));
		};
		const auto eachBucket = [&](const Segment& segment, double grow, auto&& visit) {
			for (size_t row = rowOf(segment.minY - grow); row <= rowOf(segment.maxY + grow); ++row) {
				for (size_t column = columnOf(segment.minX - grow); column <= columnOf(segment.maxX + grow); ++column) {
					visit(row * columns + column);
				}
			}
		};
		// Bucket b's segments are filed[starts[b]] up to filed[starts[b + 1]].
		std::vector<size_t> starts(columns * rows + 1);
		for (const Segment& segment : segments) {
			eachBucket(segment, 0, [&](size_t bucket) { starts[bucket + 1] += 1; });
		}
		for (size_t bucket = 0; bucket < columns * rows; ++bucket) {
			starts[bucket + 1] += starts[bucket];
		}
		std::vector<size_t> cursor(starts.begin(), starts.end() - 1);
		std::vector<size_t> filed(starts.back());
		for (size_t id = 0; id < segments.size(); ++id) {
			eachBucket(segments[id], 0, [&](size_t bucket) { filed[cursor[bucket]++] = id; });
		}
		std::vector<size_t>				seen(segments.size(), std::numeric_limits<size_t>::max());
		std::set<std::array<size_t, 4>> reported;
		for (size_t first = 0; first < segments.size(); ++first) {
			eachBucket(segments[first], clearance, [&](size_t bucket) {
				for (size_t entry = starts[bucket]; entry < starts[bucket + 1]; ++entry) {
					const size_t second = filed[entry];
					if (second <= first || seen[second] == first) {
						continue;
					}
					seen[second] = first;
					const Segment&				   a = segments[first];
					const Segment&				   b = segments[second];
					const std::optional<PairBreak> found = checkPair(nodes, lines, a, b);
					if (!found) {
						continue;
					}
					const std::array<size_t, 4> key = bySegment ? std::array{a.line, a.index, b.line, b.index}
																: std::array{a.line, b.line, static_cast<size_t>(found->rule), size_t{0}};
					if (reported.insert(key).second) {
						clashes.push_back(
							{.rule = found->rule,
							 .a = a.line,
							 .b = b.line,
							 .segmentA = a.index,
							 .segmentB = b.index,
							 .detail = found->detail}
						);
					}
				}
			});
		}
		return clashes;
	}

	std::vector<RoadViolation> checkRoadNetwork(const RoadNetwork& network, const Ground& ground, size_t limit) {
		Report report(limit);
		checkStructure(network, report);
		if (report.any()) {
			return report.take();
		}
		checkGround(network, ground, report);
		std::vector<RoadLine> lines;
		for (const RoadStretch& stretch : network.stretches) {
			lines.push_back({.from = stretch.from, .to = stretch.to, .points = stretch.points});
		}
		for (RoadClash& clash : roadClashes(network.nodes, lines, false)) {
			report(clash.rule, std::move(clash.detail));
		}
		checkReach(network, report);
		return report.take();
	}

} // namespace rules::map
