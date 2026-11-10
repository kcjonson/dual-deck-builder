#pragma once

// The game's faces (UI Art Direction, Type), msdf-atlas-gen atlases in fonts/ under the game's files (GameFiles.h),
// where CMakeLists.txt stages them, each a family of its own, with body the default.

#include <font/FontRenderer.h>
#include <primitives/FontFamily.h>
#include <ui/theme/Theme.h>

#include <span>

namespace game::fonts {

	inline constexpr Renderer::FontFamily kDisplayBold{0};
	inline constexpr Renderer::FontFamily kDisplaySemibold{1};
	inline constexpr Renderer::FontFamily kBody{2};
	inline constexpr Renderer::FontFamily kMono{3};

	// Every face, by its full path, so none is looked for in the working directory. Throws as filesDirectory() does.
	[[nodiscard]] std::span<const Renderer::FontAtlasSource> atlases();

	// The names a tokens file's fontFamily calls the faces by, ui's roles, each face with its weight.
	[[nodiscard]] std::span<const ui::FontFamilyName> familyNames();

	// ui's own tokens with its font roles on the game's faces, which every scene's ui loads until salal's App carries a
	// theme (game-app.md, Salal gaps).
	[[nodiscard]] const ui::Theme& theme();

} // namespace game::fonts
