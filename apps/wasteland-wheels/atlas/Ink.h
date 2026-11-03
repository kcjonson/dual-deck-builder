#pragma once

// What the atlas prints with that salal's Primitives don't have whole: the map's glyphs (the circled number, the
// stronghold diamond), icons drawn in a component's own render, text at a point in one of the game's faces with its
// paper halo, and the atlas's dash patterns. Each draws in the space it's called in, at the key it's given.

#include <graphics/Color.h>
#include <graphics/PrimitiveStyles.h>
#include <graphics/Rect.h>
#include <math/Types.h>
#include <primitives/FontFamily.h>

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace ui {
	class Context;
}

namespace game::atlas {

	[[nodiscard]] Foundation::Color withAlpha(Foundation::Color color, float alpha);

	// The staked string round an unbuilt plot, a disabled control's border, and a contents row's dotted leaders.
	inline constexpr Foundation::DashPattern kStringDash{.dash = 6.0F, .gap = 4.0F};
	inline constexpr Foundation::DashPattern kDisabledDash{.dash = 6.0F, .gap = 4.0F};
	inline constexpr Foundation::DashPattern kLeaderDots{.dash = 0.0F, .gap = 4.0F, .cap = Foundation::DashCap::Round};

	// The paper halo a label on art prints in (UI Art Direction, Type): the paper colour round the glyphs, no offset.
	[[nodiscard]] Foundation::BoxShadow paperHalo(Foundation::Color paper);

	// An icon from the scene's icon atlases, `size` px square at `topLeft`.
	void drawIcon(ui::Context& context, std::string_view name, Foundation::Vec2 topLeft, float size, Foundation::Color color, int32_t key);

	// The map's circled number: white, an ink ring, the number in display bold.
	void drawCircled(Foundation::Vec2 centre, float radius, const std::string& text, Foundation::Color ink, int32_t key);

	// The stronghold diamond, `size` px across its points.
	void drawDiamond(Foundation::Vec2 centre, float size, Foundation::Color color, int32_t key);

	struct Print {
		std::string							 text;
		Foundation::Vec2					 position; // the top left, or the box's when it has one
		Renderer::FontFamily				 face;
		float								 size = 16.0F; // px
		Foundation::Color					 color;
		float								 letterSpacing = 0.0F;
		Foundation::HorizontalAlign			 align = Foundation::HorizontalAlign::Left;
		float								 boxWidth = 0.0F;
		std::optional<Foundation::BoxShadow> halo;
		int32_t								 key = 0;
	};

	void print(const Print& text);

	// How wide `text` prints at `size` px in `face`.
	[[nodiscard]] float printedWidth(const std::string& text, Renderer::FontFamily face, float size, float letterSpacing = 0.0F);

} // namespace game::atlas
