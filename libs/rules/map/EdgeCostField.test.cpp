#include <rules/map/EdgeCostField.h>
#include <rules/map/Ground.h>
#include <rules/map/MapTesting.h>
#include <rules/map/MoveCost.h>

#include <gtest/gtest.h>

#include <array>
#include <cmath>
#include <limits>
#include <optional>
#include <set>
#include <vector>

namespace {

	using namespace rules::map;

	constexpr double				   kInfinity = std::numeric_limits<double>::infinity();
	constexpr std::array<RoadClass, 3> kClasses{RoadClass::Highway, RoadClass::BackRoad, RoadClass::Trail};

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

	TEST(EdgeCostField, AgreesWithMoveCostWhereverItLeavesAMoveOpenAndIsStricterOnlyWhereTheGroundAlongItIsImpassable) {
		const MapParams& params = fixtures::floodlands();
		const Ground	 ground = fixtures::groundFor(params);
		EdgeCostField	 field(ground, params.curviness);
		const MoveCost	 reference(ground, params.curviness);
		int				 agreed = 0;
		int				 stricter = 0;
		for (int cell = 0; cell < field.grid().cells(); cell += 5) {
			if (!field.open(cell)) {
				continue;
			}
			for (int direction = 0; direction < 4; ++direction) {
				const int			next = field.step(cell, direction);
				const double		x0 = field.x(cell);
				const double		y0 = field.y(cell);
				const double		x1 = field.x(next);
				const double		y1 = field.y(next);
				std::optional<bool> passable;
				const auto			passes = [&] {
					 if (!passable) {
						 passable = fixtures::passableAlong(ground, x0, y0, x1, y1);
					 }
					 return *passable;
				};
				for (const RoadClass road : kClasses) {
					const double cost = field.cost(field.edge(cell, direction), road);
					const double expected = reference.cost(x0, y0, x1, y1, road).cost;
					if (cost < kInfinity) {
						EXPECT_EQ(cost, expected);
						EXPECT_TRUE(passes()) << "cell " << cell << " direction " << direction;
						agreed += 1;
					} else if (expected < kInfinity) {
						// MoveCost reads a move's end and middle, and knows nothing of the rim or the metro's rivers.
						EXPECT_TRUE(!field.open(next) || !passes()) << "cell " << cell << " direction " << direction;
						stricter += field.open(next) ? 1 : 0;
					}
				}
			}
		}
		EXPECT_GT(agreed, 5000);
		EXPECT_GT(stricter, 0);
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
				if (!costs.bridgeSpans(cellX, cellY, field.x(next), field.y(next)).empty()) {
					EXPECT_TRUE(field.bridged(edge));
					EXPECT_EQ(costs.cost(cellX, cellY, field.x(next), field.y(next), RoadClass::Highway).bridge, 0);
					crossings += 1;
				}
			}
		}
		EXPECT_GT(wetCells, 5);
		EXPECT_GT(crossings, 5);
	}

} // namespace
