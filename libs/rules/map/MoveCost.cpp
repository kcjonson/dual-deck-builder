#include "MoveCost.h"

#include "Land.h"
#include "MapMath.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <limits>

namespace rules::map {

	namespace {

		// Per class, highway, back road, trail.
		using ByClass = std::array<double, 3>;

		constexpr double kInfinity = std::numeric_limits<double>::infinity();

		// The grade along the move, squared, is weighted `grade` by class times `curvinessGentle` to
		// `curvinessWinding` by curviness, roads that barely mind a climb to roads that wind to keep it gentle;
		// the slope across it, squared, `side` by class. A highway or back road can't climb past `maxGrade`.
		// A bridge costs `bridge` world units of flat road by class, and as much again for each `bridgeSpan` units
		// it runs; none runs longer than `longestBridge`, the river's width over the sine of its crossing angle,
		// or crosses its river at a sine under `leastCrossing`, 30 degrees, so a creek can be crossed well askew
		// and a broad river only near square, and no deck runs down a river. A bridge's deck reaches
		// `bridgeSlack` past the water either side.
		struct Costs {
			ByClass grade{26, 10, 3.5};
			ByClass side{3, 1.2, 0.3};
			double	curvinessGentle = 0.2;
			double	curvinessWinding = 1.8;
			ByClass maxGrade{1.1, 1.1, kInfinity};
			ByClass bridge{130, 210, 280};
			double	bridgeSpan = 8;
			double	longestBridge = 24;
			double	leastCrossing = 0.5;
			double	bridgeSlack = 1;
		};

		constexpr Costs kCosts;

		double byClass(const ByClass& values, RoadClass road) {
			return values[static_cast<size_t>(road)];
		}

	} // namespace

	MoveCost::MoveCost(const Ground& ground, double curviness)
		: ground(&ground),
		  gradeScale(lerp(kCosts.curvinessGentle, kCosts.curvinessWinding, curviness)) {}

	RoadCost MoveCost::cost(double x0, double y0, double x1, double y1, RoadClass road) const {
		const double dx = x1 - x0;
		const double dy = y1 - y0;
		if (dx == 0 && dy == 0) {
			return {};
		}
		const double length = std::sqrt(dx * dx + dy * dy);
		if (!(length > 0 && length < kInfinity) || ground->obstacle(x1, y1) != Obstacle::None) {
			return {.cost = kInfinity, .bridge = 0};
		}
		double bridge = 0;
		bool   blocked = false;
		ground->rivers().forEachCrossing(x0, y0, x1, y1, [&](const RiverCrossing& crossing) {
			if (!(crossing.sine >= kCosts.leastCrossing)) {
				blocked = true;
				return;
			}
			if (ground->bridged(x0 + dx * crossing.along, y0 + dy * crossing.along)) {
				return;
			}
			if (!(crossing.width <= kCosts.longestBridge * crossing.sine)) {
				blocked = true;
				return;
			}
			bridge += byClass(kCosts.bridge, road) * (1 + crossing.width / crossing.sine / kCosts.bridgeSpan);
		});
		if (blocked) {
			return {.cost = kInfinity, .bridge = 0};
		}
		const double   middleX = x0 + 0.5 * dx;
		const double   middleY = y0 + 0.5 * dy;
		const Obstacle middle = ground->obstacle(middleX, middleY);
		if (middle != Obstacle::None && !(middle == Obstacle::River && bridge > 0)) {
			return {.cost = kInfinity, .bridge = 0};
		}
		const Terrain& terrain = ground->terrain();
		const double   grade = std::abs(terrain.elevation(x1, y1) - terrain.elevation(x0, y0)) * kRelief / length;
		if (grade > byClass(kCosts.maxGrade, road)) {
			return {.cost = kInfinity, .bridge = 0};
		}
		const LandSample slope = terrain.sample(middleX, middleY);
		const double	 across = (slope.slopeY * dx - slope.slopeX * dy) * kRelief / length;
		const double	 climb = byClass(kCosts.grade, road) * gradeScale * grade * grade;
		return {.cost = length * (1 + climb + byClass(kCosts.side, road) * across * across) + bridge, .bridge = bridge};
	}

	std::vector<BridgeSpan> MoveCost::bridgeSpans(double x0, double y0, double x1, double y1) const {
		std::vector<BridgeSpan> spans;
		const double			dx = x1 - x0;
		const double			dy = y1 - y0;
		const double			length = std::sqrt(dx * dx + dy * dy);
		if (!(length > 0)) {
			return spans;
		}
		ground->rivers().forEachCrossing(x0, y0, x1, y1, [&](const RiverCrossing& crossing) {
			if (!(crossing.sine >= kCosts.leastCrossing)) {
				return;
			}
			const bool inMetro = ground->bridged(x0 + dx * crossing.along, y0 + dy * crossing.along);
			if (!inMetro && !(crossing.width <= kCosts.longestBridge * crossing.sine)) {
				return;
			}
			const double reach = (0.5 * crossing.width / crossing.sine + kCosts.bridgeSlack) / length;
			spans.push_back({.from = crossing.along - reach, .to = crossing.along + reach});
		});
		return spans;
	}

} // namespace rules::map
