#pragma once

// A driver's card back (UI Art Direction, Card hints): atlas stock at 5:7 with 7 px corners, W1 paper through the paper
// hook with an ink edge; a band in the driver's colour on its casing (Highway for deck A, Route teal for deck B); a paper
// panel inside it with a fine rule and faint contour lines; and the small mark, the painted W in its shield, at the
// centre, drawn from art/mark-small.svg and recoloured to the deck's. It's as wide as its box and 7/5 that tall; the
// corners and the rule scale with it. Decoration.

#include "atlas/Paper.h"

#include <ui/Component.h>

#include <optional>

namespace game::cards {

	class CardBack : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			int	  seat = 0; // deck A or B
			float width = 100.0F;
		};

		explicit CardBack(const Args& args);

		[[nodiscard]] static float heightFor(float width);
		// Whether the small mark loaded; it's logged once if it didn't.
		[[nodiscard]] static bool markLoaded();

		[[nodiscard]] int		  seat() const { return deck; }
		[[nodiscard]] const char* typeName() const override { return "CardBack"; }
		void					  describe(nlohmann::json& node) const override;

	  protected:
		void										  render() override;
		[[nodiscard]] ui::PointerEvents				  defaultPointerEvents() const override { return ui::PointerEvents::None; }
		[[nodiscard]] std::optional<Foundation::Vec2> intrinsicSize(std::optional<float> width, float availableWidth) const override;

	  private:
		int				 deck;
		float			 width;
		atlas::PaperLook look;
	};

} // namespace game::cards
