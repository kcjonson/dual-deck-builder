// The Crew screen in the atlas: it lints 0 at the sizes the game opens at with a full locker and a lost driver, Add and
// Remove move a copy and save it, a refusal is the rules' reason under the card, Scrap takes two presses apart, and the
// chosen driver is marked in highlighter.

#include "GameTesting.h"
#include "atlas/Highlighter.h"
#include "cards/DriverCard.h"

#include <rules/campaign/Locker.h>
#include <rules/campaign/Recruits.h>
#include <rules/campaign/RunDecks.h>

#include <ui/shapes/Text.h>

#include <string>

namespace {

	using namespace game;
	using namespace game::testing;
	using rules::CardId;
	using rules::campaign::DriverStatus;

	class Crew : public GameTest {
	  protected:
		// A new campaign's crew, from the compound's Crew tab, with a locker of `locker`.
		void open(const rules::campaign::CardCounts& locker = {}) {
			start(fixtureMakers(), true);
			go(scenes::kMainMenu);
			ASSERT_TRUE(press("new_campaign"));
			ASSERT_TRUE(frameUntil([this] { return top() == scenes::kCompound; }));
			played().locker = locker;
			ASSERT_TRUE(press("tab_crew"));
			ASSERT_EQ(top(), scenes::kCrew);
		}

		[[nodiscard]] std::string textOf(std::string_view id) {
			const auto* text = dynamic_cast<const ui::Text*>(find(id));
			return text != nullptr ? text->getText() : "";
		}

		[[nodiscard]] std::string chosen() { return state()["chosen"]; }

		[[nodiscard]] int inDeck(std::string_view card) {
			const nlohmann::json deck = state()["deck"];
			return deck.contains(card) ? deck[std::string(card)].get<int>() : 0;
		}
	};

	TEST_F(Crew, ItLintsZeroWithAFullLockerAndALostDriver) {
		rules::campaign::CardCounts locker;
		for (const auto& [id, definition] : testRules().content.cards) {
			if (!definition.signatureOf) {
				locker[id] = 2;
			}
		}
		open(locker);
		played().drivers.back().status = DriverStatus::Dead;
		played().drivers.back().hitpoints = 0;
		played().drivers.back().defaultDeck.clear();
		go(scenes::kCrew);
		ASSERT_NE(find("roster_" + played().drivers.back().id.value), nullptr);
		EXPECT_FALSE(enabled("roster_" + played().drivers.back().id.value)) << "the lost can't be picked";
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
	}

	TEST_F(Crew, AddAndRemoveMoveACopyAndSaveIt) {
		open({{CardId{"headshot"}, 2}});
		const std::string driver = chosen();
		const int		  before = inDeck("headshot");
		ASSERT_TRUE(press("locker_headshot_add"));
		EXPECT_EQ(inDeck("headshot"), before + 1);
		EXPECT_EQ(rules::campaign::countOf(played().locker, CardId{"headshot"}), 1);
		EXPECT_EQ(*context->store.status().campaign, played()) << "saved as it's made";
		ASSERT_TRUE(press("deck_headshot_remove"));
		EXPECT_EQ(inDeck("headshot"), before);
		EXPECT_EQ(chosen(), driver);
	}

	TEST_F(Crew, ARefusedMoveSaysTheRulesReasonUnderTheCard) {
		open({{CardId{"headshot"}, 1}});
		const rules::campaign::DriverRecord& driver = *played().findDriver(rules::campaign::CrewId{chosen()});
		const auto&							 deck = driver.defaultDeck;
		ASSERT_FALSE(deck.empty());
		// Down to the fewest a deck holds: every Remove says so.
		while (rules::campaign::totalCards(played().findDriver(driver.id)->defaultDeck) > testRules().campaign.deck.fewestCards) {
			const CardId first = played().findDriver(driver.id)->defaultDeck.begin()->first;
			ASSERT_TRUE(press("deck_" + first.value + "_remove"));
		}
		const CardId left = played().findDriver(driver.id)->defaultDeck.begin()->first;
		EXPECT_FALSE(enabled("deck_" + left.value + "_remove"));
		EXPECT_EQ(textOf("deck_" + left.value + "_reason"), "Deck at minimum");
		EXPECT_EQ(lintAt(1280, 800), "");
	}

	TEST_F(Crew, ScrapTakesTwoPressesApart) {
		open({{CardId{"headshot"}, 2}});
		const int scrap = played().stores.scrap;
		ASSERT_TRUE(press("locker_headshot_scrap"));
		EXPECT_EQ(state()["armed"], "locker_headshot_scrap");
		EXPECT_EQ(textOf("locker_headshot_reason"), "Press again to scrap");
		ASSERT_TRUE(press("locker_headshot_scrap"));
		EXPECT_EQ(rules::campaign::countOf(played().locker, CardId{"headshot"}), 2) << "a double-click's second press does nothing";
		// The ui clock takes at most a quarter second a frame.
		frame(0.2);
		frame(0.2);
		ASSERT_TRUE(press("locker_headshot_scrap"));
		EXPECT_EQ(rules::campaign::countOf(played().locker, CardId{"headshot"}), 1);
		EXPECT_EQ(played().stores.scrap, scrap + testRules().campaign.deck.scrapPerCard);
		EXPECT_EQ(state()["armed"], "");

		ASSERT_TRUE(press("locker_headshot_scrap"));
		for (int step = 0; step < 16; ++step) {
			frame(0.25);
		}
		EXPECT_EQ(state()["armed"], "") << "it lets go after a while";
	}

	TEST_F(Crew, ADriverOutOnARunShowsTheirSeatAndTheirDeckCantChange) {
		open({{CardId{"headshot"}, 1}});
		const rules::campaign::CrewId out = played().drivers[0].id;
		rules::campaign::startRun(played(), testRules().content, {.seats = {out}, .stage = 0});
		go(scenes::kCrew);
		ASSERT_EQ(chosen(), out.value);
		const auto* card = dynamic_cast<const cards::DriverCard*>(find("roster_" + out.value));
		ASSERT_NE(card, nullptr);
		EXPECT_EQ(card->getFace().tag, "SEAT 1");
		EXPECT_GT(inDeck(played().run->seats[0].own.begin()->first.value), 0) << "their default deck as their run deck holds it";
		EXPECT_FALSE(enabled("locker_headshot_add"));
		EXPECT_EQ(textOf("locker_headshot_reason"), "Out on a run");
		EXPECT_EQ(lintAt(1280, 800), "");
	}

	TEST_F(Crew, ChoosingADriverMarksThemAndShowsTheirDeck) {
		open();
		const std::string other = played().drivers[1].id.value;
		ASSERT_TRUE(press("roster_" + other));
		EXPECT_EQ(chosen(), other);
		const auto* mark = dynamic_cast<const atlas::Highlight*>(find("roster_" + other + "_mark"));
		ASSERT_NE(mark, nullptr);
		EXPECT_TRUE(mark->isMarked());
		const auto* first = dynamic_cast<const atlas::Highlight*>(find("roster_" + played().drivers[0].id.value + "_mark"));
		ASSERT_NE(first, nullptr);
		EXPECT_FALSE(first->isMarked());
		const std::string name = rules::campaign::driverName(played(), testRules().content, played().drivers[1].id);
		EXPECT_EQ(textOf("deck_title"), name) << "named as the rest of the game names them";
		const auto* card = dynamic_cast<const cards::DriverCard*>(find("roster_" + other));
		ASSERT_NE(card, nullptr);
		EXPECT_EQ(card->getFace().name, name);
	}

} // namespace
