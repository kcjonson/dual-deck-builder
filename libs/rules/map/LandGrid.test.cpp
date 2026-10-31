#include <rules/map/LandGrid.h>

#include <gtest/gtest.h>

#include <cmath>
#include <vector>

namespace {

	using namespace rules::map;

	std::vector<double> valuesOf(const LandGrid& grid, double (*field)(double, double)) {
		std::vector<double> values(static_cast<size_t>(grid.cells()));
		for (int row = 0; row < grid.size; ++row) {
			for (int column = 0; column < grid.size; ++column) {
				values[static_cast<size_t>(row * grid.size + column)] = field(cellCentre(grid, column), cellCentre(grid, row));
			}
		}
		return values;
	}

	double plane(double x, double y) {
		return 0.3 + 0.002 * x - 0.001 * y;
	}

	double hills(double x, double y) {
		return std::sin(x / 37) * std::cos(y / 23);
	}

	TEST(LandGrid, ReachesAFifthPastTheDiscEachWayWithAnEvenNumberOfCellsAbout9UnitsAcross) {
		const LandGrid grid = landGridFor(1000);
		EXPECT_EQ(grid.size, 256);
		EXPECT_DOUBLE_EQ(grid.halfExtent, 1200);
		for (const int radius : {600, 800, 1200, 1600}) {
			const LandGrid scaled = landGridFor(radius);
			EXPECT_EQ(scaled.size % 2, 0) << radius;
			EXPECT_NEAR(scaled.cellSize, 9.4, 0.15) << radius;
		}
		const LandGrid coarse = coarseGrid(grid);
		EXPECT_EQ(coarse.size, 128);
		EXPECT_DOUBLE_EQ(coarse.halfExtent, grid.halfExtent);
	}

	TEST(LandGrid, NumbersCellsRowByRowFromTheSouthWestAndFindsNoneOffTheGrid) {
		const LandGrid grid = landGridFor(600);
		EXPECT_EQ(cellAt(grid, cellCentre(grid, 0), cellCentre(grid, 0)), 0);
		EXPECT_EQ(cellAt(grid, cellCentre(grid, 3), cellCentre(grid, 2)), 2 * grid.size + 3);
		EXPECT_EQ(cellAt(grid, grid.halfExtent - 0.01, grid.halfExtent - 0.01), grid.cells() - 1);
		EXPECT_EQ(cellAt(grid, -grid.halfExtent - 0.01, 0), -1);
		EXPECT_EQ(cellAt(grid, 0, grid.halfExtent), -1);
	}

	TEST(GridSampler, PassesThroughEveryCentreTheBicubicReaches) {
		const LandGrid			  grid = landGridFor(600);
		const std::vector<double> values = valuesOf(grid, hills);
		const GridSampler		  sampler(grid, values);
		for (int row = 1; row < grid.size - 1; row += 7) {
			for (int column = 1; column < grid.size - 1; column += 5) {
				const double expected = values[static_cast<size_t>(row * grid.size + column)];
				EXPECT_NEAR(sampler.bicubic(cellCentre(grid, column), cellCentre(grid, row)).value, expected, 1e-12);
				EXPECT_NEAR(sampler.bilinear(cellCentre(grid, column), cellCentre(grid, row)), expected, 1e-12);
			}
		}
	}

	TEST(GridSampler, ReproducesAPlaneExactlyValueAndGradient) {
		const LandGrid			  grid = landGridFor(600);
		const std::vector<double> values = valuesOf(grid, plane);
		const GridSampler		  sampler(grid, values);
		for (const auto& [x, y] : std::vector<std::pair<double, double>>{{0, 0}, {123.4, -56.7}, {-300.1, 401.9}}) {
			const GridSample sample = sampler.bicubic(x, y);
			EXPECT_NEAR(sample.value, plane(x, y), 1e-12);
			EXPECT_NEAR(sample.gradientX, 0.002, 1e-12);
			EXPECT_NEAR(sample.gradientY, -0.001, 1e-12);
			EXPECT_NEAR(sampler.bilinear(x, y), plane(x, y), 1e-12);
		}
	}

	TEST(GridSampler, GivesTheExactGradientOfWhatItSamplesAcrossCellEdges) {
		const LandGrid			  grid = landGridFor(600);
		const std::vector<double> values = valuesOf(grid, hills);
		const GridSampler		  sampler(grid, values);
		const double			  step = 1e-5;
		for (double x = -200; x < 200; x += 31.7) {
			for (double y = -150; y < 150; y += 27.3) {
				const GridSample sample = sampler.bicubic(x, y);
				const double	 dx = (sampler.bicubic(x + step, y).value - sampler.bicubic(x - step, y).value) / (2 * step);
				const double	 dy = (sampler.bicubic(x, y + step).value - sampler.bicubic(x, y - step).value) / (2 * step);
				EXPECT_NEAR(sample.gradientX, dx, 1e-6);
				EXPECT_NEAR(sample.gradientY, dy, 1e-6);
			}
		}
	}

	TEST(GridSampler, HoldsItsEdgeValuesPastTheCentresItReachesFlatAcrossTheEdge) {
		const LandGrid			  grid = landGridFor(600);
		const std::vector<double> values = valuesOf(grid, plane);
		const GridSampler		  sampler(grid, values);
		const double			  edge = grid.halfExtent - 0.1;
		const GridSample		  inside = sampler.bicubic(cellCentre(grid, grid.size - 2), 0);
		const GridSample		  past = sampler.bicubic(edge, 0);
		EXPECT_NEAR(past.value, inside.value, 1e-12);
		EXPECT_EQ(past.gradientX, 0);
		EXPECT_NEAR(past.gradientY, -0.001, 1e-12);
		EXPECT_NEAR(sampler.bilinear(grid.halfExtent - 0.1, 0), sampler.bilinear(cellCentre(grid, grid.size - 1), 0), 1e-12);
	}

} // namespace
