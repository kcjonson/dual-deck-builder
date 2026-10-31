#include <rules/map/Ground.h>
#include <rules/map/MapTesting.h>

#include <gtest/gtest.h>

#include <array>

// Biomes over a lattice of four whole maps.
namespace {

	using namespace rules::map;

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

	TEST(Ground, MakesEveryBiomeSomewhereAndGivesEachEnvironmentItsCharacter) {
		const auto mixed = biomeShares(fixtures::waterGroundFor(fixtures::mixed()));
		const auto desert = biomeShares(fixtures::waterGroundFor(fixtures::basin()));
		const auto flood = biomeShares(fixtures::waterGroundFor(fixtures::floodlands()));
		const auto broken = biomeShares(fixtures::waterGroundFor(fixtures::badlands()));
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
		const Ground ground = fixtures::waterGroundFor(fixtures::mixed());
		const auto	 shares = biomeShares(ground, ground.terrain().start().relief);
		EXPECT_NEAR(shareOf(shares, Biome::Mountains), fixtures::mixed().mountainCoverage, 0.06);
	}

} // namespace
