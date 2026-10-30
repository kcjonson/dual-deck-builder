#include <sim/Sim.h>

#include <gtest/gtest.h>

// The first draw _legacy/src/renderer/game/core/Rng.test.ts pins for its seed: the
// game gets the generator its TypeScript version used.
TEST(SimPlaceholder, DrawsTheTypeScriptGolden) {
	EXPECT_EQ(sim::firstDraw(20261006), 0xbdd943edU);
}
