#pragma once

// The map's markers and counters (UI Art Direction, Components): a circled letter or number for places and numbered
// items, the highway shield for counters (the day, a route number) and the primary row, the stronghold diamond for
// anything hostile, and the star for home. Each is flat vector drawn where it's asked for; Marker is one as a component,
// as tall as its `extent`, the shield 40:49 and the rest square. Decoration: the pointer passes through.

#include <graphics/Color.h>
#include <math/Types.h>
#include <ui/Component.h>

#include <cstdint>
#include <optional>
#include <span>
#include <string>

namespace game::atlas {

	// The shield's outline from the canvas (M3 7 Q23 0 43 7 L43 26 Q43 42 23 49 Q3 42 3 26 Z), in a 1 by 1 box.
	[[nodiscard]] std::span<const Foundation::Vec2> shieldOutline();
	inline constexpr float							kShieldAspect = 40.0F / 49.0F; // its width over its height

	struct ShieldDraw {
		Foundation::Vec2				 topLeft;
		float							 height = 24.0F;
		Foundation::Color				 fill;
		std::optional<Foundation::Color> edge;
		float							 edgeWidth = 0.0F;
		int32_t							 key = 0;
	};

	void drawShield(const ShieldDraw& shield);

	// A five-pointed star, `radius` to its points, the inner points at the map's ratio.
	void drawStar(Foundation::Vec2 centre, float radius, Foundation::Color fill, std::optional<Foundation::Color> edge, int32_t key);

	enum class MarkerKind : uint8_t { Circled, Shield, Diamond, Star };

	// Highway: the orange shield on its casing with paper figures. Paper: a paper shield in casing ink, for one set on the
	// highway button.
	enum class ShieldTone : uint8_t { Highway, Paper };

	class Marker : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			MarkerKind	kind = MarkerKind::Circled;
			std::string text; // the circled letter or number, or the shield's figures; the shield's arrow when empty
			float		extent = 24.0F;
			ShieldTone	tone = ShieldTone::Highway;
			bool		faded = false; // all in faded print, for a row that can't be taken
		};

		explicit Marker(const Args& args);

		// Its box at `extent` tall: the shield's narrower than tall, the rest square.
		[[nodiscard]] static Foundation::Vec2 boxFor(MarkerKind kind, float extent);

		[[nodiscard]] MarkerKind  kind() const { return markerKind; }
		[[nodiscard]] const char* typeName() const override { return "Marker"; }
		void					  describe(nlohmann::json& node) const override;

	  protected:
		void										  render() override;
		[[nodiscard]] ui::PointerEvents				  defaultPointerEvents() const override { return ui::PointerEvents::None; }
		[[nodiscard]] std::optional<Foundation::Vec2> intrinsicSize(std::optional<float> width, float availableWidth) const override;

	  private:
		MarkerKind	markerKind;
		std::string text;
		float		extent;
		ShieldTone	tone;
		bool		faded;
	};

} // namespace game::atlas
