#include "Gen.h"

#include <rules/core/ContentError.h>

#include <gtest/gtest.h>

#include <vector>

namespace {

	using namespace sim;

	TEST(GenConfig, ItsConfigIsMapsAloneAndThirtyWhenLeftOut) {
		EXPECT_EQ(readGenConfig(nlohmann::json::object(), "gen.json").maps.size(), 30U);
		EXPECT_EQ(readGenConfig(nlohmann::json{{"maps", {4, 9}}}, "gen.json").maps, (std::vector<uint32_t>{4, 9}));
		const GenConfig three = readGenConfig(nlohmann::json{{"maps", 3}}, "gen.json");
		EXPECT_EQ(readGenConfig(genConfigJson(three), "gen.json"), three);
		EXPECT_THROW((void)readGenConfig(nlohmann::json{{"runs", 3}}, "gen.json"), rules::ContentError);
	}

} // namespace
