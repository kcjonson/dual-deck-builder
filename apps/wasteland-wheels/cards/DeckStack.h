#pragma once

// A deck set down as a physical object (UI Art Direction, Card hints): its top card's back with three or four card
// edges under it and the sheet's drop shadow, squared up as a stack or fanned out from the bottom-left corner. It's as
// wide as its box and 7/5 that tall, the top card filling it; the cards under it run past the box. W1, deck A orange
// and B teal. Decoration: never over a reading window or a control.

#include <ui/Component.h>

#include <optional>

namespace game::cards {

	enum class DeckLay : uint8_t { Stack, Fan };

	class DeckStack : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			int		seat = 0; // deck A or B
			float	width = 100.0F;
			int		under = 3; // the cards under the top one
			DeckLay lay = DeckLay::Stack;
		};

		explicit DeckStack(const Args& args);

		[[nodiscard]] int		  seat() const { return deck; }
		[[nodiscard]] const char* typeName() const override { return "DeckStack"; }
		[[nodiscard]] float		  inkExtent() const override;
		void					  describe(nlohmann::json& node) const override;

	  protected:
		void										  onMount() override;
		void										  render() override;
		[[nodiscard]] ui::PointerEvents				  defaultPointerEvents() const override { return ui::PointerEvents::None; }
		[[nodiscard]] std::optional<Foundation::Vec2> intrinsicSize(std::optional<float> width, float availableWidth) const override;

	  private:
		int		deck;
		float	width;
		int		under;
		DeckLay lay;
	};

} // namespace game::cards
