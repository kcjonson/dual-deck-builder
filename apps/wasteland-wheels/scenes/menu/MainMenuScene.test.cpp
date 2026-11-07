// The main menu in the atlas: New campaign leads until there's a campaign to continue, then Continue does with the day
// in its shield; it lints 0 either way at the sizes the game opens at, and at 150% too; and each appendix opens, lints 0, and goes back
// by its Menu tab.

#include "GameTesting.h"
#include "atlas/ContentsEntry.h"

#include <string>

namespace {

	using namespace game;
	using namespace game::testing;

	class MainMenu : public GameTest {
	  protected:
		[[nodiscard]] const atlas::ContentsEntry* entry(std::string_view id) { return dynamic_cast<const atlas::ContentsEntry*>(find(id)); }
	};

	TEST_F(MainMenu, WithNothingToContinueNewCampaignLeadsAndContinueSaysWhy) {
		start(fixtureMakers(), true);
		go(scenes::kMainMenu);
		EXPECT_EQ(state()["primary"], "new_campaign");
		EXPECT_FALSE(enabled("continue"));
		ASSERT_NE(entry("continue"), nullptr);
		EXPECT_EQ(entry("continue")->getLine(), "No campaign in progress.");
		for (const char* id :
			 {"new_campaign", "campaign_history", "settings", "card_showcase", "credits", "exit", "cover", "deck_a", "deck_b"}) {
			EXPECT_NE(find(id), nullptr) << id;
		}
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
	}

	TEST_F(MainMenu, ACampaignInProgressPutsContinueFirstWithItsDay) {
		start(fixtureMakers(), true);
		go(scenes::kMainMenu);
		ASSERT_TRUE(press("new_campaign"));
		ASSERT_TRUE(frameUntil([this] { return top() == scenes::kCompound; }));
		go(scenes::kMainMenu);
		EXPECT_EQ(state()["primary"], "continue");
		ASSERT_TRUE(enabled("continue"));
		EXPECT_EQ(entry("continue")->getLine(), context->store.status().line);
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
		// At 150% the page scrolls rather than squeezing its entries.
		app->setUiScale(1.5F);
		EXPECT_EQ(lintAt(1280, 800), "");
	}

	TEST_F(MainMenu, EachAppendixOpensLintsZeroAndGoesBackByItsMenuTab) {
		start(fixtureMakers(), true);
		for (const auto& [id, scene] : {
				 std::pair{"campaign_history", scenes::kCampaignHistory},
				 std::pair{"settings", scenes::kSettings},
				 std::pair{"credits", scenes::kCredits},
			 }) {
			go(scenes::kMainMenu);
			ASSERT_TRUE(press(id));
			ASSERT_EQ(top(), scene);
			EXPECT_EQ(lintAt(1280, 800), "") << scene;
			EXPECT_EQ(lintAt(1440, 900), "") << scene;
			EXPECT_EQ(lintAt(1920, 1080), "") << scene;
			ASSERT_TRUE(press("main_menu"));
			EXPECT_EQ(top(), scenes::kMainMenu);
		}
		ASSERT_TRUE(press("card_showcase"));
		EXPECT_EQ(top(), scenes::kCardShowcase);
	}

} // namespace
