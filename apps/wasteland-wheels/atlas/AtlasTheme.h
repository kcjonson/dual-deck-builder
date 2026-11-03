#pragma once

// The atlas theme (UI Art Direction, Tokens): tokens/atlas.tokens.json over ui's own, the font roles on the game's faces.
// A meta scene opts into it (GameScene::sceneTheme); a scene that doesn't keeps ui's.

#include <ui/theme/Theme.h>

namespace game::atlas {

	[[nodiscard]] const ui::Theme& theme();

} // namespace game::atlas
