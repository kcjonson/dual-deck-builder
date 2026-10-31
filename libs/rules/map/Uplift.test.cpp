#include <rules/map/Land.h>
#include <rules/map/Uplift.h>

#include <random/Rng.h>

#include <gtest/gtest.h>

#include <cmath>
#include <vector>

namespace {

	using namespace rules::map;

	constexpr int	 kRadius = 600;
	const LandGrid	 kGrid = landGridFor(kRadius);
	const StartRadii kRadii = startRadii(kRadius, 0.15);

	UpliftField upliftFor(uint32_t seed, double mountainCoverage, double ruggedness = 0.5) {
		return buildUplift(
			{.grid = kGrid,
			 .radius = kRadius,
			 .metroRadius = kRadii.metro,
			 .reliefRadius = kRadii.relief,
			 .mountainCoverage = mountainCoverage,
			 .ruggedness = ruggedness},
			foundation::Rng(seed).fork("map", 0).fork("terrain", 0)
		);
	}

	// The cells whose centres lie from `inner` to `outer` of the compound, as the uplift measures them.
	std::vector<size_t> cellsBetween(double inner, double outer) {
		std::vector<size_t> cells;
		for (int row = 0; row < kGrid.size; ++row) {
			for (int column = 0; column < kGrid.size; ++column) {
				const double x = cellCentre(kGrid, column);
				const double y = cellCentre(kGrid, row);
				const double distanceSquared = x * x + y * y;
				if (distanceSquared >= inner * inner && distanceSquared <= outer * outer) {
					cells.push_back(static_cast<size_t>(row * kGrid.size + column));
				}
			}
		}
		return cells;
	}

	TEST(Uplift, GivesRangesTheShareOfTheLandPastTheReliefRadiusThatMountainCoverageAsksFor) {
		const std::vector<size_t> calibrated = cellsBetween(kRadii.relief, kRadius);
		for (const double coverage : {0.1, 0.45}) {
			for (uint32_t seed = 1; seed <= 2; ++seed) {
				const UpliftField field = upliftFor(seed, coverage);
				double			  ranges = 0;
				for (const size_t cell : calibrated) {
					ranges += field.mountains[cell] >= 0.5 ? 1 : 0;
				}
				const double share = ranges / static_cast<double>(calibrated.size());
				EXPECT_LE(std::abs(share - coverage), 1.0 / static_cast<double>(calibrated.size()) + 1e-9) << coverage << " seed " << seed;
			}
		}
	}

	TEST(Uplift, MakesNoRangesAtNoCoverageAndRangesEverywherePastTheReliefRadiusAtFull) {
		const UpliftField none = upliftFor(3, 0);
		for (const double mask : none.mountains) {
			ASSERT_EQ(mask, 0);
		}
		const UpliftField all = upliftFor(3, 1);
		for (const size_t cell : cellsBetween(kRadii.relief, kRadius)) {
			ASSERT_EQ(all.mountains[cell], 1);
		}
	}

	TEST(Uplift, LiftsNoRangeInTheMetroOnlyTheHillsAndThoseGently) {
		const UpliftField all = upliftFor(4, 1);
		const UpliftField none = upliftFor(4, 0);
		for (const size_t cell : cellsBetween(0, kRadii.metro)) {
			EXPECT_EQ(all.mountains[cell], 0);
			EXPECT_EQ(all.uplift[cell], none.uplift[cell]);
			EXPECT_LT(all.uplift[cell], 0.12);
		}
	}

	TEST(Uplift, LiftsRangesHarderAsRuggednessRises) {
		const UpliftField gentle = upliftFor(5, 0.45, 0.1);
		const UpliftField rugged = upliftFor(5, 0.45, 0.9);
		double			  gentleLift = 0;
		double			  ruggedLift = 0;
		for (const size_t cell : cellsBetween(kRadii.relief, kRadius)) {
			gentleLift += gentle.uplift[cell];
			ruggedLift += rugged.uplift[cell];
		}
		EXPECT_GT(ruggedLift, 1.5 * gentleLift);
	}

	TEST(Uplift, RunsRangesAlongTheMapsGrainTheMaskChangingLessAlongItThanAcross) {
		double along = 0;
		double across = 0;
		for (uint32_t seed = 11; seed <= 16; ++seed) {
			const UpliftField field = upliftFor(seed, 0.45);
			const GridSampler mask(kGrid, field.mountains);
			const double	  gx = field.grainX;
			const double	  gy = field.grainY;
			EXPECT_NEAR(gx * gx + gy * gy, 1, 1e-9);
			for (double x = -400; x <= 400; x += 50) {
				for (double y = -400; y <= 400; y += 50) {
					const double here = mask.bicubic(x, y).value;
					along += std::abs(mask.bicubic(x + 150 * gx, y + 150 * gy).value - here);
					across += std::abs(mask.bicubic(x - 150 * gy, y + 150 * gx).value - here);
				}
			}
		}
		EXPECT_LT(along, across);
	}

	TEST(Uplift, BuildsTheSameFieldFromTheSameStreamAndAnotherFromAnother) {
		EXPECT_EQ(upliftFor(6, 0.25).uplift, upliftFor(6, 0.25).uplift);
		EXPECT_NE(upliftFor(6, 0.25).uplift, upliftFor(7, 0.25).uplift);
	}

} // namespace
