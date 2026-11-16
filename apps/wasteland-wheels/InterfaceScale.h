#pragma once

// The numbers of Interface Scaling, which the game and its tests both run through: a ui px is a pixel on a 1920 x 1080
// screen, the scale never under 2/3, the player's interface size 80 to 120%, every scene in a frame of at most
// 2600 x 1440, and a window of at least 1280 x 720 device pixels, which is what keeps the floor at 2/3.

#include <application/AppConfig.h>

namespace game {

	inline constexpr int kMinWindowWidth = 1280;
	inline constexpr int kMinWindowHeight = 720;

	[[nodiscard]] constexpr app::UiScaleConfig uiScaleConfig() {
		return {
			.referenceWidth = 1920,
			.referenceHeight = 1080,
			.floor = 2.0F / 3.0F,
			.minFactor = 0.8F,
			.maxFactor = 1.2F,
			.frameWidth = 2600.0F,
			.frameHeight = 1440.0F,
		};
	}

} // namespace game
