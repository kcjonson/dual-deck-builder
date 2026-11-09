#include "atlas/AtlasTheme.h"

#include "Fonts.h"
#include "atlas/Tokens.h"

#include <utils/Log.h>

#include <utility>

namespace game::atlas {

	namespace {

		ui::Theme load(const char* mode) {
			ui::ThemeLoad load =
				ui::Theme::load({.tokens = &tokenTable(), .inputs = {{"theme", mode}}, .fontFamilies = fonts::familyNames()});
			for (const ui::dtcg::Diagnostic& diagnostic : load.diagnostics) {
				LOG_ERROR(Game, "The game's theme, %s: %s", mode, diagnostic.text().c_str());
			}
			return std::move(load.theme);
		}

	} // namespace

	const ui::Theme& theme() {
		static const ui::Theme kTheme = load("atlas");
		return kTheme;
	}

	const ui::Theme& darkTheme() {
		static const ui::Theme kTheme = load("dark");
		return kTheme;
	}

} // namespace game::atlas
