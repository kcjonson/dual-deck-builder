// The dock laid out alone over a test drop target, from real fights: each driver's half and its cards by id, drag
// sources on the playable cards only, a pointer drag and the keys' pick-up delivering the card, hover and focus
// presenting it, End Turn's preview and press, the lock, the fight's end, and the lint at the widths the game opens at.

#include "scenes/battle/Dock.h"
#include "GameTesting.h"
#include "scenes/battle/Targeting.h"

#include <rules/battle/BattleTesting.h>
#include <ui/shapes/Rectangle.h>

#include <any>
#include <initializer_list>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace {

	using namespace game;
	using namespace game::battle;
	using namespace game::testing;
	using namespace rules::fights;
	using foundation::InputEvent;

	const rules::DriverIndex kFirst{0};
	const rules::DriverIndex kSecond{1};

	// The Road Warrior and the Interceptor against the Scav Bike and the Rust Buggy, each driver holding `first` and
	// `second`.
	rules::BattleState duo(std::initializer_list<std::string_view> first, std::initializer_list<std::string_view> second) {
		rules::BattleStart start = fight({seat("road_warrior"), seat("interceptor")}, {raider("scav_bike"), raider("rust_buggy")});
		giveHand(start.state, kFirst, first);
		giveHand(start.state, kSecond, second);
		return std::move(start.state);
	}

	Foundation::Vec2 middleOf(const ui::Component& component) {
		const Foundation::Rect box = component.screenBounds();
		return {box.x + box.width * 0.5F, box.y + box.height * 0.5F};
	}

	class DockTest : public GameTest {
	  protected:
		// The dock across the bottom of the window showing `fight`, under a drop target that takes cards; with `faces`, the
		// game's fonts load so text measures as it draws, for the lint.
		void open(rules::BattleState fight, bool faces = false) {
			start(fixtureMakers(), faces);
			state = std::move(fight);
			legal = rules::legalActions(state, testContent());
			targeting.emplace(state, testContent(), legal);
			openParts([this](ui::Ref<ui::Component> root) {
				root.get()->setLayout(
					{.display = ui::Display::Flex,
					 .flexDirection = ui::FlexDirection::Column,
					 .justifyContent = ui::JustifyContent::SpaceBetween}
				);
				road = root.addChild<ui::Rectangle>({.id = "test_road", .size = {400.0F, 200.0F}});
				road.get()->setDropTarget({
					.accepts = [](const ui::Drag& drag) { return drag.kind == kCardDrag; },
					.onDrop = [this](const ui::Drag& drag) { dropped.push_back(std::any_cast<HandCard>(drag.value)); },
				});
				dock = root.addChild<Dock>({
					.id = "dock",
					.size = {ui::percent(100.0F), 228.0F},
					.onEndTurn = [this] { heard.emplace_back("end turn"); },
					.onEndTurnPreview = [this](bool on) { heard.emplace_back(on ? "preview on" : "preview off"); },
					.onPresented = [this](
									   std::optional<HandCard> card
								   ) { heard.emplace_back(card ? "present " + name(*card) : std::string("present none")); },
					.onDragStart = [this](const HandCard& card) { heard.emplace_back("drag " + name(card)); },
					.onDragEnd =
						[this](const HandCard& card, bool took) { heard.emplace_back((took ? "dropped " : "put back ") + name(card)); },
					.onLeave = [this] { heard.emplace_back("leave"); },
				});
				dock.get()->show(dockPicture(state, testContent(), *targeting, seats));
			});
			frame();
			frame();
			heard.clear();
		}

		[[nodiscard]] static std::string name(const HandCard& card) {
			return std::to_string(card.driver.value) + "_" + std::to_string(card.handIndex);
		}

		[[nodiscard]] HandCard cardOf(rules::DriverIndex driver, std::string_view id) const {
			const std::vector<rules::BattleCard>& hand = state.driver(driver).hand;
			const auto							  found = std::ranges::find(hand, rules::CardId{std::string(id)}, &rules::BattleCard::card);
			EXPECT_NE(found, hand.end()) << id;
			return HandCard{.driver = driver, .handIndex = static_cast<int>(found - hand.begin())};
		}

		[[nodiscard]] static std::string idOf(const HandCard& card) { return "hand_" + name(card); }

		void pointer(InputEvent::Type type, Foundation::Vec2 at) {
			platform->push(
				{.type = type,
				 .device = {.kind = foundation::DeviceKind::Mouse},
				 .mouseButton = foundation::MouseButton::Left,
				 .position = at}
			);
		}

		// A press on `from`, moves along the line past the drag threshold, and the release on `to`.
		void dragAlong(Foundation::Vec2 from, Foundation::Vec2 to) {
			pointer(InputEvent::Type::PointerMove, from);
			pointer(InputEvent::Type::PointerDown, from);
			for (int step = 1; step <= 4; ++step) {
				const float along = static_cast<float>(step) / 4.0F;
				pointer(InputEvent::Type::PointerMove, {from.x + (to.x - from.x) * along, from.y + (to.y - from.y) * along});
			}
			pointer(InputEvent::Type::PointerUp, to);
			frame();
		}

		void key(foundation::Key pressed) {
			platform->push({.type = InputEvent::Type::KeyDown, .key = pressed});
			platform->push({.type = InputEvent::Type::KeyUp, .key = pressed});
			frame();
		}

		[[nodiscard]] ui::Context& uiContext() { return app->scenes().top()->ui(); }

		rules::BattleState			   state;
		std::vector<rules::Action>	   legal;
		std::optional<Targeting>	   targeting;
		const std::vector<std::string> seats{"Road Warrior 1", "Interceptor 1"};
		ui::Ref<ui::Rectangle>		   road;
		ui::Ref<Dock>				   dock;
		std::vector<std::string>	   heard;
		std::vector<HandCard>		   dropped;
	};

	TEST_F(DockTest, EachDriverHasAHalfWithTheirCardsAndTheColumnCountsWhatsLeft) {
		open(duo({"point_blank", "armor_plating", "headshot"}, {"precision_shot", "test_pair"}));
		for (const char* id : {"hand_0_0", "hand_0_1", "hand_0_2", "hand_1_0", "hand_1_1", "dock_tab_0", "dock_tab_1", "end_turn"}) {
			EXPECT_NE(find(id), nullptr) << id;
		}
		EXPECT_EQ(find("hand_0_3"), nullptr);
		EXPECT_EQ(find("leave"), nullptr);
		const DockPicture& shown = dock.get()->picture();
		ASSERT_EQ(shown.halves.size(), 2U);
		EXPECT_EQ(shown.halves[0].name, "Road Warrior 1");
		EXPECT_EQ(shown.halves[1].seat, 1);
		EXPECT_EQ(shown.halves[0].draw, static_cast<int>(state.driver(kFirst).deck.size()));
		EXPECT_EQ(shown.unspent, state.driver(kFirst).adrenaline + state.driver(kSecond).adrenaline);
		EXPECT_TRUE(enabled("end_turn"));
		EXPECT_EQ(shown.halves[1].hand[1].blockLabel, "CAN'T PLAY");
		nlohmann::json described;
		find("hand_1_1")->describe(described);
		EXPECT_EQ(described["blocked"], "CAN'T PLAY");

		// The Interceptor crashed out: their vehicle wrecked with no free seat.
		rules::BattleState crashed = duo({"point_blank"}, {"headshot"});
		crashed.driver(kSecond).crashedOut = true;
		crashed.vehicle(rules::VehicleIndex{1}).driver = std::nullopt;
		crashed.vehicle(rules::VehicleIndex{1}).structure = 0;
		const std::vector<rules::Action> crashedLegal = rules::legalActions(crashed, testContent());
		const Targeting					 judged(crashed, testContent(), crashedLegal);
		const DockPicture				 out = dockPicture(crashed, testContent(), judged, seats);
		EXPECT_EQ(out.halves[1].tag, "CRASHED OUT");
		EXPECT_TRUE(out.halves[1].hand.empty());
		EXPECT_EQ(out.unspent, crashed.driver(kFirst).adrenaline) << "nothing left to spend for a driver out of the fight";
		dock.get()->show(out);
		frame();
		EXPECT_EQ(find("hand_1_0"), nullptr);
		EXPECT_NE(find("dock_note_1"), nullptr);
		EXPECT_NE(find("hand_0_0"), nullptr);
	}

	TEST_F(DockTest, OnlyAPlayableCardIsADragSource) {
		rules::BattleState fight = duo({"point_blank", "precision_shot"}, {"test_pair"});
		fight.driver(kFirst).adrenaline = 1;
		open(std::move(fight));
		const HandCard				playable = cardOf(kFirst, "point_blank");
		const ui::DragSource* const source = find(idOf(playable))->getDragSource();
		ASSERT_NE(source, nullptr);
		EXPECT_EQ(source->kind, kCardDrag);
		EXPECT_EQ(std::any_cast<HandCard>(source->value), playable);
		EXPECT_EQ(find(idOf(cardOf(kFirst, "precision_shot")))->getDragSource(), nullptr) << "it costs 2";
		EXPECT_EQ(find(idOf(cardOf(kSecond, "test_pair")))->getDragSource(), nullptr) << "blocked";
	}

	TEST_F(DockTest, APointerDragDeliversTheCardToATargetThatTakesIt) {
		open(duo({"point_blank", "armor_plating"}, {"headshot"}));
		const HandCard card = cardOf(kFirst, "armor_plating");
		dragAlong(middleOf(*find(idOf(card))), middleOf(*road.get()));
		EXPECT_EQ(dropped, std::vector{card});
		EXPECT_NE(std::ranges::find(heard, "drag 0_1"), heard.end());
		EXPECT_NE(std::ranges::find(heard, "dropped 0_1"), heard.end());
		EXPECT_EQ(uiContext().drag(), nullptr);

		dragAlong(middleOf(*find(idOf(card))), middleOf(*find("end_turn")));
		EXPECT_NE(std::ranges::find(heard, "put back 0_1"), heard.end()) << "End Turn takes no card";
		EXPECT_EQ(dropped.size(), 1U);
	}

	TEST_F(DockTest, TheKeysPickAFocusedCardUpOntoTheNearestTargetAndDropIt) {
		open(duo({"point_blank", "armor_plating"}, {"headshot"}));
		const HandCard card = cardOf(kSecond, "headshot");
		ui::Component* view = find(idOf(card));
		for (int tab = 0; tab < 4 && !view->isFocused(); ++tab) {
			key(foundation::Key::Tab);
		}
		ASSERT_TRUE(view->isFocusVisible());
		ASSERT_FALSE(heard.empty());
		EXPECT_EQ(heard.back(), "present 1_0") << "keyboard focus presents it";
		key(foundation::Key::Enter);
		const ui::Drag* drag = uiContext().drag();
		ASSERT_NE(drag, nullptr);
		EXPECT_EQ(drag->via, ui::DragVia::Keys);
		EXPECT_EQ(drag->target, ui::Ref<ui::Component>(road));
		EXPECT_EQ(dock.get()->picture().halves[1].hand[0].card, card);
		key(foundation::Key::Enter);
		EXPECT_EQ(uiContext().drag(), nullptr);
		EXPECT_EQ(dropped, std::vector{card});
		EXPECT_NE(std::ranges::find(heard, "dropped 1_0"), heard.end());
	}

	TEST_F(DockTest, PointingPresentsAPlayableCardAndEndTurnAsksForItsPreview) {
		rules::BattleState fight = duo({"point_blank", "precision_shot"}, {"headshot"});
		fight.driver(kFirst).adrenaline = 1;
		open(std::move(fight));

		pointer(InputEvent::Type::PointerMove, middleOf(*find(idOf(cardOf(kFirst, "point_blank")))));
		frame();
		pointer(InputEvent::Type::PointerMove, middleOf(*find(idOf(cardOf(kFirst, "precision_shot")))));
		frame();
		pointer(InputEvent::Type::PointerMove, middleOf(*find("end_turn")));
		frame();
		pointer(InputEvent::Type::PointerMove, middleOf(*road.get()));
		frame();
		EXPECT_EQ(heard, (std::vector<std::string>{"present 0_0", "present none", "preview on", "preview off"}))
			<< "the unaffordable card presents nothing";
		ASSERT_TRUE(press("end_turn"));
		EXPECT_NE(std::ranges::find(heard, "end turn"), heard.end());
	}

	TEST_F(DockTest, LockedItTakesNoInputAndEndTurnWaits) {
		open(duo({"point_blank", "armor_plating"}, {"headshot"}));
		dock.get()->setLocked(true);
		frame();
		frame();
		nlohmann::json described;
		find("end_turn")->describe(described);
		EXPECT_EQ(described["label"], "WAIT");
		EXPECT_FALSE(enabled("end_turn"));

		const HandCard card = cardOf(kFirst, "armor_plating");
		ui::Component* view = find(idOf(card));
		EXPECT_EQ(view->getDragSource(), nullptr);
		EXPECT_FALSE(view->focus());
		const Foundation::Vec2 at = middleOf(*view);
		EXPECT_NE(uiContext().find(uiContext().hitTest(at)), view) << "the pointer passes the locked hands by";
		dragAlong(at, middleOf(*road.get()));
		pointer(InputEvent::Type::PointerMove, middleOf(*find("end_turn")));
		pointer(InputEvent::Type::PointerDown, middleOf(*find("end_turn")));
		pointer(InputEvent::Type::PointerUp, middleOf(*find("end_turn")));
		frame();
		key(foundation::Key::Enter);
		EXPECT_TRUE(dropped.empty());
		EXPECT_TRUE(heard.empty()) << heard.front();

		dock.get()->setLocked(false);
		frame();
		EXPECT_TRUE(enabled("end_turn"));
		EXPECT_NE(find(idOf(card))->getDragSource(), nullptr);
		ASSERT_TRUE(press("end_turn"));
		EXPECT_NE(std::ranges::find(heard, "end turn"), heard.end());
	}

	TEST_F(DockTest, OnceTheFightIsOverLeaveTakesEndTurnsPlace) {
		open(duo({"point_blank"}, {"headshot"}));
		DockPicture over = dock.get()->picture();
		over.outcome = "Won";
		over.canEndTurn = false;
		dock.get()->show(over);
		dock.get()->setLocked(true);
		frame();
		frame();
		EXPECT_EQ(find("end_turn"), nullptr);
		ASSERT_TRUE(press("leave"));
		EXPECT_EQ(heard.back(), "leave");
	}

	TEST_F(DockTest, TwoFullHandsLintZeroAtTheGamesWidths) {
		const std::initializer_list<std::string_view> seven{
			"point_blank", "armor_plating", "headshot", "precision_shot", "nitro_boost", "repair_kit", "ramming_speed"
		};
		open(duo(seven, seven), true);
		EXPECT_NE(find("hand_0_6"), nullptr);
		EXPECT_NE(find("hand_1_6"), nullptr);
		EXPECT_EQ(lintAt(1280, 720), "");
		EXPECT_FLOAT_EQ(find("dock")->getSize().y, 228.0F);
		EXPECT_FLOAT_EQ(find("end_turn")->getSize().x, 148.0F);
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
	}

} // namespace
