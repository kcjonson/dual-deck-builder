#include <rules/map/AreaMapPipeline.h>
#include <rules/map/MapTesting.h>
#include <rules/map/Water.h>

#include <random/Rng.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <map>
#include <memory>
#include <span>
#include <string>
#include <utility>
#include <vector>

namespace {

	using namespace rules::map;

	// The routing's noise, as elevation: a cell may drain to a neighbour this much higher, twice over.
	constexpr double kFlatsAmplitude = 0.0015;

	class EveryWater : public ::testing::TestWithParam<const MapParams*> {};

	INSTANTIATE_TEST_SUITE_P(Water, EveryWater, ::testing::Values(&fixtures::mixed(), &fixtures::floodlands(), &fixtures::basin()));

	TEST_P(EveryWater, DrainsEveryCellToTheLandsOutletsDownhillWithinTheRoutingsNoise) {
		const LandSurface& land = fixtures::terrainFor(*GetParam()).surface();
		const Drainage&	   routing = fixtures::waterFor(*GetParam()).drainage();
		EXPECT_EQ(routing.outlets, land.drainage.outlets);
		std::vector<int> outletOf(routing.receivers.size(), -1);
		for (const int cell : routing.order) {
			const auto at = static_cast<size_t>(cell);
			const int  receiver = routing.receivers[at];
			if (receiver < 0) {
				outletOf[at] = cell;
				continue;
			}
			const auto below = static_cast<size_t>(receiver);
			ASSERT_GE(outletOf[below], 0) << "cell " << cell << " comes before the cell it drains to";
			outletOf[at] = outletOf[below];
			EXPECT_LT(land.drainage.levels[below], land.drainage.levels[at] + 2 * kFlatsAmplitude + 1e-12) << "cell " << cell;
		}
		for (const int outlet : outletOf) {
			EXPECT_NE(std::ranges::find(routing.outlets, outlet), routing.outlets.end());
		}
	}

	TEST_P(EveryWater, TracesEveryRiverDownItsDrainageToAnOutletThroughConfluencesAndLakes) {
		const Water&	   water = fixtures::waterFor(*GetParam());
		const Drainage&	   routing = water.drainage();
		const LandSurface& land = fixtures::terrainFor(*GetParam()).surface();
		const auto&		   rivers = water.rivers();
		ASSERT_FALSE(rivers.empty());
		// Where each lake drains to: the river that starts in it.
		std::map<int, size_t> leaving;
		for (size_t id = 0; id < rivers.size(); ++id) {
			const RiverChain& chain = rivers[id].chain;
			ASSERT_GE(chain.cells.size(), 2U);
			for (size_t index = 0; index + 1 < chain.cells.size(); ++index) {
				EXPECT_EQ(routing.receivers[static_cast<size_t>(chain.cells[index])], chain.cells[index + 1]);
			}
			if (chain.start == RiverStart::Lake) {
				leaving[water.lakeOf()[static_cast<size_t>(chain.cells.front())]] = id;
			}
			EXPECT_EQ(chain.end == RiverEnd::Sink, land.closedBasin && chain.end != RiverEnd::Confluence && chain.end != RiverEnd::Lake);
		}
		for (size_t id = 0; id < rivers.size(); ++id) {
			size_t at = id;
			for (size_t step = 0; step <= rivers.size(); ++step) {
				const RiverChain& chain = rivers[at].chain;
				if (chain.end == RiverEnd::Confluence) {
					at = static_cast<size_t>(chain.into);
				} else if (chain.end == RiverEnd::Lake) {
					EXPECT_EQ(water.lakeOf()[static_cast<size_t>(chain.cells.back())], chain.into);
					ASSERT_TRUE(leaving.contains(chain.into)) << "lake " << chain.into << " has no river out";
					at = leaving[chain.into];
				} else {
					break;
				}
			}
			const RiverChain& last = rivers[at].chain;
			ASSERT_TRUE(last.end == RiverEnd::Edge || last.end == RiverEnd::Sink) << "river " << id << " never reaches an outlet";
			EXPECT_LT(routing.receivers[static_cast<size_t>(last.cells.back())], 0);
		}
	}

	TEST_P(EveryWater, DrawsRiversThatTouchWhereTheyJoinWidenAndNeverRunRulerStraight) {
		const Water&   water = fixtures::waterFor(*GetParam());
		const Terrain& terrain = fixtures::terrainFor(*GetParam());
		const double   cell = terrain.surface().grid.cellSize;
		const double   sineOfADegree = 0.017452406437283512;
		for (const River& river : water.rivers()) {
			ASSERT_GE(river.line.size(), 2U);
			for (const RiverPoint& point : river.line) {
				EXPECT_GE(point.width, 1.2);
				EXPECT_LE(point.width, 9);
			}
			EXPECT_GE(river.line.back().width, river.line.front().width);
			if (river.chain.end == RiverEnd::Confluence) {
				const RiverPoint&			   end = river.line.back();
				const std::vector<RiverPoint>& joined = water.rivers()[static_cast<size_t>(river.chain.into)].line;
				double						   nearest = 1e9;
				for (size_t index = 0; index + 1 < joined.size(); ++index) {
					const double dx = joined[index + 1].x - joined[index].x;
					const double dy = joined[index + 1].y - joined[index].y;
					const double t =
						std::clamp(((end.x - joined[index].x) * dx + (end.y - joined[index].y) * dy) / (dx * dx + dy * dy), 0.0, 1.0);
					nearest = std::min(nearest, std::hypot(joined[index].x + dx * t - end.x, joined[index].y + dy * t - end.y));
				}
				EXPECT_LT(nearest, 1e-9) << "a tributary stops short of the river it joins";
			}
			// The longest run of segments within a degree of the heading it started on.
			for (size_t first = 0; first + 1 < river.line.size(); ++first) {
				const double ax = river.line[first + 1].x - river.line[first].x;
				const double ay = river.line[first + 1].y - river.line[first].y;
				double		 run = std::hypot(ax, ay);
				for (size_t next = first + 1; next + 1 < river.line.size(); ++next) {
					const double bx = river.line[next + 1].x - river.line[next].x;
					const double by = river.line[next + 1].y - river.line[next].y;
					const double length = std::hypot(bx, by);
					if (ax * bx + ay * by <= 0 || std::abs(ax * by - ay * bx) > sineOfADegree * std::hypot(ax, ay) * length) {
						break;
					}
					run += length;
				}
				ASSERT_LT(run, 5 * cell) << "a river runs ruler-straight from point " << first;
			}
		}
	}

	TEST_P(EveryWater, KeepsMoistureInRangeAndWetterBesideItsRivers) {
		const Water& water = fixtures::waterFor(*GetParam());
		double		 all = 0;
		for (const double value : water.moisture()) {
			ASSERT_GE(value, 0);
			ASSERT_LE(value, 1);
			all += value;
		}
		double beside = 0;
		double count = 0;
		for (const River& river : water.rivers()) {
			for (const int cell : river.chain.cells) {
				beside += water.moisture()[static_cast<size_t>(cell)];
				count += 1;
			}
		}
		EXPECT_GT(beside / count, all / static_cast<double>(water.moisture().size()));
	}

	TEST(Water, PlacesTheReservoirsAskedForEachHeldBehindItsDamApartAndOffTheStart) {
		const MapParams&   params = fixtures::floodlands();
		const Water&	   water = fixtures::waterFor(params);
		const Terrain&	   terrain = fixtures::terrainFor(params);
		const LandSurface& land = terrain.surface();
		int				   reservoirs = 0;
		for (size_t id = 0; id < water.lakes().size(); ++id) {
			const Lake& lake = water.lakes()[id];
			if (lake.kind != LakeKind::Reservoir) {
				continue;
			}
			reservoirs += 1;
			const double away = std::hypot(lake.dam->x, lake.dam->y);
			EXPECT_GE(away, terrain.start().relief);
			EXPECT_LE(away, 0.88 * params.radius);
			fixtures::expectHeldBehindItsDam(
				land.grid, land.elevation, water.drainage().receivers, water.lakeOf(), static_cast<int>(id), lake
			);
		}
		EXPECT_EQ(reservoirs, params.lakes);
		const LandGrid& grid = land.grid;
		const double	blend = terrain.start().blend;
		for (int cell = 0; cell < grid.cells(); ++cell) {
			const int lake = water.lakeOf()[static_cast<size_t>(cell)];
			EXPECT_EQ(lake >= 0, water.lakeDepth()[static_cast<size_t>(cell)] > 0);
			if (lake < 0) {
				continue;
			}
			const int	 row = cell / grid.size;
			const int	 column = cell % grid.size;
			const double x = cellCentre(grid, column);
			const double y = cellCentre(grid, row);
			EXPECT_GE(x * x + y * y, blend * blend);
			EXPECT_TRUE(row > 0 && column > 0 && row < grid.size - 1 && column < grid.size - 1);
			for (int nextRow = std::max(0, row - 1); nextRow <= std::min(grid.size - 1, row + 1); ++nextRow) {
				for (int nextColumn = std::max(0, column - 1); nextColumn <= std::min(grid.size - 1, column + 1); ++nextColumn) {
					const int other = water.lakeOf()[static_cast<size_t>(nextRow * grid.size + nextColumn)];
					EXPECT_TRUE(other < 0 || other == lake) << "two lakes run together at cell " << cell;
				}
			}
		}
	}

	TEST_P(EveryWater, MeasuresHeightAboveTheNearestWaterLowGroundOnItAndCanyonsInRange) {
		const Water&	   water = fixtures::waterFor(*GetParam());
		const LandSurface& land = fixtures::terrainFor(*GetParam()).surface();
		for (const River& river : water.rivers()) {
			for (const int cell : river.chain.cells) {
				const auto at = static_cast<size_t>(cell);
				if (water.lakeOf()[at] >= 0) {
					continue;
				}
				EXPECT_EQ(water.aboveWater()[at], 0);
				EXPECT_EQ(water.alongToWater()[at], 0);
				EXPECT_EQ(water.lowland()[at], 1);
			}
		}
		for (size_t cell = 0; cell < land.elevation.size(); ++cell) {
			ASSERT_GE(water.aboveWater()[cell], 0);
			ASSERT_GE(water.lowland()[cell], 0);
			ASSERT_LE(water.lowland()[cell], 1);
			ASSERT_GE(water.canyons()[cell], 0);
			ASSERT_LE(water.canyons()[cell], 1);
		}
		// At least the share of the land outside the ranges the lowland level is calibrated to lies under it.
		const Terrain&			  terrain = fixtures::terrainFor(*GetParam());
		const std::vector<double> lowland = landValues(land, GetParam()->radius, terrain.start().relief, water.lowland(), false);
		const auto				  low = std::ranges::count_if(lowland, [](double value) { return value >= 0.5; });
		EXPECT_GE(static_cast<double>(low) / static_cast<double>(lowland.size()), 0.45 - 0.01);
	}

	TEST(Water, CutsCanyonsOnlyOnDryMapsAndOnlyWhereFeaturesHaveRoom) {
		const Water&			canyons = fixtures::waterFor(fixtures::basin());
		const Terrain&			terrain = fixtures::terrainFor(fixtures::basin());
		std::span<const double> room = terrain.fields().room();
		double					cut = 0;
		for (size_t cell = 0; cell < room.size(); ++cell) {
			if (room[cell] == 0) {
				EXPECT_EQ(canyons.canyons()[cell], 0);
			}
			cut += canyons.canyons()[cell] >= 0.5 ? 1 : 0;
		}
		EXPECT_GT(cut, 0) << "the High Desert cuts canyons";
		const MapParams& land = fixtures::mixed();
		for (const Water* wet :
			 {&fixtures::waterFor(fixtures::floodlands()), &fixtures::waterFor(land, fixtures::with(land, &MapParams::aridity, 0.6))}) {
			EXPECT_TRUE(std::ranges::all_of(wet->canyons(), [](double value) { return value == 0; }));
		}
	}

	TEST(Water, MakesNoStandingWaterAtLakesZeroAndNoRiverLeavesAClosedBasin) {
		const Water& water = fixtures::waterFor(fixtures::basin());
		EXPECT_EQ(fixtures::basin().lakes, 0);
		EXPECT_TRUE(water.lakes().empty());
		EXPECT_TRUE(std::ranges::all_of(water.lakeDepth(), [](double depth) { return depth == -1; }));
		for (const River& river : water.rivers()) {
			EXPECT_NE(river.chain.end, RiverEnd::Edge);
		}
	}

	TEST(Water, ShowsMoreOfTheDrainageAsStreamsAtAHigherRiverDensity) {
		const auto riverCells = [](const Water& water) {
			size_t cells = 0;
			for (const River& river : water.rivers()) {
				cells += river.chain.cells.size();
			}
			return cells;
		};
		const MapParams& land = fixtures::mixed();
		EXPECT_GT(
			riverCells(fixtures::waterFor(land, fixtures::with(land, &MapParams::riverDensity, 0.8))),
			riverCells(fixtures::waterFor(land, fixtures::with(land, &MapParams::riverDensity, 0.2)))
		);
	}

	TEST(Water, RunsWetterAsAridityRisesFollowingTheSpecsZeroDryToOneWet) {
		const auto mean = [](const Water& water) {
			double sum = 0;
			for (const double value : water.moisture()) {
				sum += value;
			}
			return sum / static_cast<double>(water.moisture().size());
		};
		const MapParams& land = fixtures::mixed();
		EXPECT_GT(
			mean(fixtures::waterFor(land, fixtures::with(land, &MapParams::aridity, 0.8))),
			mean(fixtures::waterFor(land, fixtures::with(land, &MapParams::aridity, 0.2))) + 0.2
		);
	}

	TEST(Water, MakesOtherWaterOnAnotherStageAttempt) {
		const MapParams& params = fixtures::mixed();
		const Water		 other(params, fixtures::terrainFor(params), fixtures::waterStream(params, 1));
		EXPECT_NE(other.moisture()[0], fixtures::waterFor(params).moisture()[0]);
	}

	TEST(AreaMapPipeline, RunsTheWaterOnAStreamNestedInTheTerrainsAndMakesTheSameMapToTheBit) {
		const MapParams&			  params = fixtures::mixed();
		std::vector<std::string>	  started;
		const PipelineResult<AreaMap> result =
			generateAreaMap(params, {.onProgress = [&](const StageAttempt& attempt) { started.emplace_back(attempt.stage); }});
		EXPECT_EQ(started, (std::vector<std::string>{"terrain", "water"}));
		EXPECT_EQ(result.mapAttempt, 0U);
		EXPECT_TRUE(result.failures.empty());
		ASSERT_EQ(result.stages.size(), 2U);
		EXPECT_EQ(result.stages[0].stream, fixtures::terrainStream(params).seed());
		EXPECT_EQ(result.stages[1].name, "water");
		EXPECT_EQ(result.stages[1].stream, fixtures::waterStream(params).seed());
		ASSERT_TRUE(result.products.terrain.has_value() && result.products.water.has_value());
		EXPECT_EQ(result.products.terrain->surface().elevation, fixtures::terrainFor(params).surface().elevation);
		EXPECT_EQ(result.products.terrain->surface().drainage.levels, fixtures::terrainFor(params).surface().drainage.levels);
		const Water& water = *result.products.water;
		const Water& direct = fixtures::waterFor(params);
		EXPECT_EQ(water.drainage().area, direct.drainage().area);
		EXPECT_EQ(water.moisture().size(), direct.moisture().size());
		EXPECT_TRUE(std::ranges::equal(water.moisture(), direct.moisture()));
		EXPECT_TRUE(std::ranges::equal(water.lakeDepth(), direct.lakeDepth()));
		ASSERT_EQ(water.rivers().size(), direct.rivers().size());
		for (size_t id = 0; id < water.rivers().size(); ++id) {
			ASSERT_EQ(water.rivers()[id].line.size(), direct.rivers()[id].line.size());
			for (size_t index = 0; index < water.rivers()[id].line.size(); ++index) {
				EXPECT_EQ(water.rivers()[id].line[index].x, direct.rivers()[id].line[index].x);
				EXPECT_EQ(water.rivers()[id].line[index].y, direct.rivers()[id].line[index].y);
			}
		}
	}

} // namespace
