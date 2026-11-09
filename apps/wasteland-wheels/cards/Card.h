#pragma once

// A play card (Game Flow 7.0): one component in two sizes, its look in CardStyle.h. The face, 128 by 180, has the cost
// hex hanging off its top-left corner, the type and seat mark, the name (16 px, shrunk to 14, then cut), the art, three
// lines of 12 px summary with its keywords marked, and a foot with the rarity gem, its name and the range. The mini,
// 80 by 112, drops the summary, takes the name on two lines, and shows copies of one card as one stack with up to two
// edges behind it and a count ("x5"), and a state: borrowed for this run (dashed frame, "+1"), left at home (faded,
// HOME), an escort's locked card (LOCKED), or unavailable (faded; the reason is the consumer's to say). The hex, the
// stack, its count and the tag are the card's own draws past its box, its ink (mini-card.md).
//
// Hover opens the detail view beside it after the tooltip delay, keyboard focus at once; a secondary click or I pins it
// open, and again, or Escape, lets it go. A press is its onPress; with none, an activate passes on to whatever holds the
// card, so a drag source picks it up. Unaffordable dims it through colours, its cost dark red; blocked dims it too, with a
// strip across its art saying why.

#include "cards/CardInk.h"
#include "cards/CardStyle.h"

#include <ui/Overlay.h>
#include <ui/components/Control.h>

#include <rules/core/Card.h>

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace game::cards {

	enum class CardSize : uint8_t { Face, Mini };
	enum class MiniState : uint8_t { None, Borrowed, Home, Locked, Unavailable };

	class Card : public ui::Control {
	  public:
		struct Args {
			UI_COMMON_ARGS
			const rules::CardDefinition* card = nullptr;
			bool						 upgraded = false;
			CardSize					 cardSize = CardSize::Face;
			std::optional<int>			 seat; // the driver whose card it is, 0 or 1; none for nobody's
			int							 copies = 1;
			MiniState					 state = MiniState::None;
			bool						 unaffordable = false;
			std::optional<std::string>	 blocked; // a face's strip: NO ATTACKS, NO TARGET, CAN'T PLAY
			bool						 selected = false;
			bool						 inspectable = true;
			std::function<void()>		 onPress;
		};

		explicit Card(const Args& args);

		[[nodiscard]] static Foundation::Vec2 sizeOf(CardSize cardSize);

		[[nodiscard]] const rules::CardDefinition& definition() const { return *card; }
		// The name as it draws: a face's shrunk and cut to its slot, a mini's on its two lines.
		[[nodiscard]] const std::vector<std::string>& nameLines() const { return name; }
		[[nodiscard]] float							  nameSize() const { return nameFontSize; }
		// The face's summary lines at its width, which the card data check holds to three; 0 with no fonts loaded.
		[[nodiscard]] int  summaryLines() const { return summary.lines; }
		[[nodiscard]] bool faded() const;
		[[nodiscard]] bool isPinned() const { return pinnedView.get() != nullptr; }
		void			   setPinned(bool pinned);
		// A hand's card stays the same element while its driver's adrenaline and the road change what it can do.
		void setUnaffordable(bool value) { unaffordable = value; }
		void setBlocked(std::optional<std::string> value) { blocked = std::move(value); }

		[[nodiscard]] const char* typeName() const override { return "Card"; }
		[[nodiscard]] float		  inkExtent() const override;
		void					  describe(nlohmann::json& node) const override;

	  protected:
		void onMount() override;
		void render() override;
		void onInteractionChanged(const ui::InteractionState& previous) override;
		void activate() override;
		void handlePointer(ui::PointerEvent& event) override;
		void handleKey(ui::KeyEvent& event) override;

	  private:
		[[nodiscard]] ui::Ref<ui::Component> openView(ui::OverlayKind kind);
		void								 renderFace(int32_t key);
		void								 renderMini(int32_t key);
		void								 renderStack(int32_t key);
		void								 renderTag(int32_t key);
		void								 renderOutline(int32_t key, float radius);
		[[nodiscard]] Foundation::Color		 restingFrame() const;

		const rules::CardDefinition* card;
		bool						 upgraded;
		CardSize					 cardSize;
		std::optional<int>			 seat;
		int							 copies;
		MiniState					 state;
		bool						 unaffordable;
		std::optional<std::string>	 blocked;
		bool						 selected;
		bool						 inspectable;
		std::function<void()>		 onPress;

		std::vector<std::string> name;
		float					 nameFontSize = 0.0F;
		WordFlow				 summary;

		ui::Ref<ui::Component> focusView;
		ui::Ref<ui::Component> pinnedView;
	};

} // namespace game::cards
