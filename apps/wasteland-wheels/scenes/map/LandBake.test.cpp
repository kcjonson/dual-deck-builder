// The land bake on the map tests' Mixed fixture, small: clear past the rim and opaque inside it, the same bytes every
// time, water where the lakes are, and given up when its stop is asked for; and the fog dark where nothing's revealed,
// clear where it is, and clear past the rim.

#include "scenes/map/LandBake.h"
#include "scenes/map/MapStyle.h"

#include <rules/map/LandFog.h>
#include <rules/map/MapTesting.h>

#include <gtest/gtest.h>

#include <cstdint>
#include <stop_token>

namespace {

	using namespace game;
	namespace fixtures = rules::map::fixtures;

	constexpr int kSize = 96;

	const rules::map::Ground& fixtureGround() {
		static const rules::map::Ground ground(
			fixtures::terrainFor(fixtures::mixed()), fixtures::waterFor(fixtures::mixed()), fixtures::hazardsFor(fixtures::mixed())
		);
		return ground;
	}

	uint8_t alphaAt(const Texels& texels, int column, int row) {
		return texels.rgba.at((static_cast<size_t>(row) * static_cast<size_t>(texels.size) + static_cast<size_t>(column)) * 4U + 3U);
	}

	TEST(LandBake, ItsClearPastTheRimOpaqueInsideAndTheSameEveryTime) {
		const LandBakeArgs args{.ground = fixtureGround(), .places = fixtures::placesFor(fixtures::mixed()), .size = kSize};
		const Texels	   land = bakeLand(args);
		ASSERT_EQ(land.size, kSize);
		ASSERT_EQ(land.rgba.size(), static_cast<size_t>(kSize * kSize * 4));
		for (const auto& [column, row] :
			 {std::pair{0, 0}, std::pair{kSize - 1, 0}, std::pair{0, kSize - 1}, std::pair{kSize - 1, kSize - 1}}) {
			EXPECT_EQ(alphaAt(land, column, row), 0) << "the square's corners are past the rim";
		}
		EXPECT_GT(alphaAt(land, kSize - 1, kSize / 2), 0) << "the rim's texel at the east edge is part covered";
		EXPECT_EQ(alphaAt(land, kSize / 2, kSize / 2), 255);
		EXPECT_EQ(bakeLand(args).rgba, land.rgba);
	}

	TEST(LandBake, ALakeIsBakedBlue) {
		const rules::map::Water& water = fixtures::waterFor(fixtures::mixed());
		if (water.lakes().empty()) {
			GTEST_SKIP() << "the fixture has no lake";
		}
		const rules::map::Lake& lake = water.lakes().front();
		const double			radius = fixtures::mixed().radius;
		const Texels land = bakeLand({.ground = fixtureGround(), .places = fixtures::placesFor(fixtures::mixed()), .size = kSize});
		const int	 column = static_cast<int>((lake.x + radius) / (radius * 2.0) * kSize);
		const int	 row = static_cast<int>((radius - lake.y) / (radius * 2.0) * kSize);
		const size_t at = (static_cast<size_t>(row) * kSize + static_cast<size_t>(column)) * 4U;
		EXPECT_GT(land.rgba.at(at + 2), land.rgba.at(at)) << "bluer than red at the lake's middle";
	}

	TEST(LandBake, AStopAskedForGivesItUp) {
		std::stop_source stop;
		stop.request_stop();
		const Texels land = bakeLand(
			{.ground = fixtureGround(), .places = fixtures::placesFor(fixtures::mixed()), .size = kSize, .stop = stop.get_token()}
		);
		EXPECT_EQ(land.size, 0);
		EXPECT_TRUE(land.rgba.empty());
	}

	TEST(LandBake, TheFogIsDarkWhereNothingsRevealedAndClearWhereItIs) {
		rules::map::LandFog fog;
		const int			middle = rules::map::kFogCells / 2;
		fog.reveal({.column = middle, .row = middle});
		fog.reveal({.column = middle - 1, .row = middle - 1});
		fog.reveal({.column = middle - 1, .row = middle});
		fog.reveal({.column = middle, .row = middle - 1});
		const Texels baked = bakeFog(fog);
		const int	 size = rules::map::kFogCells * mapstyle::kFogTexelsPerCell;
		ASSERT_EQ(baked.size, size);
		EXPECT_EQ(alphaAt(baked, size / 2, size / 2), 0) << "the revealed middle";
		EXPECT_NEAR(alphaAt(baked, size / 4, size / 2), 255.0F * mapstyle::kFogAlpha, 1.0F) << "hidden land inside the disc";
		EXPECT_EQ(alphaAt(baked, 0, 0), 0) << "past the rim";
	}

} // namespace
