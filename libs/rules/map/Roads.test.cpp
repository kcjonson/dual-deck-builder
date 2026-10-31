#include <rules/map/AreaMapPipeline.h>
#include <rules/map/EdgeCostField.h>
#include <rules/map/Ground.h>
#include <rules/map/Land.h>
#include <rules/map/MapTesting.h>
#include <rules/map/RoadSearch.h>
#include <rules/map/Roads.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <utility>
#include <vector>

namespace {

	using namespace rules::map;

	Roads roadsWith(const MapParams& land, const MapParams& params) {
		return {
			params,
			fixtures::terrainFor(land),
			fixtures::waterFor(land),
			fixtures::hazardsFor(land),
			fixtures::placesFor(land),
			fixtures::roadsStream(land),
		};
	}

	// Per cell, the moves that end on it.
	std::vector<std::vector<size_t>> movesAt(const RoadLinks& links, const LandGrid& grid) {
		std::vector<std::vector<size_t>> at(static_cast<size_t>(grid.cells()));
		for (size_t index = 0; index < links.moves.size(); ++index) {
			at[static_cast<size_t>(links.moves[index].from)].push_back(index);
			at[static_cast<size_t>(links.moves[index].to)].push_back(index);
		}
		return at;
	}

	double length(const RoadLinks& links, RoadClass road) {
		double total = 0;
		for (const RoadMove& move : links.moves) {
			total += move.roadClass == road ? move.length : 0;
		}
		return total;
	}

	// Twice the signed area of (a, b, p): which side of a to b p is on.
	double orientation(double ax, double ay, double bx, double by, double px, double py) {
		return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
	}

	// Whether two segments share a point, crossing or touching.
	bool segmentsMeet(const std::array<double, 4>& a, const std::array<double, 4>& b) {
		const double first = orientation(b[0], b[1], b[2], b[3], a[0], a[1]);
		const double second = orientation(b[0], b[1], b[2], b[3], a[2], a[3]);
		const double third = orientation(a[0], a[1], a[2], a[3], b[0], b[1]);
		const double fourth = orientation(a[0], a[1], a[2], a[3], b[2], b[3]);
		const auto	 within = [](double ax, double ay, double bx, double by, double px, double py) {
			  return px >= std::min(ax, bx) && px <= std::max(ax, bx) && py >= std::min(ay, by) && py <= std::max(ay, by);
		};
		if (((first > 0 && second < 0) || (first < 0 && second > 0)) && ((third > 0 && fourth < 0) || (third < 0 && fourth > 0))) {
			return true;
		}
		return (first == 0 && within(b[0], b[1], b[2], b[3], a[0], a[1])) || (second == 0 && within(b[0], b[1], b[2], b[3], a[2], a[3])) ||
			   (third == 0 && within(a[0], a[1], a[2], a[3], b[0], b[1])) || (fourth == 0 && within(a[0], a[1], a[2], a[3], b[2], b[3]));
	}

	class EveryRoads : public ::testing::TestWithParam<const MapParams*> {};

	INSTANTIATE_TEST_SUITE_P(Roads, EveryRoads, ::testing::Values(&fixtures::mixed(), &fixtures::floodlands(), &fixtures::badlands()));

	TEST_P(EveryRoads, JoinsEveryPlaceWithAHighwayFromEveryHighwayExitAndClosesTheLoopsThePOIsNeed) {
		const MapParams& params = *GetParam();
		const Roads&	 roads = fixtures::roadsFor(params);
		const RoadLinks& links = roads.links();
		const LandGrid&	 grid = fixtures::terrainFor(params).surface().grid;
		EXPECT_TRUE(checkRoads(roads, params).empty());
		EXPECT_TRUE(links.stats.unreached.empty());
		EXPECT_GE(roads.loops(), loopsNeeded(params, roads.inland()));
		const std::vector<Place> places = placeList(fixtures::placesFor(params));
		ASSERT_EQ(links.placeCells.size(), places.size());
		const auto touching = movesAt(links, grid);
		int		   highwayExits = 0;
		for (const Place& place : places) {
			const int cell = links.placeCells[static_cast<size_t>(place.id)];
			ASSERT_GE(cell, 0) << "place " << place.id;
			if (place.kind == PlaceKind::Metro) {
				continue;
			}
			const auto& moves = touching[static_cast<size_t>(cell)];
			EXPECT_FALSE(moves.empty()) << "place " << place.id;
			if (place.kind == PlaceKind::Exit && place.highway) {
				highwayExits += 1;
				EXPECT_TRUE(std::ranges::any_of(moves, [&](size_t move) { return links.moves[move].roadClass == RoadClass::Highway; }))
					<< "highway exit " << place.id;
			}
		}
		EXPECT_EQ(links.stats.highways, highwayExits);
		EXPECT_EQ(roads.inland(), static_cast<int>(places.size()) - 1 - static_cast<int>(fixtures::placesFor(params).exits().size()));
	}

	TEST_P(EveryRoads, LaysNoRoadOverAnObstacleOrAnUnbridgedRiverNorAHighwayUpTooSteepAClimb) {
		const MapParams& params = *GetParam();
		const RoadLinks& links = fixtures::roadsFor(params).links();
		const Ground	 ground = fixtures::groundFor(params);
		const Terrain&	 terrain = ground.terrain();
		const LandGrid&	 grid = terrain.surface().grid;
		const double	 rim = terrain.radius() - 0.5;
		for (const RoadMove& move : links.moves) {
			const double x0 = cellCentre(grid, move.from % grid.size);
			const double y0 = cellCentre(grid, move.from / grid.size);
			const double x1 = cellCentre(grid, move.to % grid.size);
			const double y1 = cellCentre(grid, move.to / grid.size);
			EXPECT_LT(x0 * x0 + y0 * y0, rim * rim);
			EXPECT_LT(x1 * x1 + y1 * y1, rim * rim);
			EXPECT_TRUE(fixtures::passableAlong(ground, x0, y0, x1, y1)) << "a road from cell " << move.from << " to " << move.to;
			if (move.roadClass != RoadClass::Trail) {
				EXPECT_LE(std::abs(terrain.elevation(x1, y1) - terrain.elevation(x0, y0)) * kRelief / move.length, 1.1);
			}
		}
		const Terrain&		  land = fixtures::terrainFor(params);
		std::vector<RoadPass> passes = links.passes;
		for (size_t index = 0; index < passes.size(); ++index) {
			EXPECT_GE(land.mountains(passes[index].x, passes[index].y), 0.5);
			for (size_t other = 0; other < index; ++other) {
				EXPECT_GE(std::hypot(passes[index].x - passes[other].x, passes[index].y - passes[other].y), 30);
			}
		}
	}

	TEST_P(EveryRoads, IsPlanarOnTheGridSoRoadsMeetOnlyAtACellTheyShare) {
		const MapParams& params = *GetParam();
		const RoadLinks& links = fixtures::roadsFor(params).links();
		const LandGrid&	 grid = fixtures::terrainFor(params).surface().grid;
		const auto		 segment = [&](const RoadMove& move) {
			  return std::array<double, 4>{
				  cellCentre(grid, move.from % grid.size),
				  cellCentre(grid, move.from / grid.size),
				  cellCentre(grid, move.to % grid.size),
				  cellCentre(grid, move.to / grid.size),
			  };
		};
		// Each move filed under every cell of its box: two that meet share one.
		std::vector<std::vector<size_t>> filed(static_cast<size_t>(grid.cells()));
		const auto						 eachCell = [&](const RoadMove& move, auto&& visit) {
			  const int size = grid.size;
			  for (int row = std::min(move.from, move.to) / size; row <= std::max(move.from, move.to) / size; ++row) {
				  for (int column = std::min(move.from % size, move.to % size); column <= std::max(move.from % size, move.to % size);
					   ++column) {
					  visit(static_cast<size_t>(row * size + column));
				  }
			  }
		};
		for (size_t index = 0; index < links.moves.size(); ++index) {
			eachCell(links.moves[index], [&](size_t cell) { filed[cell].push_back(index); });
		}
		const std::array<int, 4> compound = compoundCells(grid);
		const auto				 inCompound = [&](int cell) {
			  return std::ranges::find(compound, cell) != compound.end();
		};
		int checked = 0;
		for (size_t index = 0; index < links.moves.size(); ++index) {
			const RoadMove& move = links.moves[index];
			if (index > 0) {
				const RoadMove& before = links.moves[index - 1];
				EXPECT_TRUE(before.from < move.from || (before.from == move.from && before.direction < move.direction))
					<< "filed once, in order";
			}
			EXPECT_FALSE(inCompound(move.from) && inCompound(move.to));
			std::vector<size_t> near;
			eachCell(move, [&](size_t cell) { near.insert(near.end(), filed[cell].begin(), filed[cell].end()); });
			std::ranges::sort(near);
			const auto [first, last] = std::ranges::unique(near);
			near.erase(first, last);
			for (const size_t other : near) {
				if (other <= index) {
					continue;
				}
				const RoadMove& them = links.moves[other];
				const bool		shared = move.from == them.from || move.from == them.to || move.to == them.from || move.to == them.to;
				if (!shared) {
					EXPECT_FALSE(segmentsMeet(segment(move), segment(them)))
						<< "roads from cell " << move.from << " and " << them.from << " cross";
				}
				checked += 1;
			}
		}
		EXPECT_GT(checked, 1000);
		// Each cell beside the compound has one move into it at most, so each of its roads leaves it once.
		const auto touching = movesAt(links, grid);
		for (int cell = 0; cell < grid.cells(); ++cell) {
			if (inCompound(cell)) {
				continue;
			}
			const auto ins = std::ranges::count_if(touching[static_cast<size_t>(cell)], [&](size_t index) {
				const RoadMove& move = links.moves[index];
				return move.direction < kNeighbours && (inCompound(move.from) || inCompound(move.to));
			});
			EXPECT_LE(ins, 1) << "cell " << cell;
		}
	}

	// Trail share only says which back roads are trails, never where a road runs, so one map serves both.
	TEST(Roads, ClosesMoreLoopsAsLoopsRisesAndGivesOutToTrailsMoreReadilyAsTrailShareDoes) {
		const MapParams& land = fixtures::mixed();
		const Roads&	 some = fixtures::roadsFor(land);
		const Roads		 more = roadsWith(land, fixtures::with(fixtures::with(land, &MapParams::loops, 1), &MapParams::trailShare, 1));
		EXPECT_GT(more.links().stats.looped, some.links().stats.looped);
		EXPECT_LT(more.links().stats.skipped, some.links().stats.skipped);
		EXPECT_GT(more.loops(), some.loops());
		// A link joining places not yet joined goes in whatever loops is.
		EXPECT_EQ(more.links().stats.joined + more.links().stats.failed, some.links().stats.joined + some.links().stats.failed);
		const auto trailShare = [](const RoadLinks& links) {
			const double trails = length(links, RoadClass::Trail);
			return trails / (trails + length(links, RoadClass::BackRoad));
		};
		EXPECT_GT(trailShare(more.links()), 1.5 * trailShare(some.links()));
	}

	TEST(Roads, RunsSpurTrailsFromVillagesIntoTheHighCountryEachToADeadEnd) {
		const MapParams& params = fixtures::badlands();
		const RoadLinks& links = fixtures::roadsFor(params).links();
		const LandGrid&	 grid = fixtures::terrainFor(params).surface().grid;
		EXPECT_GT(links.stats.spurs, 0);
		ASSERT_EQ(links.spurEnds.size(), static_cast<size_t>(links.stats.spurs));
		const auto touching = movesAt(links, grid);
		int		   deadEnds = 0;
		for (const int end : links.spurEnds) {
			const auto& moves = touching[static_cast<size_t>(end)];
			ASSERT_FALSE(moves.empty());
			EXPECT_TRUE(std::ranges::any_of(moves, [&](size_t move) { return links.moves[move].roadClass == RoadClass::Trail; }));
			deadEnds += moves.size() == 1 ? 1 : 0;
		}
		EXPECT_GT(deadEnds, 0);
	}

	TEST(Roads, TakesAHighwayOverGentlerGroundThanATrailBetweenTheSamePlaces) {
		const MapParams&		 params = fixtures::badlands();
		const Ground			 ground = fixtures::groundFor(params);
		EdgeCostField			 field(ground, params.curviness);
		const RoadLinks&		 links = fixtures::roadsFor(params).links();
		const std::vector<Place> places = placeList(fixtures::placesFor(params));
		const auto				 cost = [&](const std::vector<int>& path, RoadClass road) {
			  double total = 0;
			  for (size_t step = 0; step + 1 < path.size(); ++step) {
				  const int columns = path[step + 1] % field.size() - path[step] % field.size();
				  const int rows = path[step + 1] / field.size() - path[step] / field.size();
				  total += field.cost(field.edge(path[step], moveBetween(columns, rows)), road);
			  }
			  return total;
		};
		const auto climb = [&](const std::vector<int>& path) {
			double total = 0;
			for (size_t step = 0; step + 1 < path.size(); ++step) {
				const int columns = path[step + 1] % field.size() - path[step] % field.size();
				const int rows = path[step + 1] / field.size() - path[step] / field.size();
				const int edge = field.edge(path[step], moveBetween(columns, rows));
				total += field.length(edge) * field.grade(edge) * field.grade(edge);
			}
			return total;
		};
		double highwayClimb = 0;
		double trailClimb = 0;
		int	   pairs = 0;
		for (const Place& town : places) {
			if (town.kind != PlaceKind::Town) {
				continue;
			}
			const int			   from = links.placeCells[static_cast<size_t>(town.id)];
			const int			   to = links.placeCells[0];
			const std::vector<int> highway = cheapestPath(field, from, to, RoadClass::Highway);
			const std::vector<int> trail = cheapestPath(field, from, to, RoadClass::Trail);
			ASSERT_FALSE(highway.empty());
			ASSERT_FALSE(trail.empty());
			// Each is the cheapest for its own class.
			EXPECT_LE(cost(highway, RoadClass::Highway), cost(trail, RoadClass::Highway));
			EXPECT_LE(cost(trail, RoadClass::Trail), cost(highway, RoadClass::Trail));
			highwayClimb += climb(highway);
			trailClimb += climb(trail);
			pairs += 1;
		}
		EXPECT_GE(pairs, 2);
		EXPECT_LT(highwayClimb, 0.8 * trailClimb);
	}

	TEST(Roads, AsksNoMoreLoopsThanTheTownsVillagesAndCrossroadsCanClose) {
		MapParams params = fixtures::mixed();
		params.poiDensity = 1;
		params.strongholds = 4;
		params.loops = 0.5;
		EXPECT_EQ(loopsWanted(params), 34);
		// Past the first four places, three tenths of a loop each at loops 0, rising to 0.6 from a third up.
		EXPECT_EQ(loopsNeeded(params, 13), 6);
		EXPECT_EQ(loopsNeeded(params, 1000), 34);
		EXPECT_EQ(loopsNeeded(fixtures::with(params, &MapParams::loops, 0), 13), 3);
		EXPECT_EQ(loopsNeeded(fixtures::with(params, &MapParams::loops, 0.15), 13), 4);
		EXPECT_EQ(loopsNeeded(fixtures::with(params, &MapParams::loops, 1), 3), 0);
		// The campaign's corner, on 78 places: no cap.
		params.poiDensity = 1.2;
		params.strongholds = 5;
		params.loops = 0.3;
		EXPECT_EQ(loopsNeeded(params, 78), 41);
	}

	TEST(AreaMapPipeline, RetriesTheRoadsAloneLeavingTheEarlierStagesAsTheyWere) {
		const MapParams&			  params = fixtures::mixed();
		const PipelineResult<AreaMap> result =
			generateAreaMap(params, fixtures::placeNames(), {.accept = [](const AreaMap&, const StageAttempt& attempt) {
								return attempt.stage == "roads" && attempt.attempt == 0 ? Problems{"no roads there"} : Problems{};
							}});
		ASSERT_EQ(result.stages.size(), 5U);
		EXPECT_EQ(result.stages[0].stream, fixtures::terrainStream(params).seed());
		EXPECT_EQ(result.stages[1].stream, fixtures::waterStream(params).seed());
		EXPECT_EQ(result.stages[2].stream, fixtures::hazardsStream(params).seed());
		EXPECT_EQ(result.stages[3].stream, fixtures::placesStream(params).seed());
		EXPECT_EQ(result.stages[4].attempt, 1U);
		EXPECT_EQ(result.stages[4].stream, fixtures::roadsStream(params, 1).seed());
		EXPECT_EQ(result.products.places->crossroads().front().x, fixtures::placesFor(params).crossroads().front().x);
		ASSERT_EQ(result.failures.size(), 1U);
		EXPECT_EQ(result.failures[0].stage, "roads");
		// Another attempt links the places in another order.
		EXPECT_FALSE(fixtures::sameRoads(result.products.roads->links(), fixtures::roadsFor(params).links()));
	}

} // namespace
