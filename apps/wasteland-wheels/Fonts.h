#pragma once

// The game's faces (UI Art Direction, Type), msdf-atlas-gen atlases in fonts/ that CMakeLists.txt stages beside the exe,
// each a family of its own, with body the default.

#include <font/FontRenderer.h>
#include <primitives/FontFamily.h>
#include <ui/theme/Theme.h>

#include <array>

namespace game::fonts {

	inline constexpr Renderer::FontFamily kDisplayBold{0};
	inline constexpr Renderer::FontFamily kDisplaySemibold{1};
	inline constexpr Renderer::FontFamily kBody{2};
	inline constexpr Renderer::FontFamily kMono{3};

	inline const std::array<Renderer::FontAtlasSource, 4> kAtlases{{
		{.family = kDisplayBold, .pngPath = "fonts/barlow-condensed-bold.png", .jsonPath = "fonts/barlow-condensed-bold.json"},
		{.family = kDisplaySemibold, .pngPath = "fonts/barlow-condensed-semibold.png", .jsonPath = "fonts/barlow-condensed-semibold.json"},
		{.family = kBody, .pngPath = "fonts/open-sans-regular.png", .jsonPath = "fonts/open-sans-regular.json"},
		{.family = kMono, .pngPath = "fonts/jetbrains-mono-regular.png", .jsonPath = "fonts/jetbrains-mono-regular.json"},
	}};

	// ui's own tokens with its font roles on the game's faces, which every scene's ui loads until salal's App carries a
	// theme (game-app.md, Salal gaps).
	[[nodiscard]] const ui::Theme& theme();

} // namespace game::fonts
