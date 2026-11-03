#include "atlas/AtlasTheme.h"

#include "Fonts.h"
#include "atlas/Tokens.h"

#include <utils/Log.h>

#include <utility>

namespace game::atlas {

	const ui::Theme& theme() {
		static const ui::Theme kTheme = [] {
			ui::ThemeLoad load = ui::Theme::load({.tokens = &tokenTable(), .fontFamilies = fonts::familyNames()});
			for (const ui::dtcg::Diagnostic& diagnostic : load.diagnostics) {
				LOG_ERROR(Game, "The atlas theme: %s", diagnostic.text().c_str());
			}
			return std::move(load.theme);
		}();
		return kTheme;
	}

} // namespace game::atlas
