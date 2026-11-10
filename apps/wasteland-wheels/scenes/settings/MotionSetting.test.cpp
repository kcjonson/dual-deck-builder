// The reduced-motion choice: its default, what each choice resolves to, and the on/off value older settings files hold.

#include "scenes/settings/MotionSetting.h"
#include "GameTesting.h"

#include <ui/components/SegmentedControl.h>

#include <fstream>

namespace {

	using namespace game;
	using namespace game::testing;

	class Motion : public GameTest {
	  protected:
		void writeSettings(const nlohmann::json& contents) { std::ofstream(dir.path() / "settings.json") << contents.dump(); }

		void choose(int index) {
			auto* control = dynamic_cast<ui::SegmentedControl*>(find("motion"));
			ASSERT_NE(control, nullptr);
			control->choose(index);
		}
	};

	TEST_F(Motion, EachChoiceResolvesToWhatTheAppIsToldAndSystemFallsBackToFull) {
		EXPECT_TRUE(reducesMotion(MotionSetting::Reduced));
		EXPECT_FALSE(reducesMotion(MotionSetting::Full));
		EXPECT_FALSE(reducesMotion(MotionSetting::System)) << "salal can't read the OS preference, so System plays full motion";
	}

	TEST_F(Motion, SystemIsTheDefault) {
		start();
		EXPECT_EQ(savedMotion(*app), MotionSetting::System);
		go(scenes::kSettings);
		EXPECT_EQ(state()["motion"], static_cast<int>(MotionSetting::System));
		EXPECT_FALSE(app->reducedMotion());
	}

	TEST_F(Motion, EachChoiceIsAppliedSavedAndComesBack) {
		start();
		go(scenes::kSettings);
		choose(static_cast<int>(MotionSetting::Reduced));
		EXPECT_TRUE(app->reducedMotion());
		EXPECT_EQ(nlohmann::json::parse(std::ifstream(dir.path() / "settings.json"))["game"]["motion"], "reduced");
		choose(static_cast<int>(MotionSetting::Full));
		EXPECT_FALSE(app->reducedMotion());
		EXPECT_EQ(savedMotion(*app), MotionSetting::Full);
		choose(static_cast<int>(MotionSetting::System));
		EXPECT_FALSE(app->reducedMotion());
		EXPECT_EQ(savedMotion(*app), MotionSetting::System);

		choose(static_cast<int>(MotionSetting::Full));
		app.reset();
		start();
		EXPECT_EQ(savedMotion(*app), MotionSetting::Full);
		EXPECT_FALSE(app->reducedMotion());
	}

	TEST_F(Motion, AnOldOnValueLoadsAsReducedAndAnOldOffValueAsSystem) {
		writeSettings({{"ui", {{"reducedMotion", true}}}});
		start();
		EXPECT_EQ(savedMotion(*app), MotionSetting::Reduced);
		EXPECT_TRUE(app->reducedMotion());
		go(scenes::kSettings);
		EXPECT_EQ(state()["motion"], static_cast<int>(MotionSetting::Reduced));

		app.reset();
		writeSettings({{"ui", {{"reducedMotion", false}}}});
		start();
		EXPECT_EQ(savedMotion(*app), MotionSetting::System);
		EXPECT_FALSE(app->reducedMotion());
	}

	TEST_F(Motion, TheSettingsSceneLintsCleanAtEachWindowSize) {
		start(fixtureMakers(), true);
		go(scenes::kSettings);
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
	}

} // namespace
