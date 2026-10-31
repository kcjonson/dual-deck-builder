#include <rules/map/EdgeCostField.h>
#include <rules/map/Ground.h>
#include <rules/map/Land.h>
#include <rules/map/MapTesting.h>
#include <rules/map/RoadChecks.h>
#include <rules/map/RoadGraph.h>
#include <rules/map/RoadNetwork.h>
#include <rules/map/RoadSearch.h>
#include <rules/map/Roads.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <map>
#include <set>
#include <span>
#include <utility>
#include <vector>

namespace {

	using namespace rules::map;

	// Per cell, the moves that end on it.
	std::vector<std::vector<size_t>> movesAt(const RoadLinks& links, const LandGrid& grid) {
		std::vector<std::vector<size_t>> at(static_cast<size_t>(grid.cells()));
		for (size_t index = 0; index < links.moves.size(); ++index) {
			at[static_cast<size_t>(links.moves[index].from)].push_back(index);
			at[static_cast<size_t>(links.moves[index].to)].push_back(index);
		}
		return at;
	}

	class EveryRoads : public ::testing::TestWithParam<const MapParams*> {};

	INSTANTIATE_TEST_SUITE_P(Roads, EveryRoads, ::testing::Values(&fixtures::mixed(), &fixtures::floodlands(), &fixtures::badlands()));

	TEST_P(EveryRoads, JoinsEveryPlaceWithAHighwayFromEveryHighwayExitAndClosesTheLoopsThePOIsNeed) {
		const MapParams& params = *GetParam();
		const Roads&	 roads = fixtures::roadsFor(params);
		const RoadLinks& links = roads.links();
		const LandGrid&	 grid = fixtures::terrainFor(params).surface().grid;
		EXPECT_TRUE(checkRoads(roads, params, fixtures::groundFor(params)).empty());
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
		// A route number for each highway, which checkRoads has held in range and none twice.
		EXPECT_EQ(roads.network().routeNumbers.size(), static_cast<size_t>(highwayExits));
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
			  return std::array<Point, 2>{
				  Point{.x = cellCentre(grid, move.from % grid.size), .y = cellCentre(grid, move.from / grid.size)},
				  Point{.x = cellCentre(grid, move.to % grid.size), .y = cellCentre(grid, move.to / grid.size)},
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
					const auto ours = segment(move);
					const auto theirs = segment(them);
					EXPECT_FALSE(segmentsMeet(ours[0], ours[1], theirs[0], theirs[1]))
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

	TEST_P(EveryRoads, DrawsANetworkThatKeepsEveryRoadRuleWithEachNodeOnACellCentreMarkedByWhatHappensThere) {
		const MapParams&				 params = *GetParam();
		const Roads&					 roads = fixtures::roadsFor(params);
		const RoadNetwork&				 network = roads.network();
		const Ground					 ground = fixtures::groundFor(params);
		const LandGrid&					 grid = ground.terrain().surface().grid;
		const std::vector<RoadViolation> violations = checkRoadNetwork(network, ground);
		EXPECT_TRUE(violations.empty()) << violations.front().detail;
		ASSERT_FALSE(network.nodes.empty());
		EXPECT_EQ(network.nodes[0].kind, RoadNodeKind::Compound);
		EXPECT_EQ(network.nodes[0].x, 0);
		EXPECT_EQ(network.nodes[0].y, 0);
		// Per node, the stretches ending on it, the broken spans counted, since breaking one leaves its nodes as they were.
		std::vector<RoadStretch> all = network.stretches;
		all.insert(all.end(), network.broken.begin(), network.broken.end());
		std::vector<std::vector<size_t>> ends(network.nodes.size());
		for (size_t id = 0; id < all.size(); ++id) {
			ends[static_cast<size_t>(all[id].from)].push_back(id);
			ends[static_cast<size_t>(all[id].to)].push_back(id);
		}
		const std::vector<Place>	places = placeList(fixtures::placesFor(params));
		const double				metro = ground.terrain().start().metro;
		std::set<int>				cells;
		std::map<RoadNodeKind, int> kinds;
		for (size_t id = 1; id < network.nodes.size(); ++id) {
			const RoadNode& node = network.nodes[id];
			const auto&		meeting = ends[id];
			kinds[node.kind] += 1;
			if (node.kind != RoadNodeKind::Roadside) {
				const int cell = cellAt(grid, node.x, node.y);
				EXPECT_EQ(node.x, cellCentre(grid, cell % grid.size));
				EXPECT_EQ(node.y, cellCentre(grid, cell / grid.size));
				EXPECT_TRUE(cells.insert(cell).second) << "two nodes on cell " << cell;
				EXPECT_GE(node.x * node.x + node.y * node.y, grid.cellSize * grid.cellSize);
			}
			switch (node.kind) {
				case RoadNodeKind::Junction:
					EXPECT_GE(meeting.size(), 3U);
					break;
				case RoadNodeKind::End:
					EXPECT_EQ(meeting.size(), 1U);
					break;
				case RoadNodeKind::ClassChange:
					ASSERT_EQ(meeting.size(), 2U);
					EXPECT_NE(all[meeting[0]].roadClass, all[meeting[1]].roadClass);
					break;
				case RoadNodeKind::MetroEdge:
					EXPECT_LE(node.x * node.x + node.y * node.y, metro * metro);
					break;
				case RoadNodeKind::Roadside:
					EXPECT_EQ(meeting.size(), 2U);
					break;
				default:
					ASSERT_GE(node.place, 1);
					EXPECT_EQ(
						node.kind,
						places[static_cast<size_t>(node.place)].kind == PlaceKind::Town			? RoadNodeKind::Town
						: places[static_cast<size_t>(node.place)].kind == PlaceKind::Village	? RoadNodeKind::Village
						: places[static_cast<size_t>(node.place)].kind == PlaceKind::Crossroads ? RoadNodeKind::Crossroads
																								: RoadNodeKind::Exit
					);
			}
		}
		EXPECT_GT(kinds[RoadNodeKind::Junction], 10);
		EXPECT_GT(kinds[RoadNodeKind::Roadside], 0);
		EXPECT_EQ(roads.loops(), loopCount(network.nodes.size(), network.stretches));
	}

	TEST_P(EveryRoads, CutsStretchesAboutKLongestApartMarksTheStreetsAndNumbersEachHighwayByItsExit) {
		const MapParams&   params = *GetParam();
		const Roads&	   roads = fixtures::roadsFor(params);
		const RoadNetwork& network = roads.network();
		const Terrain&	   terrain = fixtures::terrainFor(params);
		const double	   metro = terrain.start().metro;
		int				   streets = 0;
		int				   bridges = 0;
		std::set<int>	   numbers;
		for (const RoadStretch& stretch : network.stretches) {
			EXPECT_LE(stretch.length, kLongestStretch + 3 * terrain.surface().grid.cellSize);
			const bool inside = std::ranges::all_of(stretch.points, [&](const Point& point) {
				return point.x * point.x + point.y * point.y <= metro * metro;
			});
			EXPECT_EQ(stretch.street, inside);
			streets += stretch.street ? 1 : 0;
			bridges += static_cast<int>(stretch.bridges.size());
			if (stretch.roadClass == RoadClass::Highway) {
				numbers.insert(stretch.highway);
			} else {
				EXPECT_EQ(stretch.highway, -1);
			}
		}
		EXPECT_GT(streets, 0);
		if (&params == &fixtures::floodlands()) {
			EXPECT_GT(bridges, 0);
		}
		ASSERT_FALSE(numbers.empty());
		EXPECT_EQ(*numbers.begin(), 0);
		EXPECT_EQ(numbers.size(), static_cast<size_t>(params.highways));
		EXPECT_LT(*numbers.rbegin(), params.highways);
		// Cells only where a smoothed line would clip something or clash.
		const RoadGraphStats& stats = roads.graphStats();
		EXPECT_LT(stats.cells, 0.05 * (stats.smoothed + stats.unaveraged + stats.simplified + stats.cells));
	}

	TEST_P(EveryRoads, BreaksHighwaySpansFarOutLongEnoughAndNeverOneThatCutsANodeOff) {
		const MapParams&   params = *GetParam();
		const RoadNetwork& network = fixtures::roadsFor(params).network();
		EXPECT_LE(network.broken.size(), static_cast<size_t>(params.brokenHighways));
		for (const RoadStretch& span : network.broken) {
			EXPECT_EQ(span.roadClass, RoadClass::Highway);
			EXPECT_GE(span.length, 70);
		}
		// Planar with the broken spans back in, since they were part of it.
		std::vector<RoadLine> lines;
		for (const auto* list : {&network.stretches, &network.broken}) {
			for (const RoadStretch& stretch : *list) {
				lines.push_back({.from = stretch.from, .to = stretch.to, .points = stretch.points});
			}
		}
		EXPECT_TRUE(roadClashes(network.nodes, lines, false).empty());
	}

	RoadStretch straight(int from, int to, std::vector<Point> points, RoadClass road, int highway) {
		const double length = polylineLength(points);
		return {
			.roadClass = road,
			.from = from,
			.to = to,
			.length = length,
			.points = std::move(points),
			.bridges = {},
			.street = false,
			.highway = highway,
		};
	}

	TEST(Roads, NeverBreaksTheLastHighwayOutOfAHighwayExitThoughTheSpanFurtherInCanBreak) {
		const auto broken = [](std::span<const RoadNode> nodes, std::vector<RoadStretch> stretches, const Place& exit, int radius) {
			foundation::Rng			 rng(4);
			const std::vector<Place> places{{.id = 0, .kind = PlaceKind::Metro}, exit};
			return breakHighways(
					   {.nodes = nodes, .stretches = std::move(stretches), .places = places, .count = 2, .radius = radius, .rng = rng}
			)
				.broken;
		};
		const Place highwayExit{.id = 1, .kind = PlaceKind::Exit, .x = 300, .y = 0, .highway = true};
		Place		backRoadExit = highwayExit;
		backRoadExit.highway = false;

		// Home, junctions 100 and 200 out, and an exit 300 out on one highway, a back road from the first junction round to it.
		const std::vector<RoadNode> line{
			{.kind = RoadNodeKind::Compound, .x = 0, .y = 0, .place = 0},
			{.kind = RoadNodeKind::Junction, .x = 100, .y = 0},
			{.kind = RoadNodeKind::Junction, .x = 200, .y = 0},
			{.kind = RoadNodeKind::Exit, .x = 300, .y = 0, .place = 1},
		};
		const std::vector<RoadStretch> lineStretches{
			straight(0, 1, {{.x = 0, .y = 0}, {.x = 100, .y = 0}}, RoadClass::Highway, 0),
			straight(1, 2, {{.x = 100, .y = 0}, {.x = 200, .y = 0}}, RoadClass::Highway, 0),
			straight(2, 3, {{.x = 200, .y = 0}, {.x = 300, .y = 0}}, RoadClass::Highway, 0),
			straight(1, 3, {{.x = 100, .y = 0}, {.x = 200, .y = 40}, {.x = 300, .y = 0}}, RoadClass::BackRoad, -1),
		};
		// Either span past 0.35 of the radius could break, never both, which would cut the middle junction off; the
		// outer is the highway exit's last highway, so the inner goes.
		const std::vector<RoadStretch> inner = broken(line, lineStretches, highwayExit, 310);
		ASSERT_EQ(inner.size(), 1U);
		EXPECT_EQ(inner[0].from, 1);
		EXPECT_EQ(inner[0].to, 2);
		// A back-road exit can lose either.
		EXPECT_EQ(broken(line, lineStretches, backRoadExit, 310).size(), 1U);

		// Two highways into one exit from junctions to either side, and a back road from Home: either can go, and once
		// one has, the other is the exit's last.
		const std::vector<RoadNode> fork{
			{.kind = RoadNodeKind::Compound, .x = 0, .y = 0, .place = 0},
			{.kind = RoadNodeKind::Junction, .x = 100, .y = 50},
			{.kind = RoadNodeKind::Junction, .x = 100, .y = -50},
			{.kind = RoadNodeKind::Exit, .x = 300, .y = 0, .place = 1},
		};
		const std::vector<RoadStretch> forkStretches{
			straight(0, 1, {{.x = 0, .y = 0}, {.x = 100, .y = 50}}, RoadClass::Highway, 0),
			straight(0, 2, {{.x = 0, .y = 0}, {.x = 100, .y = -50}}, RoadClass::Highway, 1),
			straight(1, 3, {{.x = 100, .y = 50}, {.x = 300, .y = 0}}, RoadClass::Highway, 0),
			straight(2, 3, {{.x = 100, .y = -50}, {.x = 300, .y = 0}}, RoadClass::Highway, 1),
			straight(0, 3, {{.x = 0, .y = 0}, {.x = 150, .y = -150}, {.x = 300, .y = 0}}, RoadClass::BackRoad, -1),
		};
		EXPECT_EQ(broken(fork, forkStretches, highwayExit, 400).size(), 1U);
		EXPECT_EQ(broken(fork, forkStretches, backRoadExit, 400).size(), 2U);
	}
	TEST(Roads, RunsSpurTrailsFromVillagesIntoTheHighCountryEachToADeadEnd) {
		const MapParams&   params = fixtures::badlands();
		const Roads&	   roads = fixtures::roadsFor(params);
		const RoadLinks&   links = roads.links();
		const RoadNetwork& network = roads.network();
		const LandGrid&	   grid = fixtures::terrainFor(params).surface().grid;
		EXPECT_GT(links.stats.spurs, 0);
		ASSERT_EQ(links.spurEnds.size(), static_cast<size_t>(links.stats.spurs));
		const auto touching = movesAt(links, grid);
		for (const int end : links.spurEnds) {
			const auto& moves = touching[static_cast<size_t>(end)];
			ASSERT_FALSE(moves.empty());
			EXPECT_TRUE(std::ranges::any_of(moves, [&](size_t move) { return links.moves[move].roadClass == RoadClass::Trail; }));
			const Point centre{.x = cellCentre(grid, end % grid.size), .y = cellCentre(grid, end / grid.size)};
			const auto node = std::ranges::find_if(network.nodes, [&](const RoadNode& at) { return at.x == centre.x && at.y == centre.y; });
			ASSERT_NE(node, network.nodes.end());
			EXPECT_TRUE(node->kind == RoadNodeKind::End || node->kind == RoadNodeKind::Junction || node->kind == RoadNodeKind::ClassChange);
		}
		EXPECT_TRUE(std::ranges::any_of(network.nodes, [](const RoadNode& node) { return node.kind == RoadNodeKind::End; }));
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

} // namespace
