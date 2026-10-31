#pragma once

// The maps the map tests share, each built once a run. Tests only: nothing in the library includes it.

#include "AreaMapPipeline.h"
#include "Ground.h"
#include "Hazards.h"
#include "Lakes.h"
#include "LandGrid.h"
#include "MapParams.h"
#include "ParamValidator.h"
#include "PlaceNames.h"
#include "Places.h"
#include "RoadChecks.h"
#include "Roads.h"
#include "Terrain.h"
#include "Water.h"

#include <random/Rng.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <initializer_list>
#include <memory>
#include <span>
#include <utility>
#include <vector>

namespace rules::map::fixtures {

	// Validated params at the smallest radius the tuning range allows, which keeps the maps quick.
	inline MapParams paramsFor(uint32_t seed, Environment environment, std::initializer_list<std::pair<NumberParam, double>> overrides) {
		MapParamSet set{.seed = seed, .environment = environment, .overrides = {}};
		set.overrides[static_cast<size_t>(NumberParam::Radius)] = 600;
		for (const auto& [param, value] : overrides) {
			set.overrides[static_cast<size_t>(param)] = value;
		}
		const ValidatedMapParams validated = validateMapParams(resolveMapParams(set));
		assert(validated.clamps.empty() && "the test maps are valid as written");
		return validated.params;
	}

	inline const MapParams& mixed() {
		static const MapParams params = paramsFor(2183746551, Environment::Mixed, {});
		return params;
	}

	// A dry closed basin, terraced, with no lakes.
	inline const MapParams& basin() {
		static const MapParams params = paramsFor(17, Environment::HighDesert, {{NumberParam::Rivers, 0}});
		return params;
	}

	// Ranges all round the smallest metro, at the tuning range's hardest corner for it.
	inline const MapParams& rugged() {
		static const MapParams params = paramsFor(
			19,
			Environment::Mixed,
			{{NumberParam::MountainCoverage, 1},
			 {NumberParam::Ruggedness, 1},
			 {NumberParam::Aridity, 0},
			 {NumberParam::MetroSize, 0.08},
			 {NumberParam::Rivers, 6}}
		);
		return params;
	}

	// Wet and low, with five reservoirs.
	inline const MapParams& floodlands() {
		static const MapParams params = paramsFor(7, Environment::Floodlands, {});
		return params;
	}

	// Rugged, toxic, and broken.
	inline const MapParams& badlands() {
		static const MapParams params = paramsFor(7, Environment::Badlands, {});
		return params;
	}

	// The params with one number changed, for what only a later stage reads.
	inline MapParams with(MapParams params, double MapParams::* field, double value) {
		params.*field = value;
		return params;
	}

	// The terrain stage's stream for map attempt 0.
	inline foundation::Rng terrainStream(const MapParams& params, uint32_t attempt = 0) {
		return foundation::Rng(params.seed).fork("map", 0).fork("terrain", attempt);
	}

	// The terrain for the params on terrainStream(params), built the first time it's asked for.
	inline const Terrain& terrainFor(const MapParams& params) {
		static std::vector<std::pair<MapParams, std::unique_ptr<Terrain>>> built;
		for (const auto& [key, terrain] : built) {
			if (key == params) {
				return *terrain;
			}
		}
		built.emplace_back(params, std::make_unique<Terrain>(params, terrainStream(params)));
		return *built.back().second;
	}

	// The water stage's stream over terrainStream(params).
	inline foundation::Rng waterStream(const MapParams& params, uint32_t attempt = 0) {
		return foundation::Rng(terrainStream(params).seed()).fork("water", attempt);
	}

	// The water over `land`'s terrain for params that may differ from the terrain's in what only the water
	// reads, built the first time it's asked for.
	inline const Water& waterFor(const MapParams& land, const MapParams& params) {
		static std::vector<std::pair<MapParams, std::unique_ptr<Water>>> built;
		for (const auto& [key, water] : built) {
			if (key == params) {
				return *water;
			}
		}
		built.emplace_back(params, std::make_unique<Water>(params, terrainFor(land), waterStream(land)));
		return *built.back().second;
	}

	inline const Water& waterFor(const MapParams& params) {
		return waterFor(params, params);
	}

	// The hazards stage's stream over waterStream(params).
	inline foundation::Rng hazardsStream(const MapParams& params, uint32_t attempt = 0) {
		return foundation::Rng(waterStream(params).seed()).fork("hazards", attempt);
	}

	// The hazards over the fixture's terrain and water, built the first time they're asked for.
	inline const Hazards& hazardsFor(const MapParams& params) {
		static std::vector<std::pair<MapParams, std::unique_ptr<Hazards>>> built;
		for (const auto& [key, hazards] : built) {
			if (key == params) {
				return *hazards;
			}
		}
		built.emplace_back(params, std::make_unique<Hazards>(params, terrainFor(params), waterFor(params), hazardsStream(params)));
		return *built.back().second;
	}

	// The base pack's map content.
	inline const MapContent& content() {
		static const MapContent read = readMapContent(std::filesystem::path(DDB_PACKS_DIR) / "base");
		return read;
	}

	inline const PlaceNamePool& placeNames() {
		return content().placeNames;
	}

	// The places stage's stream over hazardsStream(params).
	inline foundation::Rng placesStream(const MapParams& params, uint32_t attempt = 0) {
		return foundation::Rng(hazardsStream(params).seed()).fork("places", attempt);
	}

	// The places over the fixture's other layers, built the first time they're asked for.
	inline const Places& placesFor(const MapParams& params) {
		static std::vector<std::pair<MapParams, std::unique_ptr<Places>>> built;
		for (const auto& [key, places] : built) {
			if (key == params) {
				return *places;
			}
		}
		built.emplace_back(
			params,
			std::make_unique<Places>(params, terrainFor(params), waterFor(params), hazardsFor(params), placeNames(), placesStream(params))
		);
		return *built.back().second;
	}

	// The roads stage's stream over placesStream(params).
	inline foundation::Rng roadsStream(const MapParams& params, uint32_t attempt = 0) {
		return foundation::Rng(placesStream(params).seed()).fork("roads", attempt);
	}

	// The roads over the fixture's other layers, built the first time they're asked for.
	inline const Roads& roadsFor(const MapParams& params) {
		static std::vector<std::pair<MapParams, std::unique_ptr<Roads>>> built;
		for (const auto& [key, roads] : built) {
			if (key == params) {
				return *roads;
			}
		}
		built.emplace_back(
			params,
			std::make_unique<Roads>(
				params, terrainFor(params), waterFor(params), hazardsFor(params), placesFor(params), roadsStream(params)
			)
		);
		return *built.back().second;
	}

	// The route tree over the fixture's roads.
	inline const RouteTree& treeFor(const MapParams& params) {
		static std::vector<std::pair<MapParams, std::unique_ptr<RouteTree>>> built;
		for (const auto& [key, tree] : built) {
			if (key == params) {
				return *tree;
			}
		}
		built.emplace_back(
			params,
			std::make_unique<RouteTree>(buildRouteTree({
				.network = roadsFor(params).network(),
				.travelPace = params.travelPace,
				.routeSplit = params.routeSplit,
			}))
		);
		return *built.back().second;
	}

	// The POI stage's stream over the roads' and the route tree's link.
	inline foundation::Rng poisStream(const MapParams& params, uint32_t attempt = 0) {
		return foundation::Rng(foundation::Rng(roadsStream(params).seed()).fork("routeTree", 0).seed()).fork("pois", attempt);
	}

	// The POIs over the fixture's route tree, built the first time they're asked for.
	inline const PoiLayer& poisFor(const MapParams& params) {
		static std::vector<std::pair<MapParams, std::unique_ptr<PoiLayer>>> built;
		for (const auto& [key, layer] : built) {
			if (key == params) {
				return *layer;
			}
		}
		const PoiGround ground =
			poiGround(Ground(terrainFor(params), waterFor(params), hazardsFor(params)), placesFor(params), params.radius);
		built.emplace_back(
			params,
			std::make_unique<PoiLayer>(placePois({
				.network = roadsFor(params).network(),
				.tree = treeFor(params),
				.ground = ground,
				.params = params,
				.tuning = content().pois,
				.factions = content().factions,
				.stops = content().stops,
				.stream = poisStream(params),
			}))
		);
		return *built.back().second;
	}

	// Whether two roads stages laid the same roads, move for move, and drew the same network, point for point, its
	// highways numbered alike.
	inline bool sameRoads(const Roads& a, const Roads& b) {
		const bool moves = std::ranges::equal(a.links().moves, b.links().moves, [](const RoadMove& left, const RoadMove& right) {
			return left.from == right.from && left.direction == right.direction && left.roadClass == right.roadClass &&
				   left.highway == right.highway;
		});
		const auto sameStretch = [](const RoadStretch& left, const RoadStretch& right) {
			return left.from == right.from && left.to == right.to && left.roadClass == right.roadClass && left.highway == right.highway &&
				   left.points == right.points;
		};
		const RoadNetwork& first = a.network();
		const RoadNetwork& second = b.network();
		return moves && first.nodes.size() == second.nodes.size() && std::ranges::equal(first.stretches, second.stretches, sameStretch) &&
			   std::ranges::equal(first.broken, second.broken, sameStretch) && first.routeNumbers == second.routeNumbers;
	}
	// The land and its water, before the hazards' craters and plumes.
	inline Ground waterGroundFor(const MapParams& params) {
		return {terrainFor(params), waterFor(params)};
	}

	// The ground under the fixture's roads: the land with its water and hazards.
	inline Ground groundFor(const MapParams& params) {
		return {terrainFor(params), waterFor(params), hazardsFor(params)};
	}

	// Whether a road along the segment passes, as the network checks sample it: every sample everything, where
	// the edge cost field asks only after what could be there.
	inline bool passableAlong(const Ground& ground, double x0, double y0, double x1, double y1) {
		const std::array<Point, 2> line{Point{.x = x0, .y = y0}, Point{.x = x1, .y = y1}};
		return !impassableAlong(ground, line, polylineBridges(ground, line)).has_value();
	}
	// What holding behind a dam means: every lake cell stands under the level and drains into the lake, the
	// dam out of it, and every dry cell side by side with it that the water would reach stands at the level
	// or over, or lies on the dam's wall or downstream of it, within its reach.
	inline void expectHeldBehindItsDam(
		const LandGrid&			grid,
		std::span<const double> elevation,
		std::span<const int>	receivers,
		std::span<const int>	lakeOf,
		int						id,
		const Lake&				lake
	) {
		ASSERT_TRUE(lake.dam.has_value());
		const Dam& site = *lake.dam;
		const int  dam = cellAt(grid, site.x, site.y);
		const int  size = grid.size;
		const int  towardColumn = static_cast<int>(std::lround(site.towardX / std::max(std::abs(site.towardX), std::abs(site.towardY))));
		const int  towardRow = static_cast<int>(std::lround(site.towardY / std::max(std::abs(site.towardX), std::abs(site.towardY))));
		const int  reach = towardColumn != 0 && towardRow != 0 ? 6 : 3;
		const auto heldBack = [&](int cell) {
			const int column = cell % size - dam % size;
			const int row = cell / size - dam / size;
			return column * towardColumn + row * towardRow >= 0 && std::abs(row * towardColumn - column * towardRow) <= reach;
		};
		EXPECT_EQ(lakeOf[static_cast<size_t>(dam)], id);
		int cells = 0;
		for (int cell = 0; cell < grid.cells(); ++cell) {
			if (lakeOf[static_cast<size_t>(cell)] != id) {
				continue;
			}
			cells += 1;
			EXPECT_LT(elevation[static_cast<size_t>(cell)], lake.level);
			if (cell != dam) {
				EXPECT_EQ(lakeOf[static_cast<size_t>(receivers[static_cast<size_t>(cell)])], id)
					<< "cell " << cell << " drains out of its lake";
			}
			for (const auto& [stepColumn, stepRow] : {std::pair{1, 0}, std::pair{-1, 0}, std::pair{0, 1}, std::pair{0, -1}}) {
				const int column = cell % size + stepColumn;
				const int row = cell / size + stepRow;
				if (column < 0 || row < 0 || column >= size || row >= size) {
					continue;
				}
				const int next = row * size + column;
				if (lakeOf[static_cast<size_t>(next)] == id || elevation[static_cast<size_t>(next)] >= lake.level) {
					continue;
				}
				EXPECT_TRUE(heldBack(next)) << "the water stands over cell " << next << " beside its lake";
			}
		}
		EXPECT_EQ(cells, lake.cells);
	}

} // namespace rules::map::fixtures
