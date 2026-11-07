// Load out and Customize in the atlas: load out opens on a crew that can go with every escort, lints 0 at the sizes the
// game opens at, seats from the pool and brings or leaves escorts; Customize deals the run decks, moves a card on the
// rules' word and lints 0; Done comes back to load out with the deck customized, and Back gives the decks up.

#include "scenes/loadout/LoadOutScene.h"
#include "GameTesting.h"
#include "atlas/Highlighter.h"
#include "cards/DriverCard.h"
#include "scenes/map/Planning.h"

#include <rules/campaign/Convoy.h>
#include <rules/campaign/RunDecks.h>

#include <ui/shapes/Text.h>

#include <string>

namespace {

	using namespace game;
	using namespace game::testing;
	using rules::CardId;

	class LoadOut : public GameTest {
	  protected:
		// A new campaign with two escorts in its convoy and a locker of a few cards, at load out for its first route.
		void open() {
			start(fixtureMakers(), true);
			go(scenes::kMainMenu);
			ASSERT_TRUE(press("new_campaign"));
			ASSERT_TRUE(frameUntil([this] { return top() == scenes::kCompound; }));
			for (const char* escort : {"fuel_hauler", "outrider"}) {
				(void)rules::campaign::joinConvoy(played(), testRules().content, rules::EscortId{escort});
			}
			played().locker = {{CardId{"headshot"}, 2}, {CardId{"medical_kit"}, 1}};
			std::optional<rules::campaign::RouteChoice> route;
			for (const Destination& destination : planning(*context->session).destinations) {
				if (!route && !destination.stronghold && !destination.routes.empty()) {
					route = rules::campaign::RouteChoice{.poi = destination.poi, .route = destination.routes.front().route.route};
				}
			}
			ASSERT_TRUE(route.has_value());
			app->scenes().push<LoadOutScene>(LoadOutArgs{.route = *route});
			frame();
			ASSERT_EQ(top(), "load_out");
		}

		// Focus scrolls the body to it, as a key press would, so the press lands on it.
		bool pressShown(const std::string& id) {
			ui::Component* component = find(id);
			if (component == nullptr) {
				ADD_FAILURE() << "nothing shown has the id " << id;
				return false;
			}
			component->focus();
			frame();
			return press(id);
		}

		[[nodiscard]] std::string textOf(std::string_view id) {
			const auto* text = dynamic_cast<const ui::Text*>(find(id));
			return text != nullptr ? text->getText() : "";
		}
	};

	TEST_F(LoadOut, ItOpensOnACrewThatCanGoWithEveryEscortAndLintsZero) {
		open();
		const nlohmann::json opened = state();
		EXPECT_EQ(opened["seats"].size(), 2U);
		EXPECT_EQ(opened["escorts"].size(), 2U);
		EXPECT_FALSE(opened["decksOut"].get<bool>()) << "dealt only when needed";
		EXPECT_TRUE(enabled("start_run")) << opened;
		const auto* mark = dynamic_cast<const atlas::Highlight*>(find("escort_escort-1_mark"));
		ASSERT_NE(mark, nullptr);
		EXPECT_TRUE(mark->isMarked());
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
	}

	TEST_F(LoadOut, ASeatClearedIsFilledFromThePoolAndAnEscortLeftStaysHome) {
		open();
		const std::string second = state()["seats"][1];
		ASSERT_TRUE(press("seat_2_clear"));
		EXPECT_EQ(state()["seats"].size(), 1U);
		EXPECT_FALSE(enabled("start_run"));
		EXPECT_EQ(textOf("start_line"), "Seat two drivers to start the run.");
		ASSERT_TRUE(pressShown("pool_" + second + "_seat"));
		EXPECT_EQ(state()["seats"][1], second);

		ASSERT_TRUE(pressShown("escort_escort-2"));
		EXPECT_EQ(state()["escorts"], nlohmann::json::array({"escort-1"}));
		EXPECT_EQ(textOf("escort_escort-2_state"), "At home");
		EXPECT_EQ(lintAt(1280, 800), "");
	}

	TEST_F(LoadOut, CustomizeDealsTheDecksAndDoneComesBackCustomized) {
		open();
		const std::string driver = state()["seats"][0];
		ASSERT_TRUE(press("seat_1_customize"));
		ASSERT_EQ(top(), "customize");
		ASSERT_TRUE(played().run.has_value()) << "the run decks are out";
		EXPECT_EQ(played().run->seats[0].escortCards.size(), 2U) << "escort cards go to Driver 1";
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");

		ASSERT_TRUE(press("locker_headshot_borrow"));
		EXPECT_EQ(rules::campaign::countOf(played().run->seats[0].borrowed, CardId{"headshot"}), 1);
		ASSERT_NE(find("deck_headshot-borrowed"), nullptr) << "a +N stack of its own";
		EXPECT_EQ(*context->store.status().campaign, played()) << "saved as it's made";
		ASSERT_TRUE(press("escort_cards_escort-1_give"));
		EXPECT_EQ(played().run->seats[1].escortCards.size(), 1U);

		ASSERT_TRUE(press("done"));
		ASSERT_EQ(top(), "load_out");
		EXPECT_TRUE(state()["decksOut"].get<bool>());
		const auto* card = dynamic_cast<const cards::DriverCard*>(find("seat_1_driver"));
		ASSERT_NE(card, nullptr);
		EXPECT_TRUE(card->getFace().custom);
		EXPECT_EQ(textOf("start_line"), "One run deck is customized for this run. 2 escorts and their cards come along.");

		// An escort left once the decks are out takes only its card, and the customizing stays.
		ASSERT_TRUE(pressShown("escort_escort-2"));
		EXPECT_EQ(rules::campaign::countOf(played().run->seats[0].borrowed, CardId{"headshot"}), 1);
		EXPECT_TRUE(played().run->seats[0].escortCards.empty());
		EXPECT_EQ(played().run->seats[1].escortCards.size(), 1U) << "the card given to driver 2 stays there";
		EXPECT_EQ(lintAt(1280, 800), "");

		ASSERT_TRUE(press("back"));
		EXPECT_EQ(top(), "run_route");
		EXPECT_FALSE(played().run.has_value()) << "Back gives the run decks up";
		EXPECT_EQ(rules::campaign::countOf(played().locker, CardId{"headshot"}), 2);
	}

	TEST_F(LoadOut, CustomizeLintsZeroWithEveryCardInTheLocker) {
		open();
		for (const auto& [id, definition] : testRules().content.cards) {
			if (!definition.signatureOf) {
				played().locker[id] = 3;
			}
		}
		ASSERT_TRUE(press("seat_1_customize"));
		ASSERT_EQ(top(), "customize");
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
	}

	TEST_F(LoadOut, StartRunLeavesWithTheCustomizedDeck) {
		open();
		ASSERT_TRUE(press("seat_2_customize"));
		ASSERT_EQ(top(), "customize");
		const rules::campaign::RunDeck& deck = played().run->seats[1];
		const CardId					first = deck.own.begin()->first;
		const int						copies = deck.own.begin()->second;
		ASSERT_TRUE(press("deck_" + first.value + "_fewer"));
		EXPECT_EQ(rules::campaign::countOf(played().run->seats[1].leftHome, first), 1);
		EXPECT_EQ(rules::campaign::countOf(played().run->seats[1].own, first), copies - 1);
		ASSERT_TRUE(press("done"));
		ASSERT_TRUE(enabled("start_run")) << state();
		ASSERT_TRUE(press("start_run"));
		EXPECT_EQ(top(), scenes::kRun);
		ASSERT_TRUE(played().run && played().run->route);
		EXPECT_EQ(rules::campaign::countOf(played().run->seats[1].leftHome, first), 1);
	}

} // namespace
