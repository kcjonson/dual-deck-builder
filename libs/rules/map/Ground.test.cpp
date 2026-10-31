#include <rules/map/Ground.h>
#include <rules/map/MapTesting.h>

#include <gtest/gtest.h>

#include <array>
#include <cmath>
#include <numbers>
#include <utility>
#include <vector>

namespace {

	using namespace rules::map;

	Ground groundFor(const MapParams& params) {
		return {fixtures::terrainFor(params), fixtures::waterFor(params)};
	}

	// Each biome's share of a lattice over the disc, `from` out.
	std::array<double, 6> biomeShares(const Ground& ground, double from = 0) {
		const int			  radius = ground.terrain().radius();
		const double		  step = radius / 30.0;
		std::array<double, 6> shares{};
		double				  points = 0;
		for (double x = -radius; x <= radius; x += step) {
			for (double y = -radius; y <= radius; y += step) {
				const double away = x * x + y * y;
				if (away < from * from || away > static_cast<double>(radius) * radius) {
					continue;
				}
				shares[static_cast<size_t>(ground.biome(x, y))] += 1;
				points += 1;
			}
		}
		for (double& share : shares) {
			share /= points;
		}
		return shares;
	}

	double shareOf(const std::array<double, 6>& shares, Biome biome) {
		return shares[static_cast<size_t>(biome)];
	}

	class EveryGround : public ::testing::TestWithParam<const MapParams*> {};

	INSTANTIATE_TEST_SUITE_P(
		Ground,
		EveryGround,
		::testing::Values(&fixtures::mixed(), &fixtures::floodlands(), &fixtures::basin(), &fixtures::badlands())
	);

	TEST_P(EveryGround, KeepsEveryFieldInItsRange) {
		const Ground ground = groundFor(*GetParam());
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
		const Ground ground = groundFor(*GetParam());
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

	TEST(Ground, MakesEveryBiomeSomewhereAndGivesEachEnvironmentItsCharacter) {
		const auto mixed = biomeShares(groundFor(fixtures::mixed()));
		const auto desert = biomeShares(groundFor(fixtures::basin()));
		const auto flood = biomeShares(groundFor(fixtures::floodlands()));
		const auto broken = biomeShares(groundFor(fixtures::badlands()));
		EXPECT_GT(shareOf(mixed, Biome::Scrub), 0.02);
		EXPECT_GT(shareOf(mixed, Biome::Mountains), 0.02);
		EXPECT_GT(shareOf(desert, Biome::Desert), 0.02);
		EXPECT_GT(shareOf(desert, Biome::Canyons), 0.02);
		EXPECT_GT(shareOf(flood, Biome::Mire), 0.02);
		EXPECT_GT(shareOf(broken, Biome::Badlands), 0.02);

		EXPECT_GT(shareOf(desert, Biome::Desert), shareOf(flood, Biome::Desert));
		EXPECT_GT(shareOf(flood, Biome::Mire), shareOf(desert, Biome::Mire));
		EXPECT_GT(shareOf(broken, Biome::Badlands), shareOf(flood, Biome::Badlands));
		EXPECT_EQ(shareOf(flood, Biome::Canyons), 0);
	}

	TEST(Ground, GivesMountainsTheShareOfTheCountryMountainCoverageAsksFor) {
		const Ground ground = groundFor(fixtures::mixed());
		const auto	 shares = biomeShares(ground, ground.terrain().start().relief);
		EXPECT_NEAR(shareOf(shares, Biome::Mountains), fixtures::mixed().mountainCoverage, 0.06);
	}

} // namespace
