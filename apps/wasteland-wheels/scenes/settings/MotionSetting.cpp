#include "scenes/settings/MotionSetting.h"

#include <string>

namespace game {

	namespace {
		constexpr const char* kMotionKey = "game.motion";
	}

	bool reducesMotion(MotionSetting setting) {
		return setting == MotionSetting::Reduced;
	}

	MotionSetting savedMotion(app::App& app) {
		if (!app.settings().contains(kMotionKey)) {
			return app.reducedMotion() ? MotionSetting::Reduced : MotionSetting::System;
		}
		const std::string saved = app.settings().get<std::string>(kMotionKey, "system");
		if (saved == "reduced") {
			return MotionSetting::Reduced;
		}
		return saved == "full" ? MotionSetting::Full : MotionSetting::System;
	}

	void chooseMotion(app::App& app, MotionSetting setting) {
		const char* name = setting == MotionSetting::Reduced ? "reduced" : setting == MotionSetting::Full ? "full" : "system";
		app.settings().set<std::string>(kMotionKey, name);
		app.setReducedMotion(reducesMotion(setting));
	}

} // namespace game
