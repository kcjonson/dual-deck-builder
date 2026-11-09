#pragma once

// The game's theme (tokens/game.resolver.json) over ui's own, with ui's font roles on the game's faces, in either of its
// modes: the atlas (UI Art Direction, Tokens), which the meta scenes opt into (GameScene::sceneTheme), and dark
// (theme-tokens.md), which the battle scene keeps until combat gets its own pass.

#include <ui/theme/Theme.h>

namespace game::atlas {

	[[nodiscard]] const ui::Theme& theme();
	[[nodiscard]] const ui::Theme& darkTheme();

} // namespace game::atlas
