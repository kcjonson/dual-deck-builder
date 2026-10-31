#include <rules/map/Dressing.h>
#include <rules/map/MapTesting.h>

#include <gtest/gtest.h>

#include <cmath>
#include <vector>

namespace {

	using namespace rules::map;

	TEST(Dressing, HatchesEveryStrongPlumeFromItsRimToWhereItFadesToTheLevel) {
		for (const MapParams* params : {&fixtures::mixed(), &fixtures::badlands()}) {
			const auto&					   hotspots = fixtures::hazardsFor(*params).hotspots();
			const std::vector<HatchRegion> regions =
				hatchRegions({.hotspots = hotspots, .radius = params->radius, .scale = 1, .stream = foundation::Rng(2)});
			size_t expected = 0;
			for (const Hotspot& hotspot : hotspots) {
				expected += std::hypot(hotspot.x, hotspot.y) <= params->radius && hotspot.strength > 0.15 ? 1 : 0;
			}
			ASSERT_EQ(regions.size(), expected);
			ASSERT_GT(regions.size(), 0U);
			for (const HatchRegion& region : regions) {
				const auto hotspot =
					std::ranges::find_if(hotspots, [&](const Hotspot& site) { return site.x == region.at.x && site.y == region.at.y; });
				ASSERT_NE(hotspot, hotspots.end());
				EXPECT_EQ(region.inner, hotspot->craterRadius);
				const double fall = 1 - region.outer * region.outer / (hotspot->plumeRadius * hotspot->plumeRadius);
				EXPECT_NEAR(hotspot->strength * fall * fall, 0.15, 1e-9);
				EXPECT_DOUBLE_EQ(region.spacing, 8);
				// 45 degrees, turned up to 15 either way.
				const double angle = std::atan2(region.uy, region.ux) * 180 / 3.141592653589793;
				EXPECT_GE(angle, 30 - 1e-6);
				EXPECT_LE(angle, 60 + 1e-6);
			}
			EXPECT_DOUBLE_EQ(
				hatchRegions({.hotspots = hotspots, .radius = params->radius, .scale = 2, .stream = foundation::Rng(2)}).front().spacing, 4
			);
			EXPECT_TRUE(hatchRegions({.hotspots = hotspots, .radius = params->radius, .scale = 0, .stream = foundation::Rng(2)}).empty());
		}
	}

	TEST(Dressing, StipplesMireAndNothingElseMoreDenselyAsTheDressingRises) {
		const MapParams&		 params = fixtures::floodlands();
		const Ground&			 ground = fixtures::groundFor(params);
		const std::vector<Point> dots = mireStipple({.ground = ground, .scale = 1, .stream = foundation::Rng(6)});
		ASSERT_GT(dots.size(), 20U);
		for (const Point dot : dots) {
			EXPECT_LE(std::hypot(dot.x, dot.y), params.radius);
			EXPECT_EQ(ground.biome(dot.x, dot.y), Biome::Mire);
			EXPECT_EQ(ground.waterAt(dot.x, dot.y), WaterKind::None);
		}
		EXPECT_GT(mireStipple({.ground = ground, .scale = 2, .stream = foundation::Rng(6)}).size(), dots.size() * 3 / 2);
		EXPECT_TRUE(mireStipple({.ground = ground, .scale = 0, .stream = foundation::Rng(6)}).empty());
		EXPECT_DOUBLE_EQ(dressingScale(0.6), 1);
	}

} // namespace
