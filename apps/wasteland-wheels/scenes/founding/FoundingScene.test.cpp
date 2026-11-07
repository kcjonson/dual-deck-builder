// The pages that wait on a map, in the atlas: founding's progress lints 0 at the sizes the game opens at and its Cancel
// is disabled once pressed; a save that can't be continued says why on a page that lints 0.

#include "GameTesting.h"

#include <string>

namespace {

	using namespace game;
	using namespace game::testing;

	class Waiting : public GameTest {};

	TEST_F(Waiting, FoundingShowsItsProgressAndCancelIsDisabledOncePressed) {
		start(heldMakers(), true);
		go(scenes::kMainMenu);
		ASSERT_TRUE(press("new_campaign"));
		ASSERT_TRUE(frameUntil([this] {
			return top() == scenes::kFounding && state()["progress"] == "Making the area map: terrain (1 of 9)";
		}));
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
		ASSERT_TRUE(press("cancel"));
		EXPECT_TRUE(state()["cancelling"].get<bool>());
		EXPECT_FALSE(enabled("cancel"));
		ASSERT_TRUE(frameUntil([this] { return top() == scenes::kMainMenu; }));
	}

	TEST_F(Waiting, ASaveThatCantBeContinuedSaysWhyAndLintsZero) {
		start(fixtureMakers(), true);
		go(scenes::kMainMenu);
		ASSERT_TRUE(press("new_campaign"));
		ASSERT_TRUE(frameUntil([this] { return top() == scenes::kCompound; }));
		nlohmann::json other = *context->store.saveJson();
		other["mapOrigin"]["fingerprint"] = "0123456789abcdef";
		ASSERT_TRUE(app->saves().writeJson(CampaignStore::kCampaignSlot, other));
		context->session.reset();
		go(scenes::kMainMenu);
		ASSERT_TRUE(press("continue"));
		ASSERT_TRUE(frameUntil([this] { return top() == scenes::kLoading && !state()["failure"].get<std::string>().empty(); }));
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
	}

} // namespace
