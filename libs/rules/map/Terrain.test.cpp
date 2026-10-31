#include <rules/map/MapTesting.h>
#include <rules/map/Terrain.h>

#include <random/Rng.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <utility>
#include <vector>

namespace {

	using namespace rules::map;

	const MapParams& kMixed = fixtures::mixed();
	const MapParams& kBasin = fixtures::basin();
	const MapParams& kRugged = fixtures::rugged();

	double distanceSquared(const LandGrid& grid, size_t cell) {
		const double x = cellCentre(grid, static_cast<int>(cell) % grid.size);
		const double y = cellCentre(grid, static_cast<int>(cell) / grid.size);
		return x * x + y * y;
	}

	class EveryMap : public ::testing::TestWithParam<const MapParams*> {};

	INSTANTIATE_TEST_SUITE_P(Terrain, EveryMap, ::testing::Values(&kMixed, &kBasin, &kRugged));

	TEST_P(EveryMap, DrainsEveryCellDownhillOnTheWaterLevelsToAnOutlet) {
		const LandSurface& land = fixtures::terrainFor(*GetParam()).surface();
		const Drainage&	   drainage = land.drainage;
		ASSERT_EQ(drainage.size, land.grid.size);
		std::vector<int> reached(drainage.receivers.size(), -1);
		for (const int cell : drainage.order) {
			const int receiver = drainage.receivers[static_cast<size_t>(cell)];
			if (receiver < 0) {
				reached[static_cast<size_t>(cell)] = cell;
				continue;
			}
			ASSERT_GE(reached[static_cast<size_t>(receiver)], 0) << "cell " << cell << " comes before the cell it drains to";
			EXPECT_GT(drainage.levels[static_cast<size_t>(cell)], drainage.levels[static_cast<size_t>(receiver)]);
			reached[static_cast<size_t>(cell)] = reached[static_cast<size_t>(receiver)];
		}
		double outletArea = 0;
		for (const int outlet : drainage.outlets) {
			outletArea += drainage.area[static_cast<size_t>(outlet)];
		}
		EXPECT_EQ(outletArea, land.grid.cells());
	}

	TEST_P(EveryMap, StandsWaterInFewCells) {
		const LandSurface& land = fixtures::terrainFor(*GetParam()).surface();
		double			   standing = 0;
		for (size_t cell = 0; cell < land.elevation.size(); ++cell) {
			standing += land.drainage.levels[cell] > land.elevation[cell] ? 1 : 0;
		}
		EXPECT_LT(standing / static_cast<double>(land.elevation.size()), 0.1);
	}

	TEST_P(EveryMap, KeepsTheMetroFlatAndDry) {
		const Terrain&	   terrain = fixtures::terrainFor(*GetParam());
		const LandSurface& land = terrain.surface();
		const LandGrid&	   grid = land.grid;
		const StartRadii&  radii = terrain.start();
		const double	   peak = std::ranges::max(land.elevation);
		double			   low = 1;
		double			   high = 0;
		for (size_t cell = 0; cell < land.elevation.size(); ++cell) {
			const double away = distanceSquared(grid, cell);
			if (away <= radii.metro * radii.metro) {
				low = std::min(low, land.elevation[cell]);
				high = std::max(high, land.elevation[cell]);
				const auto	 size = static_cast<size_t>(grid.size);
				const double slopeX = (land.elevation[cell + 1] - land.elevation[cell - 1]) / (2 * grid.cellSize);
				const double slopeY = (land.elevation[cell + size] - land.elevation[cell - size]) / (2 * grid.cellSize);
				// Capped cell to cell at kMetroGrade; the cells at its edge reach into the blend ring.
				EXPECT_LT(std::hypot(slopeX, slopeY) * kRelief, 1.5 * kMetroGrade);
				EXPECT_EQ(land.mountains[cell], 0);
			}
			if (away <= radii.blend * radii.blend) {
				EXPECT_EQ(land.drainage.levels[cell], land.elevation[cell]) << "water stands round the metro";
			}
		}
		EXPECT_LE(high - low, kMetroRelief * peak);
	}

	TEST_P(EveryMap, SamplesASlopeThatIsElevationsGradient) {
		const Terrain& terrain = fixtures::terrainFor(*GetParam());
		const double   step = 1e-4;
		for (double x = -500; x <= 500; x += 83.3) {
			for (double y = -500; y <= 500; y += 91.7) {
				const LandSample sample = terrain.sample(x, y);
				EXPECT_GE(sample.elevation, 0);
				EXPECT_LE(sample.elevation, 1);
				const double dx = (terrain.elevation(x + step, y) - terrain.elevation(x - step, y)) / (2 * step);
				const double dy = (terrain.elevation(x, y + step) - terrain.elevation(x, y - step)) / (2 * step);
				EXPECT_NEAR(sample.slopeX, dx, 1e-5) << x << ", " << y;
				EXPECT_NEAR(sample.slopeY, dy, 1e-5) << x << ", " << y;
			}
		}
	}

	TEST(Terrain, LeavesByRiversOutletsOnTheGridsEdgeOrAClosedBasinsOneSinkInsideTheDisc) {
		for (const MapParams* params : {&kMixed, &kRugged}) {
			const LandSurface& land = fixtures::terrainFor(*params).surface();
			const int		   size = land.grid.size;
			EXPECT_FALSE(land.closedBasin);
			std::vector<int> outlets = land.drainage.outlets;
			ASSERT_EQ(outlets.size(), static_cast<size_t>(params->rivers));
			for (const int outlet : outlets) {
				const int row = outlet / size;
				const int column = outlet % size;
				EXPECT_TRUE(row == 0 || column == 0 || row == size - 1 || column == size - 1) << outlet;
			}
			std::ranges::sort(outlets);
			EXPECT_EQ(std::ranges::adjacent_find(outlets), outlets.end());
		}
		const Terrain&	   basin = fixtures::terrainFor(kBasin);
		const LandSurface& land = basin.surface();
		EXPECT_TRUE(land.closedBasin);
		ASSERT_EQ(land.drainage.outlets.size(), 1U);
		const auto sink = static_cast<size_t>(land.drainage.outlets[0]);
		EXPECT_LT(distanceSquared(land.grid, sink), static_cast<double>(basin.radius()) * basin.radius());
		EXPECT_EQ(land.drainage.area[sink], land.grid.cells());
	}

	TEST(Terrain, SamplesTheErodedGridAtItsCellCentresOnAWetMap) {
		const Terrain&	   terrain = fixtures::terrainFor(kMixed);
		const LandSurface& land = terrain.surface();
		for (int row = 2; row < land.grid.size - 2; row += 13) {
			for (int column = 2; column < land.grid.size - 2; column += 11) {
				const double expected = land.elevation[static_cast<size_t>(row * land.grid.size + column)];
				EXPECT_NEAR(terrain.elevation(cellCentre(land.grid, column), cellCentre(land.grid, row)), expected, 1e-12);
			}
		}
	}

	TEST(Terrain, TerracesADryMapAsItSamplesItPastTheBlendRingAndNotInTheMetro) {
		const Terrain&	   terrain = fixtures::terrainFor(kBasin);
		const LandSurface& land = terrain.surface();
		const GridSampler  grid(land.grid, land.elevation);
		const double	   pull = terracePull(moistureLevel(kBasin.aridity));
		ASSERT_GT(pull, 0);
		const double far = terrain.start().blend + 50;
		for (const auto& [x, y] : std::vector<std::pair<double, double>>{{far, 0}, {0, -far}, {-far * 0.6, far * 0.8}}) {
			EXPECT_DOUBLE_EQ(terrain.elevation(x, y), terraceHeight(grid.bicubic(x, y).value, pull));
		}
		EXPECT_EQ(terrain.elevation(0, 0), grid.bicubic(0, 0).value);
	}

	TEST(Terrain, PullsTerracesNowhereFromAnAridityOf0Point4AndAllTheyPullFrom0Point1) {
		for (const double aridity : {0.4, 0.55, 1.0}) {
			EXPECT_EQ(terracePull(moistureLevel(aridity)), 0);
		}
		for (const double aridity : {0.0, 0.1}) {
			EXPECT_EQ(terracePull(moistureLevel(aridity)), kTerraces.strength);
		}
		double previous = -1;
		for (double height = 0; height <= 1; height += 1e-4) {
			const double terraced = terraceHeight(height, kTerraces.strength);
			ASSERT_GT(terraced, previous) << "terraces keep heights in order, so land drains the same terraced or not";
			previous = terraced;
			const double difference =
				(terraceHeight(height + 1e-7, kTerraces.strength) - terraceHeight(height - 1e-7, kTerraces.strength)) / 2e-7;
			EXPECT_NEAR(terraceSlope(height, kTerraces.strength), difference, 1e-5);
		}
	}

} // namespace
