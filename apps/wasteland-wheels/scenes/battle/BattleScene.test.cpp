// The battle scene driven the way a player drives it, through the App's own input: a card dragged onto a raider, a card
// picked up and dropped with the keys, a slot pick and a two-step play, the turn ended and the raiders' turn played
// back beat by beat until it settles on the fight, and the scene linted at three sizes.

#include "scenes/battle/BattleScene.h"
#include "GameTesting.h"
#include "road/RoadView.h"
#include "scenes/battle/Dock.h"

#include <rules/battle/Battle.h>
#include <rules/battle/CardPlay.h>
#include <rules/campaign/Campaign.h>

#include <ui/Drag.h>

#include <algorithm>
#include <optional>
#include <string>
#include <vector>

namespace game::testing {
	namespace {

		using rules::action::PlayCard;

		rules::PlayerSeat seat(const char* driver) {
			const rules::DriverId id{driver};
			return {.driver = id, .deck = rules::cardsOf(testRules().content.drivers.at(id).startingDeck)};
		}

		rules::RaiderSeat raider(const char* opponent) {
			return {.opponent = rules::OpponentId{opponent}};
		}

		// Everything the player's side has on the road, the bars a raider's hit takes from.
		int convoyStanding(const rules::BattleState& state) {
			int total = 0;
			for (const rules::BattleVehicle& vehicle : state.vehicles) {
				if (vehicle.side == rules::Side::Player) {
					total += vehicle.shield + vehicle.armor + vehicle.structure;
				}
			}
			for (const rules::BattleDriver& driver : state.drivers) {
				if (driver.side == rules::Side::Player) {
					total += driver.hitpoints;
				}
			}
			return total;
		}

		rules::BattleStart fielded(uint32_t seed) {
			return rules::startBattle(
				{.players = {seat("road_warrior"), seat("interceptor")},
				 .raiders = {raider("rust_buggy"), raider("scav_bike"), raider("spike_buggy")},
				 .seed = seed},
				testRules().content
			);
		}

		// A seed whose first enemy turn hurts the convoy, found by planning it and ending the turn on the rules alone.
		uint32_t hurtingSeed() {
			for (uint32_t seed = 1; seed < 20; ++seed) {
				rules::BattleState state = fielded(seed).state;
				(void)rules::planEnemyTurn(state, testRules().content, testRules().raiders.forRaiders());
				const int before = convoyStanding(state);
				(void)rules::apply(state, testRules().content, rules::legalActions(state, testRules().content).back());
				if (convoyStanding(state) < before) {
					return seed;
				}
			}
			return 0;
		}

		class Battle : public GameTest {
		  protected:
			void SetUp() override { start(fixtureMakers(), true); }

			// The Road Warrior and the Interceptor on their starting decks against three raiders, pushed with nothing under
			// it. `hand` replaces the first driver's opening hand.
			BattleScene& open(uint32_t seed, const std::vector<std::string>& hand = {}) {
				rules::BattleStart begun = fielded(seed);
				if (!hand.empty()) {
					begun.state.drivers[0].hand.clear();
					for (const std::string& card : hand) {
						begun.state.drivers[0].hand.push_back({.card = rules::CardId{card}});
					}
				}
				app->scenes().push<BattleScene>(
					BattleArgs{
						.start =
							{
								.fight =
									{.run = rules::campaign::RunId{"test"}, .encounter = rules::EncounterId{"test"}, .state = begun.state},
								.events = begun.events,
							}
					},
					[this](rules::campaign::CampaignFight fought) { left = std::move(fought); }
				);
				frame();
				return scene();
			}

			BattleScene& scene() { return *static_cast<BattleScene*>(app->scenes().top()); }

			// A play at a raider that takes no other pick, and costs something: one drop plays it.
			std::optional<PlayCard> oneDropAtARaider() {
				const std::vector<rules::Action>& legal = scene().actions();
				const rules::BattleState&		  state = scene().current().state;
				for (const rules::Action& action : legal) {
					const auto* play = std::get_if<PlayCard>(&action);
					if (play == nullptr || !play->target || state.vehicle(*play->target).side != rules::Side::Raiders) {
						continue;
					}
					const rules::BattleCard& card = state.driver(play->driver).hand[static_cast<size_t>(play->handIndex)];
					const bool				 single = std::ranges::all_of(legal, [&](const rules::Action& other) {
						  const auto* same = std::get_if<PlayCard>(&other);
						  return same == nullptr || same->driver != play->driver || same->handIndex != play->handIndex ||
								 (!same->destination && !same->occupant);
					  });
					if (single && rules::cardCost(testRules().content.cards.at(card.card), card.upgraded) > 0) {
						return *play;
					}
				}
				return std::nullopt;
			}

			static std::string slotId(rules::RoadSlot slot) {
				return "slot_" + std::to_string(static_cast<int>(slot.lane)) + "_" + std::to_string(static_cast<int>(slot.row));
			}

			static std::string handId(const PlayCard& play) {
				return "hand_" + std::to_string(play.driver.value) + "_" + std::to_string(play.handIndex);
			}

			// Frames until the playback has landed, a second at most.
			void settle() {
				for (int index = 0; index < 600 && scene().playing(); ++index) {
					frame(1.0 / 60.0);
				}
				ASSERT_FALSE(scene().playing());
			}

			std::optional<rules::campaign::CampaignFight> left;
		};

		TEST_F(Battle, ACardDraggedOntoARaiderPlaysThere) {
			open(1);
			const std::optional<PlayCard> play = oneDropAtARaider();
			ASSERT_TRUE(play) << "no one-drop attack in the opening hands";
			const rules::BattleDriver before = scene().current().state.driver(play->driver);
			ASSERT_TRUE(drag(handId(*play), "vehicle_" + std::to_string(play->target->value)));
			const rules::BattleDriver& after = scene().current().state.driver(play->driver);
			EXPECT_LT(after.adrenaline, before.adrenaline);
			EXPECT_EQ(after.hand.size() + 1, before.hand.size());
			EXPECT_FALSE(scene().aiming());
			EXPECT_NE(state()["last"], "") << "the play is in the log and the ticker";
		}

		TEST_F(Battle, ACardDroppedOffTheRoadPlaysNothing) {
			open(1);
			const std::optional<PlayCard> play = oneDropAtARaider();
			ASSERT_TRUE(play);
			const rules::BattleState before = scene().current().state;
			ASSERT_TRUE(drag(handId(*play), "top_bar"));
			EXPECT_EQ(scene().current().state, before);
		}

		TEST_F(Battle, ACardPickedUpWithTheKeysDropsOnARaider) {
			open(1);
			const std::optional<PlayCard> play = oneDropAtARaider();
			ASSERT_TRUE(play);
			const int	   before = scene().current().state.driver(play->driver).adrenaline;
			ui::Component* card = find(handId(*play));
			ASSERT_NE(card, nullptr);
			card->focus();
			frame();
			key(foundation::Key::Enter);
			const ui::Drag* held = scene().ui().drag();
			ASSERT_NE(held, nullptr) << "activate on a focused card picks it up";
			EXPECT_EQ(held->via, ui::DragVia::Keys);
			EXPECT_TRUE(held->accepted) << "it starts on the nearest target that takes it";
			key(foundation::Key::Enter);
			EXPECT_EQ(scene().ui().drag(), nullptr);
			EXPECT_LT(scene().current().state.driver(play->driver).adrenaline, before);
		}

		TEST_F(Battle, EscapePutsAKeyDragBackAndPlaysNothing) {
			open(1);
			const std::optional<PlayCard> play = oneDropAtARaider();
			ASSERT_TRUE(play);
			const rules::BattleState before = scene().current().state;
			find(handId(*play))->focus();
			frame();
			key(foundation::Key::Enter);
			ASSERT_NE(scene().ui().drag(), nullptr);
			key(foundation::Key::Escape);
			EXPECT_EQ(scene().ui().drag(), nullptr);
			EXPECT_EQ(scene().current().state, before);
		}

		TEST_F(Battle, ACardDroppedOnASlotMovesTheVehicleThere) {
			open(1, {"juke"});
			const auto juke = std::ranges::find_if(scene().actions(), [](const rules::Action& action) {
				const auto* play = std::get_if<PlayCard>(&action);
				return play != nullptr && play->driver.value == 0 && play->handIndex == 0 && play->destination;
			});
			ASSERT_NE(juke, scene().actions().end()) << "Juke has nowhere to go";
			const PlayCard		  play = std::get<PlayCard>(*juke);
			const rules::RoadSlot to = *play.destination;
			ASSERT_TRUE(drag("hand_0_0", slotId(to)));
			const rules::VehicleIndex moved = *rules::vehicleCarrying(scene().current().state, play.driver);
			EXPECT_EQ(scene().current().state.vehicle(moved).slot, to);
			auto* road = dynamic_cast<road::RoadView*>(find("road"));
			ASSERT_NE(road, nullptr);
			EXPECT_TRUE(road->moving()) << "the token swerves there";
			for (int index = 0; index < 10; ++index) {
				frame(0.1);
			}
			EXPECT_FALSE(road->moving());
		}

		TEST_F(Battle, ATwoStepPlayWaitsOnTheRoadForItsSecondPick) {
			open(1, {"strafe", "strafe"});
			const auto strafe = std::ranges::find_if(scene().actions(), [](const rules::Action& action) {
				const auto* play = std::get_if<PlayCard>(&action);
				return play != nullptr && play->driver.value == 0 && play->handIndex == 0 && play->destination && play->target;
			});
			ASSERT_NE(strafe, scene().actions().end()) << "Strafe has no slot that puts a raider in reach";
			const PlayCard play = std::get<PlayCard>(*strafe);
			const int	   before = scene().current().state.driver(play.driver).adrenaline;

			// The slot first, then the card waits for its raider; Escape puts it back.
			ASSERT_TRUE(drag("hand_0_0", slotId(*play.destination)));
			ASSERT_TRUE(scene().aiming());
			EXPECT_EQ(scene().current().state.driver(play.driver).adrenaline, before);
			key(foundation::Key::Escape);
			EXPECT_FALSE(scene().aiming());
			EXPECT_EQ(find("pick_vehicle_" + std::to_string(play.target->value)), nullptr);

			ASSERT_TRUE(drag("hand_0_0", slotId(*play.destination)));
			ASSERT_TRUE(scene().aiming());
			EXPECT_EQ(lintAt(1280, 800) + lintAt(1440, 900) + lintAt(1920, 1080), "") << "waiting for the raider";
			ASSERT_TRUE(scene().aiming()) << "a resize keeps the card waiting";
			ASSERT_TRUE(press("pick_vehicle_" + std::to_string(play.target->value)));
			EXPECT_FALSE(scene().aiming());
			EXPECT_LT(scene().current().state.driver(play.driver).adrenaline, before);
			const rules::VehicleIndex moved = *rules::vehicleCarrying(scene().current().state, play.driver);
			EXPECT_EQ(scene().current().state.vehicle(moved).slot, *play.destination);
		}

		TEST_F(Battle, EndingTheTurnPlaysTheRaidersBackBeatByBeatThenSettles) {
			const uint32_t seed = hurtingSeed();
			ASSERT_NE(seed, 0U) << "no seed under 20 has the raiders hurt the convoy on their first turn";
			BattleScene&			 battle = open(seed);
			const rules::BattleState before = battle.current().state;
			ASSERT_TRUE(press("end_turn"));

			// The rules have played the whole turn, but the screen hasn't: the dock is locked and the convoy unhurt.
			ASSERT_TRUE(battle.playing());
			EXPECT_EQ(battle.current().state.turn, before.turn + 1);
			EXPECT_EQ(convoyStanding(battle.shown()), convoyStanding(before));
			auto* dock = dynamic_cast<battle::Dock*>(find("dock"));
			ASSERT_NE(dock, nullptr);
			EXPECT_TRUE(dock->locked());

			// Nothing lands before the lead-in; the convoy goes down in steps after it, and the screen settles on the fight.
			double seconds = 0.0;
			int	   steps = 0;
			int	   standing = convoyStanding(battle.shown());
			while (battle.playing() && seconds < 10.0) {
				frame(0.05);
				seconds += 0.05;
				const int now = convoyStanding(battle.shown());
				if (now != standing) {
					EXPECT_GE(seconds, battle::kEnemyLeadIn - 0.06) << "a hit landed before the raiders' lead-in";
					EXPECT_LT(now, standing);
					++steps;
					standing = now;
				}
			}
			EXPECT_FALSE(battle.playing());
			EXPECT_GE(steps, 1);
			EXPECT_EQ(convoyStanding(battle.shown()), convoyStanding(battle.current().state));
			EXPECT_FALSE(dock->locked());
			EXPECT_TRUE(enabled("end_turn"));
		}

		TEST_F(Battle, AFightPlayedOutLeavesForTheRun) {
			open(1);
			scene().playOut();
			frame();
			ASSERT_TRUE(scene().current().state.outcome);
			ASSERT_TRUE(press("leave"));
			ASSERT_TRUE(left);
			EXPECT_EQ(left->state.phase, rules::Phase::Over);
		}

		TEST_F(Battle, TheSceneLintsZeroAtThreeSizes) {
			open(1);
			const auto three = [this] {
				return lintAt(1280, 800) + lintAt(1440, 900) + lintAt(1920, 1080);
			};
			EXPECT_EQ(three(), "") << "planning";
			key(foundation::Key::L);
			EXPECT_EQ(three(), "") << "with the log open";
			key(foundation::Key::L);
			ASSERT_TRUE(press("end_turn"));
			EXPECT_EQ(three(), "") << "the raiders' turn";
			settle();
			scene().playOut();
			frame();
			EXPECT_EQ(three(), "") << "the fight over";
		}

	} // namespace
} // namespace game::testing
