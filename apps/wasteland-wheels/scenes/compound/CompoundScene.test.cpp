// The compound in the atlas: its sheet, tape and icons load, it lints 0 at the sizes the game opens at, and a building
// chosen on the plate fills its box.

#include "GameTesting.h"
#include "atlas/Sheet.h"

#include <ui/debug/LayoutLint.h>
#include <ui/shapes/Text.h>

#include <sstream>
#include <string>

namespace {

	using namespace game;
	using namespace game::testing;

	class Compound : public GameTest {
	  protected:
		void found() {
			go(scenes::kMainMenu);
			ASSERT_TRUE(press("new_campaign"));
			ASSERT_TRUE(frameUntil([this] { return top() == scenes::kCompound; }));
		}

		[[nodiscard]] std::string lintAt(int width, int height) {
			platform->resize(width, height);
			frame();
			frame();
			const ui::LintResult result = ui::lint(app->scenes().top()->ui(), {static_cast<float>(width), static_cast<float>(height)});
			std::ostringstream	 found;
			for (const ui::LintViolation& violation : result.violations) {
				const Foundation::Rect& box = violation.bounds;
				found << ui::lintRuleName(violation.rule) << " " << violation.path << " at " << box.x << "," << box.y << " " << box.width
					  << "x" << box.height << (violation.otherPath.empty() ? "" : " against " + violation.otherPath) << "\n";
			}
			return found.str();
		}

		[[nodiscard]] std::string textOf(std::string_view id) {
			const auto* text = dynamic_cast<const ui::Text*>(find(id));
			return text != nullptr ? text->getText() : "";
		}
	};

	TEST_F(Compound, ItDrawsOnTheSheetWithItsTapeAndIconsAndLintsZero) {
		start(fixtureMakers(), true);
		found();
		ASSERT_NE(find("sheet"), nullptr);
		EXPECT_TRUE(atlas::Sheet::tapeLoaded());
		for (const char* icon : {"food", "water", "fuel", "scrap", "meds", "people", "deck-a", "deck-b", "shield-mark"}) {
			EXPECT_TRUE(app->scenes().top()->ui().icons().has(icon)) << icon;
		}
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
	}

	TEST_F(Compound, ABuildingChosenOnThePlateFillsItsBox) {
		start(fixtureMakers(), true);
		found();
		EXPECT_EQ(textOf("building_name"), "Bunkhouse");
		ASSERT_TRUE(press("plot_radio_mast"));
		EXPECT_EQ(state()["selected"], "Radio mast");
		EXPECT_EQ(textOf("building_name"), "Radio mast");
		EXPECT_EQ(textOf("building_reason"), "The radio mast isn't built yet.");
		EXPECT_EQ(lintAt(1280, 800), "");
	}

} // namespace
