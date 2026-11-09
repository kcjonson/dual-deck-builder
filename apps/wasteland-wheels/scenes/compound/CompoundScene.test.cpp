// The compound in the atlas: its sheet, tape and icons load, it lints 0 at the sizes the game opens at, and a building
// chosen on the plate fills its box.

#include "GameTesting.h"
#include "atlas/Sheet.h"

#include <ui/shapes/Text.h>

#include <string>
#include <utility>

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

	TEST_F(Compound, ALongLogShowsWhatFitsAboveThePlanButton) {
		start(fixtureMakers(), true);
		found();
		for (int day = 1; day <= 5; ++day) {
			played().log.push_back(
				{.day = day,
				 .text = "A run came home with 6 food, 4 water, Berserker, and Tail Gunner, and the long tail of everything else the road "
						 "had to say about it on day " +
						 std::to_string(day)}
			);
		}
		go(scenes::kMainMenu);
		go(scenes::kCompound);
		for (const auto [width, height] : {std::pair{1280, 800}, std::pair{1440, 900}, std::pair{1920, 1080}}) {
			EXPECT_EQ(lintAt(width, height), "") << width << "x" << height;
			for (int settle = 0; settle < 6; ++settle) {
				frame();
			}
			const ui::Component* box = find("log");
			const ui::Component* plan = find("plan_run");
			ASSERT_NE(plan, nullptr) << width << "x" << height;
			const Foundation::Rect inBox = box != nullptr ? box->screenBounds() : Foundation::Rect{};
			const ui::Component*   column = find("boxes");
			ASSERT_NE(column, nullptr) << width << "x" << height;
			const Foundation::Rect visibleColumn = column->screenBounds();
			for (const char* id : {"the_day", "rest", "scavenge", "day_line"}) {
				const ui::Component* part = find(id);
				ASSERT_NE(part, nullptr) << id << " at " << width << "x" << height;
				const Foundation::Rect bounds = part->screenBounds();
				EXPECT_GE(bounds.y, visibleColumn.y) << id << " at " << width << "x" << height;
				EXPECT_LE(bounds.y + bounds.height, visibleColumn.y + visibleColumn.height + 0.5F)
					<< id << " at " << width << "x" << height;
			}
			int visible = 0;
			for (int index = 0; index < 5; ++index) {
				for (const std::string& id : {"log_" + std::to_string(index), "log_" + std::to_string(index) + "_value"}) {
					const ui::Component* part = find(id);
					if (part == nullptr) {
						continue;
					}
					visible += id.ends_with("_value") ? 1 : 0;
					const Foundation::Rect bounds = part->screenBounds();
					EXPECT_GE(bounds.y, inBox.y) << id << " at " << width << "x" << height;
					EXPECT_LE(bounds.y + bounds.height, inBox.y + inBox.height) << id << " at " << width << "x" << height;
					EXPECT_LE(bounds.y + bounds.height, plan->screenBounds().y) << id << " at " << width << "x" << height;
				}
			}
			EXPECT_TRUE(box != nullptr || visible == 0) << width << "x" << height;
			EXPECT_GE(visible, width >= 1920 ? 1 : 0) << width << "x" << height;
		}
	}

} // namespace
