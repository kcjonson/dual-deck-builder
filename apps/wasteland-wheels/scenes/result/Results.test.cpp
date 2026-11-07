// The result scenes in the atlas: the battle result, the debrief home and lost, and the campaign's end, each laid out
// and linted 0 at the sizes the game opens at, with what was lost or cleared stamped, and a defeat on a burnt sheet.

#include "GameTesting.h"
#include "Words.h"
#include "atlas/Sheet.h"
#include "scenes/debrief/DebriefScene.h"
#include "scenes/result/BattleResultScene.h"

#include <rules/campaign/CampaignEnd.h>
#include <rules/campaign/CombatBridge.h>
#include <rules/campaign/DayClock.h>
#include <rules/campaign/Infirmary.h>
#include <rules/campaign/Recruits.h>
#include <rules/campaign/RunDecks.h>

#include <ui/shapes/Text.h>

#include <string>

namespace {

	using namespace game;
	using namespace game::testing;
	using rules::campaign::Campaign;

	class Results : public GameTest {
	  protected:
		void SetUp() override {
			start(fixtureMakers(), true);
			go(scenes::kMainMenu);
			ASSERT_TRUE(press("new_campaign"));
			ASSERT_TRUE(frameUntil([this] { return top() == scenes::kCompound; }));
		}

		// The first two drivers out on a run with no route, as a load out leaves.
		void leave() {
			rules::campaign::startRun(
				played(), testRules().content, {.seats = {played().drivers[0].id, played().drivers[1].id}, .escorts = {}, .stage = 0}
			);
		}

		// The run's next fight, ended as `outcome` with the first seat down.
		rules::campaign::CampaignFight foughtTo(rules::Outcome outcome) {
			rules::campaign::CampaignFight fight =
				rules::campaign::startCampaignFight(played(), testRules().content, rules::EncounterId{"scav_pack"}).fight;
			fight.state.driver(rules::DriverIndex{0}).hitpoints = 0;
			if (outcome == rules::Outcome::Lost) {
				fight.state.driver(rules::DriverIndex{1}).hitpoints = 0;
			}
			fight.state.phase = rules::Phase::Over;
			fight.state.outcome = outcome;
			return fight;
		}

		[[nodiscard]] std::string textOf(std::string_view id) {
			const auto* text = dynamic_cast<const ui::Text*>(find(id));
			return text != nullptr ? text->getText() : "";
		}

		void lintsZero() {
			EXPECT_EQ(lintAt(1280, 800), "");
			EXPECT_EQ(lintAt(1440, 900), "");
			EXPECT_EQ(lintAt(1920, 1080), "");
		}
	};

	TEST_F(Results, AWonFightsResultSaysWhatTheRunCarriesOutOfItAndGoesBackOnTheRoad) {
		leave();
		rules::campaign::CampaignFight		  fight = foughtTo(rules::Outcome::Won);
		const rules::campaign::FightWriteBack back =
			rules::campaign::writeBackFight(played(), testRules().content, testRules().campaign, fight);
		app->scenes().push<BattleResultScene>(BattleResultArgs{.fight = std::move(fight), .back = back});
		frame();
		ASSERT_EQ(top(), "battle_result");
		EXPECT_EQ(textOf("heading_title"), "The road is clear");
		const std::string revived = rules::campaign::driverName(played(), testRules().content, played().drivers[0].id) + " went down";
		EXPECT_EQ(textOf("after_0_text").rfind(revived, 0), 0U) << textOf("after_0_text");
		lintsZero();
		ASSERT_TRUE(press("continue"));
		EXPECT_EQ(top(), scenes::kCompound);
	}

	TEST_F(Results, ADebriefHomeIsStampedNamesTheCargoOnceAndTheInfirmaryAsTheCompoundDoes) {
		leave();
		const rules::campaign::CrewId  hurt = played().drivers[1].id;
		rules::campaign::DriverRecord& record = played().driver(hurt);
		record.hitpoints = rules::campaign::maxHitpointsOf(testRules().content, record) - 15;
		played().run->cargo = {.food = 6, .water = 4, .fuel = 5};
		rules::campaign::addCardsWon(played(), testRules().content, {{rules::CardId{"headshot"}, 1}});
		rules::campaign::Unloaded home = rules::campaign::unloadRun(played(), testRules().content, testRules().campaign);
		ASSERT_EQ(home.injuries.size(), 1U);
		const int									 days = home.injuries.front().days;
		const std::optional<rules::campaign::DayEnd> night = rules::campaign::endDay(played(), testRules().content, testRules().campaign);
		app->scenes().push<DebriefScene>(DebriefArgs{.home = std::move(home), .lost = std::nullopt, .seats = {}, .night = night});
		frame();
		ASSERT_EQ(top(), "debrief");
		EXPECT_EQ(textOf("heading_story"), "It brought home 6 food, 4 water, 5 fuel, and Headshot.");
		EXPECT_EQ(played().log[played().log.size() - 1].text, "A run came home with 6 food, 4 water, 5 fuel, and Headshot.")
			<< "the log words it as the debrief does";
		// The night home is the first day in the infirmary, so the debrief, which shows the night, counts one fewer.
		ASSERT_EQ(days, 2) << "15 HP down at the base pack's 10 a day";
		const rules::campaign::DriverRecord& after = played().driver(hurt);
		EXPECT_EQ(after.injuredDays, 1);
		EXPECT_EQ(textOf("crew_" + hurt.value + "_text"), driverStanding(played(), testRules().content, after));
		EXPECT_NE(textOf("crew_" + hurt.value + "_text").find("fit in 1 day"), std::string::npos) << "as the compound says right after";
		lintsZero();
		ASSERT_TRUE(press("to_compound"));
		EXPECT_EQ(top(), scenes::kCompound);
	}

	TEST_F(Results, ADebriefOfALostRunIsStampedLostAndSaysWhoAndWhatWentWithIt) {
		leave();
		played().run->cargo = {.scrap = 30};
		const rules::campaign::FightWriteBack back =
			rules::campaign::writeBackFight(played(), testRules().content, testRules().campaign, foughtTo(rules::Outcome::Lost));
		ASSERT_TRUE(back.lost.has_value());
		std::optional<rules::campaign::DayEnd> night;
		if (!played().end) {
			night = rules::campaign::endDay(played(), testRules().content, testRules().campaign);
		}
		app->scenes().push<DebriefScene>(DebriefArgs{.home = std::nullopt, .lost = back.lost, .seats = back.seats, .night = night});
		frame();
		ASSERT_EQ(top(), "debrief");
		ASSERT_NE(find("stamp"), nullptr);
		EXPECT_EQ(textOf("heading_title"), "The run was lost");
		EXPECT_EQ(textOf("lost_cargo_text"), "The cargo: 30 scrap.");
		lintsZero();
	}

	TEST_F(Results, TheCampaignsEndIsABurntSheetWithFallenStruckAndItsRecord) {
		played().stores.people = 0;
		played().stores.food = 0;
		rules::campaign::endCampaign(played(), testRules().campaign.compound, rules::campaign::EndCause::NoPeople);
		ASSERT_TRUE(context->store.save(played()));
		go(scenes::kCampaignEnd);
		frame();
		ASSERT_EQ(top(), scenes::kCampaignEnd);
		const auto* sheet = dynamic_cast<const atlas::Sheet*>(find("sheet"));
		ASSERT_NE(sheet, nullptr);
		EXPECT_EQ(sheet->getLook().wear, atlas::Wear::Damaged);
		EXPECT_EQ(sheet->getLook().mark, atlas::HeroMark::Burn);
		EXPECT_EQ(textOf("heading_title"), "The compound starved");
		ASSERT_NE(find("stamp"), nullptr);
		EXPECT_EQ(textOf("last_day_0_text"), "Founded the compound.");
		EXPECT_EQ(textOf("last_day_1_text"), "No people are left, and the compound starved.") << "the fall last, with its diamond";
		EXPECT_EQ(textOf("record_0_value"), "1 day");
		lintsZero();
		ASSERT_TRUE(press("main_menu"));
		EXPECT_EQ(top(), scenes::kMainMenu);
	}

} // namespace
