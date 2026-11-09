// The main menu in the atlas: New campaign leads until there's a campaign to continue, then Continue does with the day
// in its shield; New campaign asks before it replaces a campaign in progress, a damaged save or an old one; it lints 0 either way at the
// sizes the game opens at, and at 150% too; and each appendix opens, lints 0, and goes back by its Menu tab.

#include "GameTesting.h"
#include "atlas/AtlasButton.h"
#include "atlas/ContentsEntry.h"

#include <ui/components/Dialog.h>
#include <ui/shapes/Text.h>

#include <fstream>
#include <iterator>
#include <string>

namespace {

	using namespace game;
	using namespace game::testing;

	class MainMenu : public GameTest {
	  protected:
		[[nodiscard]] const atlas::ContentsEntry* entry(std::string_view id) { return dynamic_cast<const atlas::ContentsEntry*>(find(id)); }

		void foundOne() {
			go(scenes::kMainMenu);
			ASSERT_TRUE(press("new_campaign"));
			ASSERT_TRUE(frameUntil([this] { return top() == scenes::kCompound; }));
		}

		[[nodiscard]] std::string saveBytes() const {
			std::ifstream file(dir.path() / "saves" / "campaign.save", std::ios::binary);
			return {std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
		}

		// New campaign over the save as it stands: the dialog's wording, lint at the three sizes with it up, Cancel leaving
		// the file byte for byte on the menu, and confirming going to founding.
		void expectAskedFirst(const std::string& title, const std::string& body, const std::string& confirmLabel) {
			go(scenes::kMainMenu);
			const std::string before = saveBytes();
			ASSERT_FALSE(before.empty());

			ASSERT_TRUE(press("new_campaign"));
			EXPECT_TRUE(state()["confirming"].get<bool>());
			EXPECT_EQ(top(), scenes::kMainMenu);
			const auto* dialog = dynamic_cast<const ui::Dialog*>(find("confirm"));
			const auto* text = dynamic_cast<const ui::Text*>(find("confirm_body"));
			const auto* confirm = dynamic_cast<const atlas::AtlasButton*>(find("confirm_new"));
			ASSERT_TRUE(dialog != nullptr && text != nullptr && confirm != nullptr);
			EXPECT_EQ(dialog->getTitle(), title);
			EXPECT_EQ(text->getText(), body);
			EXPECT_EQ(confirm->getLabel(), confirmLabel);
			EXPECT_EQ(lintAt(1280, 800), "");
			EXPECT_EQ(lintAt(1440, 900), "");
			EXPECT_EQ(lintAt(1920, 1080), "");

			ASSERT_TRUE(press("keep"));
			EXPECT_FALSE(state()["confirming"].get<bool>());
			EXPECT_EQ(top(), scenes::kMainMenu);
			EXPECT_EQ(find("confirm"), nullptr);
			EXPECT_EQ(saveBytes(), before);

			ASSERT_TRUE(press("new_campaign"));
			ASSERT_TRUE(press("confirm_new"));
			ASSERT_TRUE(frameUntil([this] { return top() == scenes::kCompound; }));
			EXPECT_EQ(context->store.status().state, SaveState::Saved);
		}
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

	TEST_F(MainMenu, NewCampaignOverACampaignInProgressAsksFirst) {
		start(fixtureMakers(), true);
		foundOne();
		expectAskedFirst(
			"Abandon this campaign?",
			context->store.status().line + ". A new campaign replaces it, and it goes into Campaign history as abandoned.",
			"Abandon and start new"
		);
	}

	TEST_F(MainMenu, NewCampaignOverADamagedSaveAsksFirstAndKeepsItOnCancel) {
		start(fixtureMakers(), true);
		foundOne();
		std::ofstream(dir.path() / "saves" / "campaign.save", std::ios::binary | std::ios::trunc) << "SALALSAV but not a save";
		ASSERT_EQ(context->store.status().state, SaveState::Damaged);
		expectAskedFirst(
			"Replace the damaged save?",
			"The saved campaign can't be loaded. A new campaign replaces it, and a copy of the damaged save is kept.",
			"Start new campaign"
		);
	}

	TEST_F(MainMenu, NewCampaignOverAnOldSaveAsksFirstAndKeepsItOnCancel) {
		start(fixtureMakers(), true);
		foundOne();
		nlohmann::json older = *context->store.saveJson();
		older["version"] = rules::campaign::kSaveVersion - 1;
		ASSERT_TRUE(app->saves().writeJson(CampaignStore::kCampaignSlot, older));
		ASSERT_EQ(context->store.status().state, SaveState::OtherFormat);
		expectAskedFirst(
			"Replace the old save?",
			"The saved campaign is from another version of the game and can't be continued. A new campaign replaces it.",
			"Start new campaign"
		);
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
