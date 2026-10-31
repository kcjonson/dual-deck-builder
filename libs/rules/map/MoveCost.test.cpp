#include <rules/map/Ground.h>
#include <rules/map/Land.h>
#include <rules/map/MapTesting.h>
#include <rules/map/MoveCost.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <optional>
#include <utility>
#include <vector>

namespace {

	using namespace rules::map;

	constexpr double kInfinity = std::numeric_limits<double>::infinity();

	Ground groundFor(const MapParams& params) {
		return {fixtures::terrainFor(params), fixtures::waterFor(params), fixtures::hazardsFor(params)};
	}

	// A river running north through x, the same width all along.
	RiverIndex straightRiver(const Ground& ground, double x, double width) {
		River river;
		for (double y = -1000; y <= 1000; y += 10) {
			river.line.push_back({.x = x, .y = y, .width = width});
		}
		const std::vector<River> rivers{river};
		return {rivers, ground.terrain().surface().grid.halfExtent};
	}

	// A point past the relief radius with gentle, open ground `reach` round it every way: nothing impassable,
	// rivers aside, and grade under 0.15.
	std::pair<double, double> openGround(const Ground& ground, double reach) {
		const RiverIndex nothing;
		const Ground	 dry = ground.withRivers(nothing);
		const Terrain&	 terrain = ground.terrain();
		const double	 inner = terrain.start().relief + reach;
		const double	 outer = 0.8 * terrain.radius();
		const auto		 gentle = [&](double x, double y) {
			  const LandSample sample = terrain.sample(x, y);
			  return std::hypot(sample.slopeX, sample.slopeY) * kRelief < 0.15 && dry.obstacle(x, y) == Obstacle::None;
		};
		for (double x = -outer; x <= outer; x += 23) {
			for (double y = -outer; y <= outer; y += 23) {
				const double away = std::hypot(x, y);
				if (away < inner || away > outer) {
					continue;
				}
				bool open = true;
				for (double dx = -reach; dx <= reach && open; dx += 2) {
					for (double dy = -reach; dy <= reach && open; dy += 2) {
						open = gentle(x + dx, y + dy);
					}
				}
				if (open) {
					return {x, y};
				}
			}
		}
		ADD_FAILURE() << "no open ground " << reach << " units across";
		return {0, 0};
	}

	// Points past the relief radius, out of rough country, graded `low` to `high`: steady slopes to move on.
	std::vector<std::pair<double, double>> slopes(const Ground& ground, double low, double high) {
		const Terrain&						   terrain = ground.terrain();
		std::vector<std::pair<double, double>> found;
		const double						   reach = 0.9 * terrain.radius();
		for (double x = -reach; x <= reach; x += reach / 30) {
			for (double y = -reach; y <= reach; y += reach / 30) {
				if (std::hypot(x, y) <= terrain.start().relief || terrain.fields().rough(x, y)) {
					continue;
				}
				const LandSample sample = terrain.sample(x, y);
				const double	 grade = std::hypot(sample.slopeX, sample.slopeY) * kRelief;
				if (grade >= low && grade <= high) {
					found.emplace_back(x, y);
				}
			}
		}
		return found;
	}

	TEST(MoveCost, CostsTheDistanceOnFlatGroundAndNothingForNoMove) {
		const Ground   ground = groundFor(fixtures::mixed());
		const MoveCost costs(ground, fixtures::mixed().curviness);
		EXPECT_EQ(costs.cost(0, 0, 0, 0, RoadClass::Highway).cost, 0);
		const double flat = costs.cost(0, 0, 6, 8, RoadClass::Trail).cost;
		EXPECT_GE(flat, 10);
		EXPECT_LT(flat, 10.1);
	}

	TEST(MoveCost, FavoursContoursAndHighwaysMindTheClimbMost) {
		const Ground   ground = groundFor(fixtures::mixed());
		const MoveCost costs(ground, fixtures::mixed().curviness);
		const Terrain& terrain = ground.terrain();
		int			   checked = 0;
		for (const auto& [x, y] : slopes(ground, 0.12, 0.35)) {
			const LandSample sample = terrain.sample(x, y);
			const double	 length = std::hypot(sample.slopeX, sample.slopeY);
			const double	 ux = sample.slopeX / length;
			const double	 uy = sample.slopeY / length;
			const double	 up = costs.cost(x, y, x + 2 * ux, y + 2 * uy, RoadClass::Highway).cost;
			const double	 along = costs.cost(x, y, x - 2 * uy, y + 2 * ux, RoadClass::Highway).cost;
			if (up == kInfinity || along == kInfinity) {
				continue;
			}
			EXPECT_LT(along, up);
			EXPECT_LT(costs.cost(x, y, x + 2 * ux, y + 2 * uy, RoadClass::Trail).cost, up);
			EXPECT_GT(up, 2);
			checked += 1;
		}
		EXPECT_GT(checked, 20);
	}

	TEST(MoveCost, WeighsTheClimbByCurvinessSoWindingRoadsMindGradesMore) {
		const Ground   ground = groundFor(fixtures::mixed());
		const MoveCost straight(ground, 0);
		const MoveCost winding(ground, 1);
		int			   checked = 0;
		for (const auto& [x, y] : slopes(ground, 0.15, 0.4)) {
			const LandSample sample = ground.terrain().sample(x, y);
			const double	 length = std::hypot(sample.slopeX, sample.slopeY);
			const double	 ex = x + 4 * sample.slopeX / length;
			const double	 ey = y + 4 * sample.slopeY / length;
			const double	 gentle = straight.cost(x, y, ex, ey, RoadClass::BackRoad).cost;
			if (gentle == kInfinity) {
				continue;
			}
			EXPECT_GT(winding.cost(x, y, ex, ey, RoadClass::BackRoad).cost, gentle);
			checked += 1;
		}
		EXPECT_GT(checked, 10);
	}

	TEST(MoveCost, TurnsHighwaysAndBackRoadsBackFromTooSteepAClimbButNotTrails) {
		const Ground   ground = groundFor(fixtures::rugged());
		const MoveCost costs(ground, fixtures::rugged().curviness);
		const Terrain& terrain = ground.terrain();
		int			   checked = 0;
		for (const auto& [x, y] : slopes(ground, 1.2, 100)) {
			const LandSample sample = terrain.sample(x, y);
			const double	 length = std::hypot(sample.slopeX, sample.slopeY);
			const double	 ex = x + 0.5 * sample.slopeX / length;
			const double	 ey = y + 0.5 * sample.slopeY / length;
			if (ground.obstacle(ex, ey) != Obstacle::None || ground.obstacle((x + ex) / 2, (y + ey) / 2) != Obstacle::None) {
				continue;
			}
			if ((terrain.elevation(ex, ey) - terrain.elevation(x, y)) * kRelief / 0.5 <= 1.1) {
				continue;
			}
			EXPECT_EQ(costs.cost(x, y, ex, ey, RoadClass::Highway).cost, kInfinity);
			EXPECT_EQ(costs.cost(x, y, ex, ey, RoadClass::BackRoad).cost, kInfinity);
			EXPECT_LT(costs.cost(x, y, ex, ey, RoadClass::Trail).cost, kInfinity);
			checked += 1;
		}
		EXPECT_GT(checked, 0);
	}

	TEST(MoveCost, BridgesARiverDearerTheWiderAndLessSquareOnAndNeverPastTheLongestBridgeOrUnder30Degrees) {
		const Ground ground = groundFor(fixtures::mixed());
		const auto [x, y] = openGround(ground, 40);
		const RiverIndex nothing;
		const RiverIndex narrowWater = straightRiver(ground, x, 2);
		const RiverIndex broadWater = straightRiver(ground, x, 8);
		const RiverIndex wideWater = straightRiver(ground, x, 15);
		const Ground	 dryGround = ground.withRivers(nothing);
		const Ground	 narrowGround = ground.withRivers(narrowWater);
		const Ground	 broadGround = ground.withRivers(broadWater);
		const Ground	 wideGround = ground.withRivers(wideWater);
		const double	 curviness = fixtures::mixed().curviness;
		const MoveCost	 dry(dryGround, curviness);
		const MoveCost	 narrow(narrowGround, curviness);
		const MoveCost	 broad(broadGround, curviness);
		const MoveCost	 wide(wideGround, curviness);

		const RoadCost square = narrow.cost(x - 10, y, x + 10, y, RoadClass::BackRoad);
		EXPECT_GT(square.bridge, 0);
		EXPECT_NEAR(square.cost, dry.cost(x - 10, y, x + 10, y, RoadClass::BackRoad).cost + square.bridge, 1e-9);
		EXPECT_GT(broad.cost(x - 10, y, x + 10, y, RoadClass::BackRoad).cost, square.cost);
		EXPECT_GT(narrow.cost(x - 10, y, x + 10, y + 10, RoadClass::BackRoad).cost, square.cost);
		EXPECT_LT(narrow.cost(x - 10, y, x + 10, y, RoadClass::Highway).cost, narrow.cost(x - 10, y, x + 10, y, RoadClass::Trail).cost);

		// Crossed at a sine of 0.6, 2 across is a bridge 3.3 long, and 15 across one 25 long, past the longest.
		const double ax = x + 5;
		const double ay = y + std::sqrt((10 / 0.6) * (10 / 0.6) - 10 * 10);
		EXPECT_LT(narrow.cost(x - 5, y, ax, ay, RoadClass::Highway).cost, kInfinity);
		EXPECT_EQ(wide.cost(x - 5, y, ax, ay, RoadClass::Highway).cost, kInfinity);
		// At a sine of 0.25, under 30 degrees off the river, even 2 across, a bridge 8 long, isn't crossed.
		EXPECT_EQ(narrow.cost(x - 5, y, x + 5, y + std::sqrt(40.0 * 40.0 - 10 * 10), RoadClass::Trail).cost, kInfinity);
		// Stopping in the river, or running down it, is never a bridge.
		EXPECT_EQ(narrow.cost(x - 10, y, x + 0.5, y, RoadClass::Trail).cost, kInfinity);
		EXPECT_EQ(narrow.cost(x, y - 10, x, y + 10, RoadClass::Trail).cost, kInfinity);
		EXPECT_EQ(narrowGround.obstacle(x, y), Obstacle::River);
	}

	TEST(MoveCost, SpansABridgeOverTheWaterAndAUnitEitherSideAndNowhereElse) {
		const Ground ground = groundFor(fixtures::mixed());
		const auto [x, y] = openGround(ground, 40);
		const RiverIndex water = straightRiver(ground, x, 4);
		const Ground	 wet = ground.withRivers(water);
		const MoveCost	 costs(wet, fixtures::mixed().curviness);
		// From 10 short of the river to 10 past it: the water runs from 0.4 to 0.6 of the way, the bridge a
		// twentieth past that.
		const std::vector<BridgeSpan> across = costs.bridgeSpans(x - 10, y, x + 10, y);
		ASSERT_EQ(across.size(), 1U);
		EXPECT_NEAR(across[0].from, 0.35, 1e-12);
		EXPECT_NEAR(across[0].to, 0.65, 1e-12);
		EXPECT_TRUE(costs.bridgeSpans(x - 10, y, x - 30, y).empty());
		// Too long a bridge isn't one: crossed at a sine of 0.1, 4 across would run 40.
		EXPECT_TRUE(costs.bridgeSpans(x - 1, y - 10, x + 1, y + 10).empty());
		// Nor one under 30 degrees off the river: at a sine of 0.4 it would run 10, short enough.
		EXPECT_TRUE(costs.bridgeSpans(x - 4, y, x + 4, y + std::sqrt(20.0 * 20.0 - 8 * 8)).empty());
		EXPECT_EQ(costs.bridgeSpans(x - 4, y, x + 4, y + std::sqrt((8 / 0.6) * (8 / 0.6) - 8 * 8)).size(), 1U);
	}

	TEST(MoveCost, BridgesTheMetrosRiversEverywhereAtNoCostButNotDownTheirLine) {
		const Ground	 ground = groundFor(fixtures::mixed());
		const RiverIndex water = straightRiver(ground, 10, 6);
		const Ground	 wet = ground.withRivers(water);
		const MoveCost	 costs(wet, fixtures::mixed().curviness);
		EXPECT_EQ(wet.obstacle(10, 0), Obstacle::None);
		const RoadCost street = costs.cost(0, 0, 20, 0, RoadClass::Highway);
		EXPECT_LT(street.cost, 20.5);
		EXPECT_EQ(street.bridge, 0);
		EXPECT_EQ(costs.bridgeSpans(8, 0, 12, 2).size(), 1U);
		// Down the river, 11 degrees off it.
		EXPECT_EQ(costs.cost(8, 0, 12, 20, RoadClass::Highway).cost, kInfinity);
		EXPECT_TRUE(costs.bridgeSpans(8, 0, 12, 20).empty());
	}

	TEST(MoveCost, StandsCratersLakesRiversAndCliffsInTheWay) {
		const Ground   ground = groundFor(fixtures::mixed());
		const MoveCost costs(ground, fixtures::mixed().curviness);
		const Hotspot& site = fixtures::hazardsFor(fixtures::mixed()).hotspots().front();
		const double   cell = ground.terrain().surface().grid.cellSize;
		EXPECT_EQ(ground.obstacle(site.x, site.y), Obstacle::Crater);
		EXPECT_EQ(costs.cost(site.x - site.craterRadius - cell, site.y, site.x, site.y, RoadClass::Trail).cost, kInfinity);

		std::optional<std::pair<double, double>> river;
		for (const River& line : ground.water().rivers()) {
			for (const RiverPoint& point : line.line) {
				if (!river && !ground.bridged(point.x, point.y) && std::hypot(point.x, point.y) < ground.terrain().radius()) {
					river = std::pair{point.x, point.y};
				}
			}
		}
		ASSERT_TRUE(river.has_value());
		EXPECT_EQ(ground.obstacle(river->first, river->second), Obstacle::River);

		const Ground	flood = groundFor(fixtures::floodlands());
		const LandGrid& grid = flood.terrain().surface().grid;
		const auto		lakeCell = std::ranges::find_if(flood.water().lakeOf(), [](int lake) { return lake >= 0; });
		ASSERT_NE(lakeCell, flood.water().lakeOf().end());
		const auto lake = static_cast<int>(lakeCell - flood.water().lakeOf().begin());
		EXPECT_EQ(flood.obstacle(cellCentre(grid, lake % grid.size), cellCentre(grid, lake / grid.size)), Obstacle::Lake);

		const Ground   rugged = groundFor(fixtures::rugged());
		const Terrain& steep = rugged.terrain();
		int			   cliffs = 0;
		for (double x = -steep.radius(); x <= steep.radius(); x += 7) {
			for (double y = -steep.radius(); y <= steep.radius(); y += 7) {
				if (steep.fields().cliff(x, y) && !rugged.crater(x, y) && rugged.waterAt(x, y) == WaterKind::None) {
					EXPECT_EQ(rugged.obstacle(x, y), Obstacle::Cliff);
					cliffs += 1;
				}
			}
		}
		EXPECT_GT(cliffs, 0);
	}

} // namespace
