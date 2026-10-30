#include <sim/Sim.h>

#include <gtest/gtest.h>

TEST(SimPlaceholder, ReplaysItsSeed) {
	EXPECT_EQ(sim::firstDraw(7), sim::firstDraw(7));
	EXPECT_NE(sim::firstDraw(7), sim::firstDraw(8));
}
