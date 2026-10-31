#include <rules/map/EdgeCostField.h>
#include <rules/map/Ground.h>
#include <rules/map/MapTesting.h>
#include <rules/map/MoveCost.h>

#include <gtest/gtest.h>

#include <array>
#include <limits>
#include <optional>

// Every fifth cell's moves, every class, sampled two ways.
namespace {

	using namespace rules::map;

	constexpr double				   kInfinity = std::numeric_limits<double>::infinity();
	constexpr std::array<RoadClass, 3> kClasses{RoadClass::Highway, RoadClass::BackRoad, RoadClass::Trail};

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

} // namespace
