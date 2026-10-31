#include <rules/map/Ground.h>
#include <rules/map/MapTesting.h>

#include <gtest/gtest.h>

#include <cmath>
#include <numbers>
#include <vector>

namespace {

	using namespace rules::map;

	class EveryGround : public ::testing::TestWithParam<const MapParams*> {};

	INSTANTIATE_TEST_SUITE_P(
		Ground,
		EveryGround,
		::testing::Values(&fixtures::mixed(), &fixtures::floodlands(), &fixtures::basin(), &fixtures::badlands())
	);

	TEST_P(EveryGround, KeepsEveryFieldInItsRange) {
		const Ground ground = fixtures::waterGroundFor(*GetParam());
		const int	 radius = ground.terrain().radius();
		for (double x = -radius; x <= radius; x += radius / 12.0) {
			for (double y = -radius; y <= radius; y += radius / 12.0) {
				const GroundSample sample = ground.sample(x, y);
				for (const double value :
					 {sample.elevation,
					  sample.fields.lowland,
					  sample.fields.moisture,
					  sample.fields.contamination,
					  sample.fields.mountains,
					  sample.fields.canyons,
					  sample.fields.badlands}) {
					ASSERT_GE(value, 0) << x << ", " << y;
					ASSERT_LE(value, 1) << x << ", " << y;
				}
				EXPECT_EQ(sample.biome, classifyBiome(sample.fields));
			}
		}
	}

	TEST_P(EveryGround, KeepsTheMetroScrubWithNoContaminationAndItsMiddlingMoisture) {
		const Ground ground = fixtures::waterGroundFor(*GetParam());
		const double metro = ground.terrain().start().metro;
		EXPECT_DOUBLE_EQ(ground.moisture(0, 0), 0.45);
		for (int ring = 1; ring <= 4; ++ring) {
			for (int turn = 0; turn < 12; ++turn) {
				const double	   angle = turn * std::numbers::pi / 6;
				const double	   x = 0.24 * ring * metro * std::cos(angle);
				const double	   y = 0.24 * ring * metro * std::sin(angle);
				const GroundSample sample = ground.sample(x, y);
				EXPECT_EQ(sample.biome, Biome::Scrub) << x << ", " << y;
				EXPECT_EQ(sample.fields.contamination, 0);
			}
		}
	}

} // namespace
