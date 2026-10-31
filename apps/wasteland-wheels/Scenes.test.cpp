// The scenes through the App's own frame and input, on salal's headless platform: the flow from the splash to a
// campaign's end, founding and Continue on the fast lane's fixture map, a founding cancelled, and a run out and home.

#include "GameTesting.h"
#include "scenes/battle/BattleScene.h"

#include <rules/campaign/CampaignEnd.h>
#include <rules/campaign/EventStops.h>
#include <rules/campaign/SupplyRun.h>
#include <rules/map/RouteOffers.h>

#include <algorithm>
#include <fstream>
#include <optional>
#include <string>
#include <variant>

namespace {

	using namespace game;
	using namespace game::testing;
	using rules::campaign::Ahead;

	class Scenes : public GameTest {
	  protected:
		// A new campaign founded from the menu, on the compound.
		void found() {
			go(scenes::kMainMenu);
			ASSERT_TRUE(press("new_campaign"));
			ASSERT_TRUE(frameUntil([this] { return top() == scenes::kCompound; }));
		}
	};

	TEST_F(Scenes, TheSplashGoesToTheMenuWhichHasNothingToContinue) {
		start();
		go(scenes::kSplash);
		EXPECT_EQ(top(), scenes::kSplash);
		frame(1.0);
		EXPECT_EQ(top(), scenes::kSplash) << "a frame counts at most a quarter second";
		for (int index = 0; index < 8 && top() == scenes::kSplash; ++index) {
			frame(0.25);
		}
		ASSERT_EQ(top(), scenes::kMainMenu);
		EXPECT_FALSE(enabled("continue"));
		EXPECT_EQ(state()["continue"]["line"], "No campaign in progress.");
		EXPECT_TRUE(enabled("new_campaign"));
	}

	TEST_F(Scenes, NewCampaignFoundsOnAMapMadeOffTheFrameSavesItAndOpensTheCompound) {
		start();
		found();
		ASSERT_TRUE(context->session.has_value());
		EXPECT_EQ(played().mapOrigin, rules::campaigns::testMap().origin);
		const SaveStatus status = context->store.status();
		ASSERT_EQ(status.state, SaveState::Saved);
		EXPECT_EQ(*status.campaign, played());
		EXPECT_EQ(status.line, campaignSummary(played()));
		EXPECT_TRUE(status.line.starts_with("Day 1 - ")) << status.line;

		go(scenes::kMainMenu);
		EXPECT_TRUE(enabled("continue"));
		EXPECT_EQ(state()["continue"]["line"], status.line);
	}

	TEST_F(Scenes, CancellingAFoundingStopsItsWorkerAndKeepsNothing) {
		start(heldMakers());
		go(scenes::kMainMenu);
		ASSERT_TRUE(press("new_campaign"));
		ASSERT_TRUE(frameUntil([this] {
			return top() == scenes::kFounding && state()["progress"] == "Making the area map: terrain (1 of 9)";
		}));
		ASSERT_TRUE(press("cancel"));
		EXPECT_TRUE(state()["cancelling"].get<bool>());
		ASSERT_TRUE(frameUntil([this] { return top() == scenes::kMainMenu; }));
		EXPECT_FALSE(context->session.has_value());
		EXPECT_EQ(context->store.status().state, SaveState::None);
	}

	TEST_F(Scenes, ANewCampaignOverASaveAsksFirstAndTheOneItReplacesGoesIntoTheHistory) {
		start();
		found();
		const rules::campaign::Campaign first = played();
		go(scenes::kMainMenu);
		ASSERT_TRUE(press("new_campaign"));
		EXPECT_TRUE(state()["confirming"].get<bool>());
		ASSERT_TRUE(press("keep"));
		EXPECT_FALSE(state()["confirming"].get<bool>());
		EXPECT_EQ(*context->store.status().campaign, first);

		ASSERT_TRUE(press("new_campaign"));
		ASSERT_TRUE(press("confirm_new"));
		ASSERT_TRUE(frameUntil([this] { return top() == scenes::kCompound; }));
		const std::vector<HistoryEntry> history = context->store.history();
		ASSERT_EQ(history.size(), 1U);
		EXPECT_EQ(history.front(), historyEntry(first, "abandoned"));
		go(scenes::kMainMenu);
		EXPECT_EQ(state()["history"], 1);
	}

	TEST_F(Scenes, ContinueMakesTheSavesMapAgainAndASaveOnAnotherMapOffersANewCampaign) {
		start();
		found();
		const rules::campaign::Campaign saved = played();
		context->session.reset();
		go(scenes::kMainMenu);
		ASSERT_TRUE(press("continue"));
		ASSERT_TRUE(frameUntil([this] { return top() == scenes::kCompound; }));
		EXPECT_EQ(played(), saved);

		// A save whose map is another one, as another build's generator makes, fails its fingerprint.
		nlohmann::json other = *context->store.saveJson();
		other["mapOrigin"]["fingerprint"] = "0123456789abcdef";
		ASSERT_TRUE(app->saves().writeJson(CampaignStore::kCampaignSlot, other));
		context->session.reset();
		go(scenes::kMainMenu);
		ASSERT_TRUE(press("continue"));
		ASSERT_TRUE(frameUntil([this] { return top() == scenes::kLoading && !state()["failure"].get<std::string>().empty(); }));
		EXPECT_NE(state()["failure"].get<std::string>().find("fingerprint"), std::string::npos) << state()["failure"];
		ASSERT_TRUE(press("start_fresh"));
		ASSERT_TRUE(frameUntil([this] { return top() == scenes::kCompound; }));
		EXPECT_EQ(*context->store.status().campaign, played());
	}

	TEST_F(Scenes, TheCompoundsDayActionsAreTheRulesAndEachIsSaved) {
		start();
		found();
		ASSERT_TRUE(press("rest"));
		EXPECT_EQ(played().day, 2);
		EXPECT_EQ(*context->store.status().campaign, played());
		const int scrap = played().stores.scrap;
		ASSERT_TRUE(press("scavenge"));
		EXPECT_EQ(played().day, 3);
		EXPECT_GE(played().stores.scrap, scrap);
		EXPECT_EQ(*context->store.status().campaign, played());
	}

	TEST_F(Scenes, AnEndedCampaignGoesIntoTheHistoryWithItsFallAndItsSaveGoes) {
		start();
		found();
		played().stores.people = 0;
		rules::campaign::endCampaign(played(), testRules().campaign.compound, rules::campaign::EndCause::NoPeople);
		const rules::campaign::Campaign ended = played();
		ASSERT_TRUE(context->store.save(ended));
		go(scenes::kCompound);
		frame(); // a switch asked for in onEnter applies the frame after
		ASSERT_EQ(top(), scenes::kCampaignEnd);
		EXPECT_TRUE(state()["recorded"].get<bool>());
		EXPECT_EQ(context->store.status().state, SaveState::None);
		ASSERT_EQ(context->store.history().size(), 1U);
		EXPECT_EQ(context->store.history().front(), historyEntry(ended, ""));
		EXPECT_FALSE(context->session.has_value());
		ASSERT_TRUE(press("main_menu"));
		EXPECT_EQ(top(), scenes::kMainMenu);
	}

	TEST_F(Scenes, SettingsApplyAtOnceAndAreSaved) {
		start();
		go(scenes::kSettings);
		EXPECT_TRUE(state()["vsync"].get<bool>());
		ASSERT_TRUE(press("vsync"));
		EXPECT_FALSE(platform->vsync());
		EXPECT_EQ(nlohmann::json::parse(std::ifstream(dir.path() / "settings.json"))["video"]["vsync"], false);
	}

	// The route with a fight on it that meets the fewest stops, so the run is short and still fights.
	rules::campaign::RouteChoice shortestFightingRoute(const Session& session) {
		std::optional<std::pair<rules::campaign::RouteChoice, size_t>> best;
		for (const rules::map::RouteOffer& offer : rules::campaign::offersToday(session.campaign, session.layers())) {
			if (offer.destination.stronghold) {
				continue;
			}
			size_t stops = 0;
			bool   fights = false;
			for (const rules::map::OfferedLeg& leg : offer.legs) {
				for (const rules::map::OfferedStop& stop : leg.stops) {
					stops += 1;
					fights = fights || rules::map::isFight(stop.type);
				}
			}
			if (fights && (!best || stops < best->second)) {
				best = {rules::campaign::RouteChoice{.poi = offer.destination.poi, .route = offer.route.route}, stops};
			}
		}
		EXPECT_TRUE(best.has_value()) << "no route on the fixture map has a fight";
		return best ? best->first : rules::campaign::RouteChoice{};
	}

	TEST_F(Scenes, ARunLeavesFromLoadOutPlaysEveryStopAsTheRulesSayAndComesToItsDebrief) {
		start();
		found();
		played().stores.fuel = 100;
		const rules::campaign::RouteChoice route = shortestFightingRoute(*context->session);
		ASSERT_TRUE(press("plan_run"));
		ASSERT_EQ(top(), scenes::kAreaMap);
		ASSERT_TRUE(press("poi_" + std::to_string(route.poi)));
		ASSERT_TRUE(press("route_" + std::to_string(route.poi) + "_" + std::to_string(route.route)));
		ASSERT_EQ(top(), "load_out");
		EXPECT_FALSE(enabled("start_run"));
		ASSERT_TRUE(press("pool_" + played().drivers[0].id.value));
		ASSERT_TRUE(press("pool_" + played().drivers[1].id.value));
		ASSERT_TRUE(enabled("start_run")) << state();
		ASSERT_TRUE(press("start_run"));
		ASSERT_EQ(top(), scenes::kRun);
		ASSERT_TRUE(played().run && played().run->route);
		EXPECT_EQ(*context->store.status().campaign, played());

		bool fought = false;
		for (int step = 0; step < 40 && top() == scenes::kRun; ++step) {
			const std::string ahead = state()["ahead"];
			if (ahead == "fight") {
				ASSERT_TRUE(press("fight"));
				ASSERT_EQ(top(), "battle");
				auto& battle = *static_cast<BattleScene*>(app->scenes().top());
				// One play through its rows, aimed where it has to be, then the turn ended through its button.
				const std::vector<rules::Action>& offered = battle.actions();
				const auto						  play = std::ranges::find_if(offered, [](const rules::Action& action) {
					   return std::holds_alternative<rules::action::PlayCard>(action);
				   });
				if (!fought && play != offered.end()) {
					// Copied, since a play rebuilds what's on offer.
					const rules::action::PlayCard card = std::get<rules::action::PlayCard>(*play);
					const auto					  index = static_cast<size_t>(play - offered.begin());
					const auto					  ways = std::ranges::count_if(offered, [&](const rules::Action& action) {
						   const auto* other = std::get_if<rules::action::PlayCard>(&action);
						   return other && other->driver == card.driver && other->handIndex == card.handIndex;
					   });
					const int					  adrenaline = battle.current().state.driver(card.driver).adrenaline;
					ASSERT_TRUE(press("hand_" + std::to_string(card.driver.value) + "_" + std::to_string(card.handIndex)));
					if (ways > 1) {
						ASSERT_TRUE(press("target_" + std::to_string(index)));
					}
					EXPECT_LT(battle.current().state.driver(card.driver).adrenaline, adrenaline);
					ASSERT_TRUE(press("end_turn"));
				}
				fought = true;
				battle.playOut();
				frame();
				ASSERT_TRUE(press("leave"));
				ASSERT_EQ(top(), scenes::kRun) << "the fight written back, the run goes on or fails";
				frame();
			} else if (ahead == "find") {
				ASSERT_TRUE(press("take_find"));
			} else if (ahead == "event") {
				const Session&							session = *context->session;
				const rules::campaign::EventDefinition& event =
					rules::campaign::stopEvent(session.campaign, testRules().events, session.layers());
				const auto open = std::ranges::find_if(event.choices, [&](const rules::campaign::EventChoice& choice) {
					return !rules::campaign::choiceBlocker(session.campaign, testRules().events, session.layers(), choice.id);
				});
				ASSERT_NE(open, event.choices.end());
				ASSERT_TRUE(press("choice_" + open->id));
			} else if (ahead == "reward") {
				ASSERT_TRUE(press("reward_0"));
			} else if (ahead == "objective") {
				ASSERT_TRUE(press("take_objective"));
			} else if (ahead == "home") {
				ASSERT_TRUE(press("drive_home"));
			}
			if (top() == scenes::kRun) {
				EXPECT_EQ(*context->store.status().campaign, played()) << "saved after every step";
			}
		}
		EXPECT_TRUE(fought);
		frame();
		ASSERT_EQ(top(), "debrief");
		const rules::campaign::Tally tally = played().tally;
		EXPECT_EQ(tally.runsHome + tally.runsFailed, 1);
		EXPECT_FALSE(played().run.has_value());
		const bool over = played().end.has_value();
		ASSERT_TRUE(press("to_compound"));
		EXPECT_EQ(top(), over ? scenes::kCampaignEnd : scenes::kCompound);
	}

} // namespace
