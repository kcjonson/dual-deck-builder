#include <rules/Rules.h>

#include <gtest/gtest.h>

TEST(RulesPlaceholder, ReplaysItsSeed) {
	EXPECT_EQ(rules::firstDraw(7), rules::firstDraw(7));
	EXPECT_NE(rules::firstDraw(7), rules::firstDraw(8));
}
