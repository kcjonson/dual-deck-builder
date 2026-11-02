#include "Fonts.h"

#include <utils/Log.h>

#include <utility>

namespace game::fonts {

	namespace {

		// ui's display typography is 700 and its title 600, both on the display role, and a family is one weight: the role
		// is the semibold face panel and dialog titles ask for, and a page's title takes the bold face itself (SceneKit).
		// The atlas theme names the bold face as display-bold.
		constexpr std::array<ui::FontFamilyName, 4> kNames{{
			{.name = "display", .family = kDisplaySemibold},
			{.name = "display-bold", .family = kDisplayBold},
			{.name = "body", .family = kBody},
			{.name = "mono", .family = kMono},
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
