#include "Fonts.h"

#include <utils/Log.h>

#include <utility>

namespace game::fonts {

	namespace {

		// A font is one weight, so the display role is two families under one name, and a style's fontWeight picks the face:
		// ui's display typography at 700 draws the bold, its title at 600 the semibold.
		constexpr std::array<ui::FontFamilyName, 4> kNames{{
			{.name = "display", .family = kDisplaySemibold, .weight = 600.0F},
			{.name = "display", .family = kDisplayBold, .weight = 700.0F},
			{.name = "body", .family = kBody, .weight = 400.0F},
			{.name = "mono", .family = kMono, .weight = 400.0F},
		}};

	} // namespace

	std::span<const ui::FontFamilyName> familyNames() {
		return kNames;
	}

	const ui::Theme& theme() {
		static const ui::Theme kTheme = [] {
			ui::ThemeLoad load = ui::Theme::load({.fontFamilies = kNames});
			for (const ui::dtcg::Diagnostic& diagnostic : load.diagnostics) {
				LOG_ERROR(Game, "The scenes' theme: %s", diagnostic.text().c_str());
			}
			return std::move(load.theme);
		}();
		return kTheme;
	}

} // namespace game::fonts
