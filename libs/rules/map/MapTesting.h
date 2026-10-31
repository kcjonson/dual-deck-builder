#pragma once

// The maps the map tests share, each built once a run. Tests only: nothing in the library includes it.

#include "Lakes.h"
#include "LandGrid.h"
#include "MapParams.h"
#include "ParamValidator.h"
#include "Terrain.h"
#include "Water.h"

#include <random/Rng.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdlib>
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
