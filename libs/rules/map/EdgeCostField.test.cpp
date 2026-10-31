#include <rules/map/EdgeCostField.h>
#include <rules/map/Ground.h>
#include <rules/map/MapTesting.h>
#include <rules/map/MoveCost.h>

#include <gtest/gtest.h>

#include <array>
#include <cmath>
#include <limits>
#include <set>
#include <vector>

namespace {

	using namespace rules::map;

	constexpr double kInfinity = std::numeric_limits<double>::infinity();

	TEST(EdgeCostField, FilesEachMoveOnceUnderTheSameIdFromEitherEnd) {
		const Ground  ground = fixtures::groundFor(fixtures::mixed());
		EdgeCostField field(ground, 0.5);
		const int	  middle = (field.size() / 2) * field.size() + field.size() / 2;
		std::set<int> ids;
		for (int direction = 0; direction < kMoves; ++direction) {
			const int next = field.step(middle, direction);
			EXPECT_EQ(field.edge(next, kOpposite[static_cast<size_t>(direction)]), field.edge(middle, direction));
			EXPECT_EQ(moveBetween(kMoveX[static_cast<size_t>(direction)], kMoveY[static_cast<size_t>(direction)]), direction);
			ids.insert(field.edge(middle, direction));
		}
		EXPECT_EQ(ids.size(), static_cast<size_t>(kMoves));
		EXPECT_EQ(moveBetween(1, 2), -1);
	}

	TEST(EdgeCostField, BridgesTwoCellsStraightOnOnlyOverACellWhoseCentreIsInARiver) {
		const MapParams& params = fixtures::floodlands();
		const Ground	 ground = fixtures::groundFor(params);
		EdgeCostField	 field(ground, params.curviness);
		const MoveCost	 reference(ground, params.curviness);
		int				 leaps = 0;
		for (int cell = 0; cell < field.grid().cells(); ++cell) {
			if (!field.open(cell)) {
				continue;
			}
			for (const int direction : {8, 9}) {
				const int edge = field.edge(cell, direction);
				if (!(field.cost(edge, RoadClass::BackRoad) < kInfinity)) {
					continue;
				}
				const int next = field.step(cell, direction);
				const int over = (cell + next) / 2;
				EXPECT_FALSE(field.open(over));
				EXPECT_EQ(ground.waterAt(field.x(over), field.y(over)), WaterKind::River);
				EXPECT_TRUE(field.bridged(edge));
				EXPECT_EQ(
					field.cost(edge, RoadClass::BackRoad),
					reference.cost(field.x(cell), field.y(cell), field.x(next), field.y(next), RoadClass::BackRoad).cost
				);
				EXPECT_TRUE(fixtures::passableAlong(ground, field.x(cell), field.y(cell), field.x(next), field.y(next)));
				leaps += 1;
			}
		}
		EXPECT_GT(leaps, 0);
	}

	TEST(EdgeCostField, WorksEachMoveOutTheSameWhicheverOrderItsAskedFor) {
		const MapParams& params = fixtures::floodlands();
		const Ground	 ground = fixtures::groundFor(params);
		EdgeCostField	 forward(ground, params.curviness);
		EdgeCostField	 backward(ground, params.curviness);
		std::vector<int> asked;
		for (int edge = backward.edges() - 1; edge >= 0; edge -= 7) {
			asked.push_back(edge);
			(void)backward.cost(edge, RoadClass::Highway);
		}
		for (int edge = 0; edge < forward.edges(); edge += 3) {
			(void)forward.cost(edge, RoadClass::Trail);
		}
		for (const int edge : asked) {
			EXPECT_EQ(backward.cost(edge, RoadClass::Trail), forward.cost(edge, RoadClass::Trail));
		}
		EXPECT_GT(backward.worked(), 0);
	}

	TEST(EdgeCostField, CrossesTheMetrosRiversFreeOfChargeButNeverStandsInOneOrRunsDownIt) {
		const Ground	ground = fixtures::groundFor(fixtures::mixed());
		const LandGrid& grid = ground.terrain().surface().grid;
		// North through the metro, over a column of cell centres just east of Home's.
		const double x = cellCentre(grid, grid.size / 2 + 1);
		River		 river;
		for (double y = -1000; y <= 1000; y += 10) {
			river.line.push_back({.x = x, .y = y, .width = 6});
		}
		const std::vector<River> rivers{river};
		const RiverIndex		 water(rivers, grid.halfExtent);
		const Ground			 wet = ground.withRivers(water);
		EdgeCostField			 field(wet, 0.5);
		const MoveCost			 costs(wet, 0.5);
		const double			 metro = ground.terrain().start().metro;
		int						 wetCells = 0;
		int						 crossings = 0;
		for (int cell = 0; cell < grid.cells(); ++cell) {
			const double cellX = field.x(cell);
			const double cellY = field.y(cell);
			if (cellX * cellX + cellY * cellY > metro * metro) {
				continue;
			}
			if (wet.waterAt(cellX, cellY) == WaterKind::River) {
				EXPECT_FALSE(field.open(cell));
				wetCells += 1;
			}
			if (!field.open(cell)) {
				continue;
			}
			for (int direction = 0; direction < kMoves; ++direction) {
				const int edge = field.edge(cell, direction);
				if (!(field.cost(edge, RoadClass::Highway) < kInfinity)) {
					continue;
				}
				const int next = field.step(cell, direction);
				EXPECT_TRUE(fixtures::passableAlong(wet, cellX, cellY, field.x(next), field.y(next)));
				if (!bridgeSpans(wet, cellX, cellY, field.x(next), field.y(next)).empty()) {
					EXPECT_TRUE(field.bridged(edge));
					EXPECT_EQ(costs.cost(cellX, cellY, field.x(next), field.y(next), RoadClass::Highway).bridge, 0);
					crossings += 1;
				}
			}
		}
		EXPECT_GT(wetCells, 5);
		EXPECT_GT(crossings, 5);
	}

	TEST(EdgeCostField, IsStricterThanMoveCostWhereWaterReachesAMoveBetweenItsClearEndsAndMiddle) {
		const Ground	ground = fixtures::groundFor(fixtures::mixed());
		const LandGrid& grid = ground.terrain().surface().grid;
		const double	metro = ground.terrain().start().metro;
		const int		east = moveBetween(1, 0);
		EdgeCostField	dry(ground, 0.5);
		// The first east move out from Home, past the metro's bridges, that a trail can take.
		int cell = -1;
		for (int column = grid.size / 2 + 1; column + 1 < grid.size && cell < 0; ++column) {
			const int at = (grid.size / 2) * grid.size + column;
			if (dry.x(at) > metro + 10 && dry.open(at) && dry.open(dry.step(at, east)) &&
				dry.cost(dry.edge(at, east), RoadClass::Trail) < kInfinity) {
				cell = at;
			}
		}
		ASSERT_GE(cell, 0);
		const double x0 = dry.x(cell);
		const double y0 = dry.y(cell);
		const double x1 = dry.x(dry.step(cell, east));
		// A creek that ends half a unit short of the move a quarter of the way along it: its water reaches the move
		// there, but it never crosses it, and its ends and middle stay dry.
		const double			 quarter = x0 + grid.cellSize / 4;
		const std::vector<River> rivers{
			{.chain = {}, .area = 0, .line = {{.x = quarter, .y = y0 - 30, .width = 2}, {.x = quarter, .y = y0 - 0.5, .width = 2}}}
		};
		const RiverIndex water(rivers, grid.halfExtent);
		const Ground	 wet = ground.withRivers(water);
		EdgeCostField	 field(wet, 0.5);
		const MoveCost	 costs(wet, 0.5);
		ASSERT_TRUE(field.open(cell));
		ASSERT_TRUE(field.open(field.step(cell, east)));
		EXPECT_EQ(wet.waterAt(quarter, y0), WaterKind::River);
		EXPECT_EQ(wet.obstacle((x0 + x1) / 2, y0), Obstacle::None);
		EXPECT_LT(costs.cost(x0, y0, x1, y0, RoadClass::Trail).cost, kInfinity) << "MoveCost reads the end and the middle";
		EXPECT_FALSE(field.cost(field.edge(cell, east), RoadClass::Trail) < kInfinity);
		EXPECT_FALSE(fixtures::passableAlong(wet, x0, y0, x1, y0));
	}

} // namespace
