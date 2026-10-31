// The campaign's save through salal's SaveStore: what Continue reads of it, the round trip, the saves it can't
// continue, and the history.

#include "CampaignStore.h"
#include "GameTesting.h"
#include "Words.h"

#include <rules/campaign/CampaignEnd.h>
#include <rules/campaign/CampaignJson.h>
#include <rules/campaign/CampaignTesting.h>
#include <rules/campaign/DayClock.h>

#include <fstream>
#include <string>

namespace {

	using namespace game;
	using game::testing::TempDir;
	using game::testing::testRules;
	using rules::campaign::Campaign;
	using rules::campaign::kSaveVersion;

	Campaign testCampaign() {
		return rules::campaign::foundCampaign(
			testRules().content,
			testRules().campaign,
			rules::campaign::Founding{.map = rules::campaigns::testMap().origin, .unlocked = testRules().unlocked}
		);
	}

	TEST(CampaignStore, ASaveRoundTripsAndItsStatusSaysWhatItHoldsWithoutItsMap) {
		const TempDir  dir;
		app::SaveStore saves(dir.path(), {.version = kSaveVersion});
		CampaignStore  store(saves, testRules().content);
		EXPECT_EQ(store.status().state, SaveState::None);
		EXPECT_EQ(store.status().line, "No campaign in progress.");
		EXPECT_FALSE(store.saveJson().has_value());

		Campaign campaign = testCampaign();
		(void)rules::campaign::endDay(campaign, testRules().content, testRules().campaign);
		ASSERT_TRUE(store.save(campaign));
		const SaveStatus status = store.status();
		ASSERT_EQ(status.state, SaveState::Saved);
		EXPECT_EQ(*status.campaign, campaign);
		EXPECT_EQ(status.line, "Day 2 - " + std::to_string(campaign.drivers.size()) + " drivers - 0 strongholds taken");
		EXPECT_EQ(rules::campaign::readCampaign(*store.saveJson(), testRules().content), campaign);
	}

	TEST(CampaignStore, ASaveOfAnotherFormatOrDamagedCantBeContinuedAndSaysWhy) {
		const TempDir		 dir;
		app::SaveStore		 saves(dir.path(), {.version = kSaveVersion});
		CampaignStore		 store(saves, testRules().content);
		const nlohmann::json json = rules::campaign::writeCampaign(testCampaign(), testRules().content);

		// A newer build's envelope, and an older JSON inside this build's.
		app::SaveStore newer(dir.path(), {.version = kSaveVersion + 1});
		ASSERT_TRUE(newer.writeJson(CampaignStore::kCampaignSlot, json));
		EXPECT_EQ(store.status().state, SaveState::OtherFormat);
		ASSERT_TRUE(saves.remove(CampaignStore::kCampaignSlot));
		nlohmann::json older = json;
		older["version"] = kSaveVersion - 1;
		ASSERT_TRUE(saves.writeJson(CampaignStore::kCampaignSlot, older));
		const SaveStatus other = store.status();
		EXPECT_EQ(other.state, SaveState::OtherFormat);
		EXPECT_EQ(other.line, "The save is from a version of the game with another save format.");

		// One the rules refuse says where, and one whose bytes are wrong is damaged.
		nlohmann::json refused = json;
		refused["day"] = 0;
		ASSERT_TRUE(saves.writeJson(CampaignStore::kCampaignSlot, refused));
		const SaveStatus damaged = store.status();
		EXPECT_EQ(damaged.state, SaveState::Damaged);
		EXPECT_NE(damaged.line.find("campaign.day"), std::string::npos) << damaged.line;
		std::ofstream(dir.path() / "campaign.save", std::ios::binary | std::ios::trunc) << "SALALSAV but not a save";
		EXPECT_EQ(store.status().state, SaveState::Damaged);
		EXPECT_EQ(store.status().line, "The save is damaged.");
	}

	TEST(CampaignStore, ANewCampaignAbandonsTheOneItReplacesAndAnEndRecordsItsFallNewestFirst) {
		const TempDir  dir;
		app::SaveStore saves(dir.path(), {.version = kSaveVersion});
		CampaignStore  store(saves, testRules().content);
		const Campaign first = testCampaign();
		ASSERT_TRUE(store.replace(first));
		EXPECT_TRUE(store.history().empty()) << "nothing was in progress";

		Campaign second = testCampaign();
		(void)rules::campaign::endDay(second, testRules().content, testRules().campaign);
		ASSERT_TRUE(store.replace(second));
		ASSERT_EQ(store.history().size(), 1U);
		EXPECT_EQ(store.history().front(), (HistoryEntry{.seed = first.seed, .day = 1, .strongholdsTaken = 0, .ending = "abandoned"}));
		EXPECT_EQ(*store.status().campaign, second);

		rules::campaign::endCampaign(second, testRules().campaign.compound, rules::campaign::EndCause::LastDriver);
		ASSERT_TRUE(store.end(second, "abandoned"));
		EXPECT_EQ(store.status().state, SaveState::None);
		const std::vector<HistoryEntry> history = store.history();
		ASSERT_EQ(history.size(), 2U);
		EXPECT_EQ(history[0].day, 2);
		EXPECT_EQ(history[0].ending, std::string(nameOf(rules::campaign::kEndingNames, second.end->ending))) << "its own fall";
		EXPECT_EQ(history[1].ending, "abandoned");
		ASSERT_TRUE(store.end(second, ""));
		EXPECT_EQ(store.history().size(), 2U) << "the same end twice is one line";
	}

} // namespace
