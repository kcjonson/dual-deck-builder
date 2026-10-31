#include <rules/map/LandFields.h>
#include <rules/map/MapTesting.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <span>
#include <utility>
#include <vector>

namespace {

	using namespace rules::map;

	// The fields over a fixture's land, for params that may differ from the land's in what only the fields
	// read: contamination and ruggedness, the second of which also shapes the land, so only the fields are
	// held to it.
	LandFields fieldsFor(const MapParams& land, const MapParams& params) {
		const Terrain& terrain = fixtures::terrainFor(land);
		return {params, terrain.surface(), terrain.start(), fixtures::terrainStream(land)};
	}

	// Points on a lattice of the disc from `inner` out to the rim.
	std::vector<std::pair<double, double>> pointsPast(int radius, double inner, double step) {
		std::vector<std::pair<double, double>> points;
		for (double x = -radius; x <= radius; x += step) {
			for (double y = -radius; y <= radius; y += step) {
				const double away = x * x + y * y;
				if (away >= inner * inner && away <= static_cast<double>(radius) * radius) {
					points.emplace_back(x, y);
				}
			}
		}
		return points;
	}

	// The cells the shares are calibrated over: past the relief radius and inside the disc.
	std::vector<std::pair<double, double>> calibratedCells(const Terrain& terrain) {
		const LandGrid&						   grid = terrain.surface().grid;
		const double						   inner = terrain.start().relief;
		std::vector<std::pair<double, double>> cells;
		for (int row = 0; row < grid.size; ++row) {
			for (int column = 0; column < grid.size; ++column) {
				const double x = cellCentre(grid, column);
				const double y = cellCentre(grid, row);
				const double away = x * x + y * y;
				if (away >= inner * inner && away <= static_cast<double>(terrain.radius()) * terrain.radius()) {
					cells.emplace_back(x, y);
				}
			}
		}
		return cells;
	}

	TEST(LandFields, MakesTheShareOfTheCountryContaminationAsksForToxicAndNoneInTheMetro) {
		const MapParams& land = fixtures::mixed();
		const Terrain&	 terrain = fixtures::terrainFor(land);
		const auto		 country = pointsPast(land.radius, terrain.start().blend, land.radius / 30.0);
		for (const double level : {0.0, 0.1, 0.5, 0.9, 1.0}) {
			const LandFields fields = fieldsFor(land, fixtures::with(land, &MapParams::contamination, level));
			double			 toxic = 0;
			for (const auto& [x, y] : country) {
				const double value = fields.contamination(x, y);
				ASSERT_GE(value, 0);
				ASSERT_LE(value, 1);
				toxic += value >= 0.5 ? 1 : 0;
			}
			EXPECT_NEAR(toxic / static_cast<double>(country.size()), level, 0.06) << "contamination " << level;
			for (const auto& [x, y] : pointsPast(static_cast<int>(terrain.start().metro), 0, terrain.start().metro / 6)) {
				EXPECT_EQ(fields.contamination(x, y), 0);
			}
		}
	}

	TEST(LandFields, MakesRuggednessTheShareOfRoughCountryAndCliffsTheSteepestOfIt) {
		const MapParams& land = fixtures::rugged();
		const Terrain&	 terrain = fixtures::terrainFor(land);
		const auto		 cells = calibratedCells(terrain);
		const double	 oneCell = 1.0 / static_cast<double>(cells.size());
		for (const double ruggedness : {0.0, 0.2, 0.8}) {
			const LandFields fields = fieldsFor(land, fixtures::with(land, &MapParams::ruggedness, ruggedness));
			double			 rough = 0;
			double			 cliffs = 0;
			for (const auto& [x, y] : cells) {
				rough += fields.rough(x, y) ? 1 : 0;
				cliffs += fields.cliff(x, y) ? 1 : 0;
				if (fields.cliff(x, y)) {
					EXPECT_TRUE(fields.rough(x, y));
					EXPECT_GE(fields.cliffDepth(x, y), -1e-9);
				}
			}
			const double share = rough / static_cast<double>(cells.size());
			EXPECT_NEAR(share, 0.1 + 0.25 * ruggedness, oneCell + 1e-9) << "ruggedness " << ruggedness;
			EXPECT_LE(cliffs / static_cast<double>(cells.size()), 0.05 * ruggedness * ruggedness + oneCell) << "ruggedness " << ruggedness;
			if (ruggedness == 0) {
				EXPECT_EQ(cliffs, 0);
			}
		}
		const LandFields fields = fieldsFor(land, land);
		double			 cliffs = 0;
		for (const auto& [x, y] : cells) {
			cliffs += fields.cliff(x, y) ? 1 : 0;
		}
		EXPECT_GT(cliffs, 0) << "the most rugged corner stands cliffs";
	}

	TEST(LandFields, OpensEverySquareWithNoCliffInItAllOfTheMetroAndNonePastTheRim) {
		const MapParams&  land = fixtures::rugged();
		const Terrain&	  terrain = fixtures::terrainFor(land);
		const LandFields& fields = terrain.fields();
		const LandGrid&	  grid = terrain.surface().grid;
		const int		  squares = grid.size - 1;
		const double	  metro = terrain.start().metro;
		int				  closedInside = 0;
		for (int row = 0; row < squares; ++row) {
			for (int column = 0; column < squares; ++column) {
				const bool	 open = fields.openSquares()[static_cast<size_t>(row * squares + column)] != 0;
				const double left = cellCentre(grid, column);
				const double bottom = cellCentre(grid, row);
				const double farX = std::max(std::abs(left), std::abs(left + grid.cellSize));
				const double farY = std::max(std::abs(bottom), std::abs(bottom + grid.cellSize));
				const double far = std::hypot(farX, farY);
				if (far > terrain.radius()) {
					EXPECT_FALSE(open);
					continue;
				}
				if (far < metro) {
					EXPECT_TRUE(open) << "the metro is open ground";
				}
				if (!open) {
					closedInside += 1;
					continue;
				}
				for (int across = 0; across <= 4; ++across) {
					for (int up = 0; up <= 4; ++up) {
						ASSERT_FALSE(fields.cliff(left + across * grid.cellSize / 4, bottom + up * grid.cellSize / 4));
					}
				}
			}
		}
		EXPECT_GT(closedInside, 0) << "the most rugged corner closes some squares";
	}

	TEST(LandFields, PutsBadlandsOnlyWhereFeaturesHaveRoomAndNoneOnGentleLand) {
		const MapParams&		land = fixtures::badlands();
		const Terrain&			terrain = fixtures::terrainFor(land);
		const LandFields&		fields = terrain.fields();
		const LandGrid&			grid = terrain.surface().grid;
		const LandFields		gentle = fieldsFor(land, fixtures::with(land, &MapParams::ruggedness, 0));
		double					badlands = 0;
		std::span<const double> room = fields.room();
		for (int row = 0; row < grid.size; ++row) {
			for (int column = 0; column < grid.size; ++column) {
				const double x = cellCentre(grid, column);
				const double y = cellCentre(grid, row);
				const double value = fields.badlands(x, y);
				ASSERT_GE(value, 0);
				ASSERT_LE(value, 1);
				if (room[static_cast<size_t>(row * grid.size + column)] == 0) {
					EXPECT_NEAR(value, 0, 1e-9);
				}
				badlands += value >= 0.5 ? 1 : 0;
				EXPECT_EQ(gentle.badlands(x, y), 0);
			}
		}
		EXPECT_GT(badlands, 0);
		EXPECT_EQ(fields.badlands(0, 0), 0);
	}

} // namespace
