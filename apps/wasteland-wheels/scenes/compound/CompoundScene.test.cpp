// The compound in the atlas: its sheet, tape and icons load, it lints 0 on every canvas, and a building
// chosen on the plate fills its box.

#include "GameTesting.h"
#include "atlas/Sheet.h"

#include <ui/shapes/Text.h>

#include <cmath>
#include <string>
#include <vector>

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
		EXPECT_EQ(lintCanvases(), "");
	}

	TEST_F(Compound, ABuildingChosenOnThePlateFillsItsBox) {
		start(fixtureMakers(), true);
		found();
		EXPECT_EQ(textOf("building_name"), "Bunkhouse");
		ASSERT_TRUE(press("plot_radio_mast"));
		EXPECT_EQ(state()["selected"], "Radio mast");
		EXPECT_EQ(textOf("building_name"), "Radio mast");
		EXPECT_EQ(textOf("building_reason"), "The radio mast isn't built yet.");
		EXPECT_EQ(lint(), "");
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
		for (const Canvas& canvas : kCanvases) {
			EXPECT_EQ(lintOn(canvas), "") << canvas.name;
			for (int settle = 0; settle < 6; ++settle) {
				frame();
			}
			const ui::Component* box = find("log");
			const ui::Component* plan = find("plan_run");
			ASSERT_NE(plan, nullptr) << canvas.name;
			const Foundation::Rect inBox = box != nullptr ? box->screenBounds() : Foundation::Rect{};
			const ui::Component*   column = find("boxes");
			ASSERT_NE(column, nullptr) << canvas.name;
			const Foundation::Rect visibleColumn = column->screenBounds();
			for (const char* id : {"the_day", "rest", "scavenge", "day_line"}) {
				const ui::Component* part = find(id);
				ASSERT_NE(part, nullptr) << id << " at " << canvas.name;
				const Foundation::Rect bounds = part->screenBounds();
				EXPECT_GE(bounds.y, visibleColumn.y) << id << " at " << canvas.name;
				EXPECT_LE(bounds.y + bounds.height, visibleColumn.y + visibleColumn.height + 0.5F) << id << " at " << canvas.name;
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
					EXPECT_GE(bounds.y, inBox.y) << id << " at " << canvas.name;
					EXPECT_LE(bounds.y + bounds.height, inBox.y + inBox.height) << id << " at " << canvas.name;
					EXPECT_LE(bounds.y + bounds.height, plan->screenBounds().y) << id << " at " << canvas.name;
				}
			}
			EXPECT_TRUE(box != nullptr || visible == 0) << canvas.name;
			// Only the smallest canvas, at 120%, may have no room for an entry.
			EXPECT_GE(visible, canvas.interfaceSize > 1.0F ? 0 : 1) << canvas.name;
		}
		(void)lint();
	}

	// The room the boxes above leave empty between The day and the Plan button, less the column's two gaps.
	// That is what the log's slot is given, and the log must use all of it. The canvas is 1600 ui px across at 120% on a
	// window 1920 wide, and its height follows the window's from 900 up to the frame's 1440. The window alone leaves the
	// slot room for the head and an entry at least; entries that wrap, and injured drivers in Needs above, take the rest.
	class CompoundLogRoom : public Compound {
	  protected:
		static constexpr int kShortest = 900;
		static constexpr int kTallest = 1440;

		void settleAt(int height) {
			app->setUiScale(1.2F);
			platform->resize(1920, static_cast<int>(std::lround(height * 1.2)));
			for (int settle = 0; settle < 4; ++settle) {
				frame();
			}
		}

		[[nodiscard]] float room() {
			const ui::Component* day = find("the_day");
			const ui::Component* plan = find("plan_run");
			if (day == nullptr || plan == nullptr) {
				return -1.0F;
			}
			const Foundation::Rect inDay = day->screenBounds();
			return plan->screenBounds().y - (inDay.y + inDay.height) - 28.0F;
		}

		[[nodiscard]] bool boxShown() {
			const ui::Component* box = find("log");
			return box != nullptr && box->isVisible();
		}

		[[nodiscard]] int logsShown() {
			int shown = 0;
			for (int index = 0; index < 5; ++index) {
				const ui::Component* entry = find("log_" + std::to_string(index));
				shown += entry != nullptr && entry->isVisible() ? 1 : 0;
			}
			return shown;
		}

		// Sets the canvas to the smallest height (room grows with it) that leaves at least wanted px for the log, by bisection.
		[[nodiscard]] bool sizeFor(float wanted) {
			int low = kShortest;
			int high = kTallest;
			while (low < high) {
				const int middle = (low + high) / 2;
				settleAt(middle);
				if (room() < wanted) {
					low = middle + 1;
				} else {
					high = middle;
				}
			}
			settleAt(low);
			return room() >= wanted;
		}

		// Five log entries, wrapping ones if `wrapping`, and the first `injured` drivers injured, each a line in Needs.
		void found3(bool wrapping = false, size_t injured = 0) {
			start(fixtureMakers(), true);
			found();
			for (int day = 1; day <= 5; ++day) {
				played().log.push_back(
					{.day = day,
					 .text = wrapping ? "A run came home with 6 food, 4 water, Berserker, and Tail Gunner, and the long tail of everything "
										"else the road had to say about it on day " +
											std::to_string(day)
									  : "A run came home on day " + std::to_string(day)}
				);
			}
			ASSERT_LE(injured, played().drivers.size());
			for (size_t index = 0; index < injured; ++index) {
				played().drivers[index].status = rules::campaign::DriverStatus::Injured;
				played().drivers[index].injuredDays = 3;
			}
			go(scenes::kMainMenu);
			go(scenes::kCompound);
			settleAt(kTallest);
			const ui::Component* box = find("log");
			ASSERT_NE(box, nullptr);
			ASSERT_NE(find("log_4"), nullptr);
			float entries = 0.0F;
			for (int index = 0; index < 5; ++index) {
				const float height = find("log_" + std::to_string(index))->screenBounds().height;
				entries += height;
				heights.push_back(height);
			}
			chrome = box->screenBounds().height - entries;
		}

		float			   chrome = 0.0F;
		std::vector<float> heights;
	};

	TEST_F(CompoundLogRoom, RoomForTheHeadAndEachEntryShowsTheBoxWithThoseEntries) {
		found3();
		settleAt(kShortest);
		ASSERT_GE(room(), chrome + heights[0]);
		float wanted = chrome;
		for (size_t count = 1; count <= heights.size(); ++count) {
			wanted += heights[count - 1];
			ASSERT_TRUE(sizeFor(wanted)) << count;
			ASSERT_TRUE(boxShown()) << count;
			if (room() < wanted + 1.0F) {
				EXPECT_EQ(logsShown(), static_cast<int>(count));
			} else {
				EXPECT_GE(logsShown(), static_cast<int>(count)) << "the shortest canvas, with room to spare";
			}
		}
	}

	TEST_F(CompoundLogRoom, RoomForTheHeadOnlyShowsTheBoxWithNoEntry) {
		found3(true);
		ASSERT_TRUE(sizeFor(chrome + 2.0F));
		EXPECT_LT(room(), chrome + heights[0] - 1.0F);
		ASSERT_TRUE(boxShown());
		EXPECT_EQ(logsShown(), 0);
	}

	TEST_F(CompoundLogRoom, ASlotThatFirstLaysOutSmallerShowsTheBoxOnceItGrows) {
		found3(true, 2);
		settleAt(kShortest);
		ASSERT_LT(room(), chrome) << "not even the head fits";
		EXPECT_FALSE(boxShown());
		ASSERT_TRUE(sizeFor(chrome + heights[0]));
		ASSERT_TRUE(boxShown());
		EXPECT_EQ(logsShown(), 1);
		settleAt(kShortest);
		EXPECT_FALSE(boxShown());
		ASSERT_TRUE(sizeFor(chrome + 2.0F));
		ASSERT_TRUE(boxShown());
		EXPECT_EQ(logsShown(), 0);
	}

} // namespace
