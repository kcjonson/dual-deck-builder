#pragma once

// The reduced-motion choice: System follows the OS preference, Reduced and Full force it. The App keeps only the
// resolved flag (ui.reducedMotion); the choice itself is the game's, under motion.

#include <application/App.h>

namespace game {

	enum class MotionSetting { System, Reduced, Full };

	// What the choice asks of the App. salal has no way to read the OS preference, so System resolves to Full.
	[[nodiscard]] bool reducesMotion(MotionSetting setting);

	// The saved choice. Without one, a file from before the choice existed holds only the App's on/off flag: on is
	// Reduced, off is System. An unrecognised value reads as System.
	[[nodiscard]] MotionSetting savedMotion(app::App& app);

	// Records the choice and applies what it resolves to.
	void chooseMotion(app::App& app, MotionSetting setting);

} // namespace game
