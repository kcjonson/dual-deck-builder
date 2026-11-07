// Campaign history: past campaigns newest first, each with its ending, its days and its seed, scrolling past what fits;
// it lints 0 at the sizes the game opens at.

#include "GameTesting.h"
#include "atlas/ContentsEntry.h"

#include <string>

namespace {

	using namespace game;
	using namespace game::testing;

	class History : public GameTest {};

	TEST_F(History, PastCampaignsListNewestFirstAndLintZero) {
		start(fixtureMakers(), true);
		nlohmann::json entries = nlohmann::json::array();
		for (int index = 0; index < 14; ++index) {
			entries.push_back(
				{{"seed", 1000 + index},
				 {"day", 3 + index},
				 {"strongholdsTaken", index % 3},
				 {"ending", index % 2 == 0 ? "starved" : "abandoned"}}
			);
		}
		ASSERT_TRUE(app->saves().writeJson(CampaignStore::kHistorySlot, nlohmann::json{{"entries", entries}}));
		go(scenes::kCampaignHistory);
		EXPECT_EQ(state()["campaigns"], 14);
		const auto* first = dynamic_cast<const atlas::ContentsEntry*>(find("history_0"));
		ASSERT_NE(first, nullptr);
		EXPECT_EQ(first->getLabel(), "Starved");
		EXPECT_EQ(first->getLine(), "0 strongholds taken / Seed 1000");
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
	}

} // namespace
