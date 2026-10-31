#include <rules/map/Ground.h>
#include <rules/map/MapTesting.h>
#include <rules/map/Polyline.h>
#include <rules/map/RoadChecks.h>
#include <rules/map/RoadGraph.h>
#include <rules/map/RoadNetwork.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <numbers>
#include <vector>

namespace {

	using namespace rules::map;

	// A river running north through x, the same width all along.
	RiverIndex straightRiver(const Ground& ground, double x, double width) {
		River river;
		for (double y = -1000; y <= 1000; y += 10) {
			river.line.push_back({.x = x, .y = y, .width = width});
		}
		const std::vector<River> rivers{river};
		return {rivers, ground.terrain().surface().grid.halfExtent};
	}

	// The mixed map's metro, with no rivers, or one planted 4 across along x = 22: nothing else stands in the
	// metro, so the checks see only what a test puts there.
	struct Metro {
		Ground	   land = fixtures::groundFor(fixtures::mixed());
		RiverIndex none;
		RiverIndex river = straightRiver(land, 22, 4);
		Ground	   dry = land.withRivers(none);
		Ground	   wet = land.withRivers(river);
	};

	const Metro& metro() {
		static const Metro ground;
		return ground;
	}

	RoadStretch stretch(int from, int to, std::vector<Point> points, RoadClass road = RoadClass::BackRoad) {
		const double length = polylineLength(points);
		return {
			.roadClass = road,
			.from = from,
			.to = to,
			.length = length,
			.points = std::move(points),
			.bridges = {},
			.street = true,
			.highway = road == RoadClass::Highway ? 0 : -1,
		};
	}

	// A square loop out of the compound, (0, 0) to (0, 50) to (50, 50) to (50, 0) and home, and a spur from
	// (50, 50) to a dead end at (60, 65), all inside the metro.
	RoadNetwork valid() {
		return {
			.nodes =
				{
					{.kind = RoadNodeKind::Compound, .x = 0, .y = 0, .place = 0},
					{.kind = RoadNodeKind::Junction, .x = 0, .y = 50, .place = -1},
					{.kind = RoadNodeKind::Town, .x = 50, .y = 50, .place = 1},
					{.kind = RoadNodeKind::Crossroads, .x = 50, .y = 0, .place = 2},
					{.kind = RoadNodeKind::End, .x = 60, .y = 65, .place = -1},
				},
			.stretches =
				{
					stretch(0, 1, {{.x = 0, .y = 0}, {.x = 0, .y = 25}, {.x = 0, .y = 50}}, RoadClass::Highway),
					stretch(1, 2, {{.x = 0, .y = 50}, {.x = 25, .y = 50}, {.x = 50, .y = 50}}),
					stretch(2, 3, {{.x = 50, .y = 50}, {.x = 50, .y = 25}, {.x = 50, .y = 0}}),
					stretch(3, 0, {{.x = 50, .y = 0}, {.x = 25, .y = 0}, {.x = 0, .y = 0}}),
					stretch(2, 4, {{.x = 50, .y = 50}, {.x = 60, .y = 65}}, RoadClass::Trail),
				},
			.broken = {},
			.passes = {},
		};
	}

	// The network with each stretch's bridges the ones its line crosses.
	RoadNetwork bridged(RoadNetwork network, const Ground& ground) {
		for (RoadStretch& road : network.stretches) {
			road.bridges = polylineBridges(ground, road.points);
		}
		return network;
	}

	std::vector<RoadRule> rules(const RoadNetwork& network, const Ground& ground) {
		std::vector<RoadRule> found;
		for (const RoadViolation& violation : checkRoadNetwork(network, ground)) {
			found.push_back(violation.rule);
		}
		return found;
	}

	bool breaks(const RoadNetwork& network, const Ground& ground, RoadRule rule) {
		const std::vector<RoadRule> found = rules(network, ground);
		return std::ranges::find(found, rule) != found.end();
	}

	TEST(RoadChecks, PassAWholeNetworkWithALoopAndCountItsLoop) {
		EXPECT_TRUE(rules(valid(), metro().dry).empty());
		EXPECT_TRUE(rules(bridged(valid(), metro().wet), metro().wet).empty());
		EXPECT_EQ(loopCount(valid().nodes.size(), valid().stretches), 1);
	}

	TEST(RoadChecks, FindBrokenStructure) {
		const Ground& ground = metro().dry;
		RoadNetwork	  moved = valid();
		moved.nodes[0].x = 1;
		EXPECT_EQ(rules(moved, ground), std::vector{RoadRule::Structure});
		RoadNetwork off = valid();
		off.stretches[1] = stretch(1, 2, {{.x = 0, .y = 51}, {.x = 25, .y = 50}, {.x = 50, .y = 50}});
		EXPECT_TRUE(breaks(off, ground, RoadRule::Structure));
		RoadNetwork wrongLength = valid();
		wrongLength.stretches[4].length = 10;
		EXPECT_EQ(rules(wrongLength, ground), std::vector{RoadRule::Structure});
		RoadNetwork loop = valid();
		loop.stretches.push_back(stretch(4, 4, {{.x = 60, .y = 65}, {.x = 62, .y = 65}, {.x = 60, .y = 65}}));
		EXPECT_EQ(rules(loop, ground), std::vector{RoadRule::Structure});
		RoadNetwork disordered = valid();
		disordered.stretches[1].bridges = {{.start = 30, .end = 35}, {.start = 10, .end = 15}};
		EXPECT_EQ(rules(disordered, ground), std::vector{RoadRule::Structure});
		// A highway carries its number, and nothing else does.
		RoadNetwork unnumbered = valid();
		unnumbered.stretches[0].highway = -1;
		EXPECT_EQ(rules(unnumbered, ground), std::vector{RoadRule::Structure});
		RoadNetwork numbered = valid();
		numbered.stretches[1].highway = 2;
		EXPECT_EQ(rules(numbered, ground), std::vector{RoadRule::Structure});
	}

	TEST(RoadChecks, FindAPointOutsideTheDisc) {
		RoadNetwork out = valid();
		out.nodes.push_back({.kind = RoadNodeKind::End, .x = 601, .y = 0, .place = -1});
		out.stretches.push_back(stretch(3, 5, {{.x = 50, .y = 0}, {.x = 601, .y = 0}}));
		EXPECT_TRUE(breaks(out, metro().dry, RoadRule::Disc));
	}

	TEST(RoadChecks, FindRiverWaterOffABridgesDeckAndBridgesThatArentTheLines) {
		const Ground& wet = metro().wet;
		// The loop's top and bottom cross the river square-on; recorded without their bridges, both break two rules.
		EXPECT_EQ(rules(valid(), wet), (std::vector{RoadRule::Bridges, RoadRule::Passable, RoadRule::Bridges, RoadRule::Passable}));
		// Down the river is impassable, even in the metro, where obstacle passes its water.
		RoadNetwork along = bridged(valid(), wet);
		along.nodes.push_back({.kind = RoadNodeKind::End, .x = 22.5, .y = 10, .place = -1});
		along.nodes.push_back({.kind = RoadNodeKind::End, .x = 22.5, .y = 40, .place = -1});
		along.stretches.push_back(stretch(5, 6, {{.x = 22.5, .y = 10}, {.x = 22.5, .y = 40}}));
		EXPECT_TRUE(breaks(along, wet, RoadRule::Passable));
		// A deck runs on past a point in the water, which a segment at a time would cut short there.
		const std::vector<Point>	  line{{.x = 10, .y = 10}, {.x = 23, .y = 10}, {.x = 40, .y = 10}};
		const std::vector<RoadBridge> decks = polylineBridges(wet, line);
		ASSERT_EQ(decks.size(), 1U);
		EXPECT_NEAR(decks[0].start, 9, 1e-9);
		EXPECT_NEAR(decks[0].end, 15, 1e-9);
		EXPECT_FALSE(impassableAlong(wet, line, decks).has_value());
		EXPECT_GE(impassableAlong(wet, line, std::vector<RoadBridge>{{.start = 9, .end = 13}}).value_or(0), 13);
		EXPECT_TRUE(impassableAlong(wet, line, std::vector<RoadBridge>{}).has_value());
	}

	TEST(RoadChecks, FindStretchesThatCrossComeTooCloseOrLeaveANodeTooNarrowly) {
		const Ground& ground = metro().dry;
		RoadNetwork	  crossing = valid();
		crossing.stretches.push_back(stretch(1, 3, {{.x = 0, .y = 50}, {.x = 50, .y = 0}}));
		crossing.stretches.push_back(stretch(0, 2, {{.x = 0, .y = 0}, {.x = 50, .y = 50}}));
		EXPECT_TRUE(breaks(crossing, ground, RoadRule::Crossing));
		// Beside the top road a unit away, sharing neither of its nodes.
		RoadNetwork close = valid();
		close.nodes.push_back({.kind = RoadNodeKind::End, .x = 10, .y = 51, .place = -1});
		close.nodes.push_back({.kind = RoadNodeKind::End, .x = 40, .y = 51, .place = -1});
		close.stretches.push_back(stretch(5, 6, {{.x = 10, .y = 51}, {.x = 40, .y = 51}}));
		EXPECT_TRUE(breaks(close, ground, RoadRule::Clearance));
		// A second road out of the compound five degrees off the first, then twenty-five.
		const auto fanned = [](double degrees) {
			RoadNetwork	 network = valid();
			const double radians = degrees * std::numbers::pi / 180;
			const Point	 end{.x = 50 * std::sin(radians), .y = 50 * std::cos(radians)};
			network.nodes.push_back({.kind = RoadNodeKind::End, .x = end.x, .y = end.y, .place = -1});
			network.stretches.push_back(stretch(0, 5, {{.x = 0, .y = 0}, end}));
			return network;
		};
		EXPECT_TRUE(breaks(fanned(5), ground, RoadRule::Crossing));
		EXPECT_TRUE(rules(fanned(25), ground).empty());
		// A stretch touching itself.
		RoadNetwork looped = valid();
		looped.stretches[4] = stretch(
			2, 4, {{.x = 50, .y = 50}, {.x = 56, .y = 58}, {.x = 56, .y = 54}, {.x = 52, .y = 58}, {.x = 60, .y = 65}}, RoadClass::Trail
		);
		EXPECT_TRUE(breaks(looped, ground, RoadRule::Crossing));
	}

	TEST(RoadChecks, FindANodeThatDoesntReachTheCompound) {
		RoadNetwork cut = valid();
		cut.nodes.push_back({.kind = RoadNodeKind::End, .x = -20, .y = -20, .place = -1});
		cut.nodes.push_back({.kind = RoadNodeKind::End, .x = -40, .y = -20, .place = -1});
		cut.stretches.push_back(stretch(5, 6, {{.x = -20, .y = -20}, {.x = -40, .y = -20}}));
		EXPECT_EQ(rules(cut, metro().dry), (std::vector{RoadRule::Reach, RoadRule::Reach}));
	}

	TEST(RoadGraph, CutsALongLineOnlyWhereTheWholeLineWasSampledAndEvenly) {
		// 301.3 units askew, both ways along: cut into three at shares that aren't on the half-unit samples.
		for (const bool reversed : {false, true}) {
			std::vector<Point> line{{.x = 3, .y = 7}, {.x = 3 + 301.3 * 0.8, .y = 7 + 301.3 * 0.6}};
			if (reversed) {
				std::ranges::reverse(line);
			}
			const Point start = line[0].x < line[1].x ? line[0] : line[1];
			const auto	pieces = splitLong(line, {});
			ASSERT_EQ(pieces.size(), 3U);
			for (size_t piece = 0; piece < pieces.size(); ++piece) {
				EXPECT_NEAR(polylineLength(pieces[piece]), 301.3 / 3, 0.5);
				if (piece > 0) {
					// Each cut lies a whole number of samples from the segment's lower-left end.
					const Point	 cut = pieces[piece].front();
					const double steps = std::hypot(cut.x - start.x, cut.y - start.y) / kPassableSpacing;
					EXPECT_NEAR(steps, std::round(steps), 1e-9);
					EXPECT_EQ(pieces[piece - 1].back(), cut);
				}
			}
			EXPECT_EQ(pieces.front().front(), line.front());
			EXPECT_EQ(pieces.back().back(), line.back());
		}
		// A cut that falls on a bridge moves to the nearer end of its deck.
		const std::vector<Point> line{{.x = 0, .y = 0}, {.x = 200, .y = 0}};
		const auto				 pieces = splitLong(line, std::vector<RoadBridge>{{.start = 95, .end = 110}});
		ASSERT_EQ(pieces.size(), 2U);
		EXPECT_EQ(pieces[0].back(), (Point{.x = 95, .y = 0}));
	}

} // namespace
