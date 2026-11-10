// The run and the event scene in the atlas: every step a run meets lints 0 at the sizes the game opens at, the event's
// choices and its outcome too; a reward's cards are cards; an event's locked choice says why in the kit's words, with
// drivers named as the rest of the game names them; a choice is taken by its number key; and Back to the road leaves
// the event untaken.

#include "GameTesting.h"
#include "Words.h"
#include "cards/Card.h"
#include "scenes/battle/BattleScene.h"
#include "scenes/event/ChoiceCard.h"
#include "scenes/map/Planning.h"

#include <rules/campaign/EventStops.h>
#include <rules/campaign/RunDecks.h>
#include <rules/campaign/SupplyRun.h>

#include <ui/shapes/Text.h>

#include <set>
#include <string>
#include <vector>

namespace {

	using namespace game;
	using namespace game::testing;
	using rules::campaign::Campaign;

	class Run : public GameTest {
	  protected:
		void SetUp() override {
			start(fixtureMakers(), true);
			go(scenes::kMainMenu);
			ASSERT_TRUE(press("new_campaign"));
			ASSERT_TRUE(frameUntil([this] { return top() == scenes::kCompound; }));
			played().stores.fuel = 100;
			atHome = played();
		}

		// Every route on offer today to a destination the map has found.
		[[nodiscard]] std::vector<rules::campaign::RouteChoice> routes() {
			const Planning							  planned = planning(*context->session);
			std::vector<rules::campaign::RouteChoice> found;
			for (const Destination& destination : planned.destinations) {
				for (const rules::map::RouteOffer& offer : destination.routes) {
					if (!planBlocker(played(), destination)) {
						found.push_back({.poi = destination.poi, .route = offer.route.route});
					}
				}
			}
			return found;
		}

		// The campaign as founded, out on `route` with its first two drivers, on the run scene.
		void leaveOn(const rules::campaign::RouteChoice& route) {
			played() = atHome;
			rules::campaign::startRun(
				played(),
				testRules().content,
				{.seats = {played().drivers[0].id, played().drivers[1].id}, .stage = rules::campaign::gameStage(played())}
			);
			rules::campaign::depart(played(), context->session->layers(), route);
			ASSERT_TRUE(context->store.save(played()));
			go(scenes::kRun);
			ASSERT_EQ(top(), scenes::kRun);
		}

		[[nodiscard]] rules::campaign::Ahead ahead() { return rules::campaign::ahead(played(), context->session->layers()); }

		// The first choice the party can take at the event the run is at.
		[[nodiscard]] std::string openChoice() {
			const Session&							session = *context->session;
			const rules::campaign::EventDefinition& event =
				rules::campaign::stopEvent(session.campaign, testRules().events, session.layers());
			for (const rules::campaign::EventChoice& choice : event.choices) {
				if (!rules::campaign::choiceBlocker(session.campaign, testRules().events, session.layers(), choice.id)) {
					return choice.id;
				}
			}
			ADD_FAILURE() << "an event with no choice the party can take";
			return {};
		}

		// The fight up, played out and left, and past its result if the run is still going.
		void fightThrough() {
			ASSERT_EQ(top(), "battle");
			static_cast<BattleScene*>(app->scenes().top())->playOut();
			frame();
			ASSERT_TRUE(press("leave"));
			frame();
			if (top() == "battle_result") {
				ASSERT_TRUE(press("continue"));
				frame();
			}
		}

		[[nodiscard]] std::string lintThree() { return lintAt(1280, 800) + lintAt(1440, 900) + lintAt(1920, 1080); }

		[[nodiscard]] std::string textOf(std::string_view id) {
			const auto* text = dynamic_cast<const ui::Text*>(find(id));
			return text != nullptr ? text->getText() : "";
		}

		Campaign atHome;
	};

	TEST_F(Run, EveryStepARunMeetsAndTheEventScenesLintZero) {
		std::set<std::string> linted;
		for (const rules::campaign::RouteChoice& route : routes()) {
			leaveOn(route);
			for (int step = 0; step < 40 && top() == scenes::kRun; ++step) {
				const std::string kind = state()["ahead"];
				if (linted.insert(kind).second) {
					EXPECT_EQ(lintThree(), "") << "the run at " << kind;
					EXPECT_EQ(textOf("title").find("POI"), std::string::npos) << textOf("title");
					if (kind == "fight" || kind == "find" || kind == "event") {
						const std::string kicker = textOf("step_kicker");
						const std::string ofAll = " of " + std::to_string(state()["stops"].get<int>() + 1);
						if (kicker.rfind("stop ", 0) == 0) {
							EXPECT_NE(kicker.find(ofAll), std::string::npos) << "the count includes the destination: " << kicker;
						}
					}
					if (kind == "home") {
						EXPECT_EQ(textOf("notice").find("looks clear"), std::string::npos) << "the head already says the road is clear";
					}
				}
				if (kind == "fight") {
					ASSERT_TRUE(press("fight"));
					fightThrough();
				} else if (kind == "find") {
					ASSERT_TRUE(press("take_find"));
				} else if (kind == "event") {
					ASSERT_TRUE(press("pull_over"));
					ASSERT_EQ(top(), "event");
					if (linted.insert("event_choices").second) {
						EXPECT_EQ(lintThree(), "") << "the event's choices";
					}
					ASSERT_TRUE(press("choice_" + openChoice()));
					ASSERT_NE(find("event_go"), nullptr);
					if (linted.insert("event_outcome").second) {
						EXPECT_EQ(lintThree(), "") << "the event's outcome";
					}
					EXPECT_EQ(*context->store.status().campaign, played()) << "the choice is saved as it's taken";
					ASSERT_TRUE(press("event_go"));
					if (top() == "battle") {
						fightThrough();
					}
				} else if (kind == "reward") {
					ASSERT_NE(dynamic_cast<cards::Card*>(find("reward_0")), nullptr) << "a reward's cards are cards";
					ASSERT_TRUE(press("reward_0"));
				} else if (kind == "objective") {
					ASSERT_TRUE(press("take_objective"));
				} else if (kind == "home") {
					ASSERT_TRUE(press("drive_home"));
				}
			}
			if (linted.size() == 8) {
				break;
			}
		}
		std::string seen;
		for (const std::string& kind : linted) {
			seen += kind + " ";
		}
		RecordProperty("linted", seen);
		for (const char* kind : {"fight", "find", "reward", "objective", "home", "event", "event_choices", "event_outcome"}) {
			EXPECT_TRUE(linted.contains(kind)) << "no route on the fixture map reached " << kind;
		}
	}

	class Event : public Run {
	  protected:
		// Out on a route whose stops before its first event are finds, at that event: false when none is.
		bool toAnEvent() {
			for (const rules::campaign::RouteChoice& route : routes()) {
				leaveOn(route);
				while (ahead() == rules::campaign::Ahead::Find) {
					rules::campaign::driveOn(played(), context->session->layers());
				}
				if (ahead() == rules::campaign::Ahead::Event) {
					go(scenes::kRun);
					return true;
				}
			}
			return false;
		}
	};

	TEST_F(Event, ALockedChoiceSaysWhyAndAChoiceIsTakenByItsKey) {
		ASSERT_TRUE(toAnEvent()) << "no route on the fixture map meets an event before a fight";
		ASSERT_TRUE(press("pull_over"));
		ASSERT_EQ(top(), "event");
		const Session&							session = *context->session;
		const rules::campaign::EventDefinition& event = rules::campaign::stopEvent(session.campaign, testRules().events, session.layers());
		for (const rules::campaign::EventChoice& choice : event.choices) {
			const std::string band = textOf("choice_" + choice.id + "_need");
			EXPECT_EQ(band.find("THE "), std::string::npos) << band;
			const auto blocked = rules::campaign::choiceBlocker(session.campaign, testRules().events, session.layers(), choice.id);
			EXPECT_EQ(enabled("choice_" + choice.id), !blocked.has_value()) << choice.id;
			if (blocked && blocked->reason == rules::campaign::ChoiceRefusal::Archetype) {
				EXPECT_EQ(band, "Needs " + anArchetype(testRules().content, *choice.needs.archetype)) << choice.id;
			}
		}
		// The first choice the party can take, by its number key.
		size_t place = 0;
		while (rules::campaign::choiceBlocker(session.campaign, testRules().events, session.layers(), event.choices[place].id)) {
			++place;
		}
		const std::string taken = event.choices[place].id;
		const auto		  key = static_cast<foundation::Key>(static_cast<int>(foundation::Key::Num1) + static_cast<int>(place));
		platform->push({.type = foundation::InputEvent::Type::KeyDown, .key = key});
		platform->push({.type = foundation::InputEvent::Type::KeyUp, .key = key});
		frame();
		EXPECT_EQ(state()["taken"], taken);
		EXPECT_NE(find("event_go"), nullptr);
		EXPECT_EQ(find("back_to_road"), nullptr) << "once a choice is taken, only the highway goes on";
	}

	TEST_F(Event, BackToTheRoadLeavesTheEventUntaken) {
		ASSERT_TRUE(toAnEvent()) << "no route on the fixture map meets an event before a fight";
		ASSERT_TRUE(press("pull_over"));
		ASSERT_EQ(top(), "event");
		ASSERT_TRUE(press("back_to_road"));
		EXPECT_EQ(top(), scenes::kRun);
		EXPECT_EQ(state()["ahead"], "event");
	}

} // namespace
