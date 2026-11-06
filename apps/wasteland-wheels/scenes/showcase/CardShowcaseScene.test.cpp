// The card showcase and the card it shows: every card's face holds its summary to three lines and its name to its slot
// (the card data check), the sizes lay out as Game Flow 7.0 has them, the detail view opens on hover and on focus and
// pins and lets go, both backs draw their mark, and the sheet lints 0 at the sizes the game opens at.

#include "GameTesting.h"
#include "Words.h"
#include "cards/Card.h"
#include "cards/CardBack.h"
#include "cards/CardDetail.h"
#include "cards/CardStyle.h"

#include <rules/core/CardText.h>

#include <string>

namespace {

	using namespace game;
	using namespace game::testing;

	class Showcase : public GameTest {
	  protected:
		// From the main menu, as a player gets there.
		void open() {
			start(fixtureMakers(), true);
			go(scenes::kMainMenu);
			ASSERT_TRUE(press("card_showcase"));
			ASSERT_EQ(top(), scenes::kCardShowcase);
		}

		[[nodiscard]] cards::Card* card(std::string_view id) { return dynamic_cast<cards::Card*>(find(id)); }

		void
		pointerAt(std::string_view id, foundation::InputEvent::Type type, foundation::MouseButton button = foundation::MouseButton::Left) {
			const Foundation::Rect box = find(id)->screenBounds();
			platform->push({.type = type, .mouseButton = button, .position = {box.x + box.width * 0.5F, box.y + box.height * 0.5F}});
		}

		void key(foundation::Key pressed) {
			platform->push({.type = foundation::InputEvent::Type::KeyDown, .key = pressed});
			platform->push({.type = foundation::InputEvent::Type::KeyUp, .key = pressed});
			frame();
		}
	};

	TEST_F(Showcase, ItShowsEveryCardAndBothBacksAndLintsZero) {
		open();
		EXPECT_EQ(state()["cards"], testRules().content.cards.size());
		EXPECT_TRUE(cards::CardBack::markLoaded());
		for (const char* id : {"back_a", "back_b", "face_a", "mini_stack", "mini_borrowed", "mini_locked"}) {
			EXPECT_NE(find(id), nullptr) << id;
		}
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
	}

	// The card data check (Card System Design 1.1): a summary past three lines on the face, or a name that has to be cut,
	// is a content bug, fixed by rewriting, never by smaller type.
	TEST_F(Showcase, EveryFaceHoldsItsSummaryToThreeLinesAndItsNameToItsSlot) {
		open();
		for (const auto& [id, definition] : testRules().content.cards) {
			const cards::Card* face = card("faces_" + id.value);
			ASSERT_NE(face, nullptr) << id.value;
			EXPECT_EQ(face->getSize(), cards::face::kSize) << id.value;
			EXPECT_GE(face->summaryLines(), 1) << id.value;
			EXPECT_LE(face->summaryLines(), cards::face::kRulesLines) << id.value << ": " << rules::cardSummary(definition, false);
			ASSERT_EQ(face->nameLines().size(), 1U) << id.value;
			EXPECT_EQ(face->nameLines().front(), definition.name) << id.value << " is cut";
			const cards::Card* mini = card(std::string(nameOf(rules::kRarityNames, definition.rarity)) + "_" + id.value);
			ASSERT_NE(mini, nullptr) << id.value;
			EXPECT_EQ(mini->getSize(), cards::mini::kSize) << id.value;
			EXPECT_LE(mini->nameLines().size(), 2U) << id.value;
			EXPECT_EQ(mini->nameLines().back().find("..."), std::string::npos) << id.value << "'s mini name is cut";
		}
	}

	// Battle Screen Design 5: 250 wide, up to 440 tall with the art giving way first, and the full text inside its budget.
	TEST_F(Showcase, EveryDetailViewFitsItsCap) {
		open();
		for (const auto& [id, definition] : testRules().content.cards) {
			for (const bool upgraded : {false, true}) {
				const cards::CardDetail::Metrics metrics = cards::CardDetail({.card = &definition, .upgraded = upgraded}).measure();
				EXPECT_LE(metrics.height, cards::detail::kMaxHeight) << id.value;
				EXPECT_GE(metrics.art, cards::detail::kArtMin) << id.value;
				EXPECT_LE(metrics.nameLines, cards::detail::kNameLines) << id.value;
				EXPECT_GT(metrics.rulesLines, 0) << id.value;
			}
		}
	}

	TEST_F(Showcase, HoverOpensTheDetailViewBesideTheCardAndASecondaryClickPinsIt) {
		open();
		pointerAt("face_a", foundation::InputEvent::Type::PointerMove);
		// The ui clock takes at most a quarter second a frame; the tooltip waits half a second.
		for (int step = 0; step < 4; ++step) {
			frame(0.2);
		}
		const ui::Component* view = find("face_a_inspect_detail");
		ASSERT_NE(view, nullptr);
		EXPECT_FLOAT_EQ(view->getSize().x, cards::detail::kWidth);
		EXPECT_LE(view->getSize().y, cards::detail::kMaxHeight);
		const Foundation::Rect cardBox = find("face_a")->screenBounds();
		const Foundation::Rect viewBox = view->screenBounds();
		EXPECT_TRUE(viewBox.x >= cardBox.x + cardBox.width || viewBox.x + viewBox.width <= cardBox.x) << "it never covers the card";

		pointerAt("face_a", foundation::InputEvent::Type::PointerDown, foundation::MouseButton::Right);
		pointerAt("face_a", foundation::InputEvent::Type::PointerUp, foundation::MouseButton::Right);
		frame();
		EXPECT_TRUE(card("face_a")->isPinned());
		EXPECT_NE(find("face_a_pinned_detail"), nullptr);
		EXPECT_EQ(lintAt(1280, 800), "");

		pointerAt("face_a", foundation::InputEvent::Type::PointerDown, foundation::MouseButton::Right);
		pointerAt("face_a", foundation::InputEvent::Type::PointerUp, foundation::MouseButton::Right);
		frame();
		EXPECT_FALSE(card("face_a")->isPinned());
		EXPECT_EQ(find("face_a_pinned"), nullptr);
	}

	TEST_F(Showcase, KeyboardFocusOpensItAtOnceAndIPinsIt) {
		open();
		// Any key puts the ui in keyboard mode, where focus shows its ring.
		key(foundation::Key::LeftShift);
		ASSERT_TRUE(card("face_b")->focus());
		frame();
		EXPECT_NE(find("face_b_inspect_detail"), nullptr);
		// Driver 2's keyword boxes sit on the detail view's left.
		const ui::Component* boxes = find("face_b_inspect_keywords");
		ASSERT_NE(boxes, nullptr);
		EXPECT_LT(boxes->screenBounds().x, find("face_b_inspect_detail")->screenBounds().x);
		EXPECT_LE(boxes->getChildren().size(), static_cast<size_t>(cards::detail::kKeywordMax));

		key(foundation::Key::I);
		EXPECT_TRUE(card("face_b")->isPinned());
		EXPECT_EQ(find("face_b_inspect"), nullptr) << "one view at a time";
		key(foundation::Key::Escape);
		EXPECT_FALSE(card("face_b")->isPinned());
	}

	TEST_F(Showcase, PageDownScrollsTheCardsAndEscapeGoesBackToTheMenu) {
		open();
		key(foundation::Key::PageDown);
		EXPECT_GT(find("showcase")->getScroll().y, 0.0F);
		key(foundation::Key::PageUp);
		EXPECT_EQ(find("showcase")->getScroll().y, 0.0F);
		key(foundation::Key::Escape);
		EXPECT_EQ(top(), scenes::kMainMenu);
	}

	// A mini's hex, tag, stack and count reach at most its ink past its box, and grids leave twice that between cards.
	TEST_F(Showcase, AMiniDrawsNoFurtherPastItsBoxThanItsInk) {
		open();
		const float hexReach = -cards::mini::kHexAt.x + cards::mini::kHexSide / 15.0F;
		EXPECT_LE(hexReach, cards::mini::kInk);
		EXPECT_LE(cards::mini::kTagRight - cards::mini::kSize.x, cards::mini::kInk);
		EXPECT_LE(cards::mini::kTagHeight * 0.5F, cards::mini::kInk);
		EXPECT_LE(cards::mini::kStackStep * static_cast<float>(cards::mini::kStackEdges), cards::mini::kInk);
		EXPECT_LE(cards::mini::kCountHeight * 0.5F, cards::mini::kInk);
		EXPECT_GE(cards::mini::kGridGap, cards::mini::kInk * 2.0F);
		EXPECT_TRUE(card("mini_home")->faded());
		EXPECT_FALSE(card("mini_locked")->faded());
	}

} // namespace
