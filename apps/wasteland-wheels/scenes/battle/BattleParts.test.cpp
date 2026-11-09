// The battle scene's bands laid out on their own (Battle Screen Design 2, 6 and 8): the top bar across 1280 to 1600, its
// ticker cut to one line and its LOG key toggling the drawer; the drawer keeping its last 100 lines with the newest at
// the foot; and the turn banner holding its reading time, sliding under motion and not under reduced motion, and the
// fight's end staying up. Each lints clean.

#include "GameTesting.h"
#include "scenes/battle/BattleLog.h"
#include "scenes/battle/TopBar.h"
#include "scenes/battle/TurnBanner.h"

#include <ui/components/Control.h>

#include <nlohmann/json.hpp>

#include <string>
#include <vector>

namespace {

	using namespace game;
	using namespace game::battle;
	using namespace game::testing;

	class BattleParts : public GameTest {
	  protected:
		// The top bar over a road band holding the drawer, at the right, and the banner across it.
		void lay() {
			start(fixtureMakers(), true);
			openParts([this](ui::Ref<ui::Component> root) {
				ui::Ref<ui::Component> stage = root.addChild<ui::Component>({
					.size = {ui::percent(100.0F), ui::percent(100.0F)},
					.layout = {.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Column},
				});
				bar = stage.addChild<TopBar>({
					.id = "top",
					.size = {ui::percent(100.0F), TopBar::kHeight},
					.onToggleLog = [this] {
						++toggles;
						open = !open;
						drawer.get()->setVisible(open);
					},
				});
				ui::Ref<ui::Component> road = stage.addChild<ui::Component>({
					.id = "road",
					.minSize = {0.0F, 0.0F},
					.layout = {.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Column, .flexGrow = 1.0F},
				});
				banner = road.addChild<TurnBanner>({
					.id = "banner",
					.size = {ui::percent(100.0F), ui::percent(100.0F)},
					.layout = {.position = ui::Position::Absolute, .inset = {.top = 0.0F, .left = 0.0F}},
				});
				drawer = road.addChild<LogDrawer>({
					.id = "log",
					.visible = false,
					.layout = {.position = ui::Position::Absolute, .inset = {.top = 0.0F, .right = 0.0F, .bottom = 0.0F}},
				});
			});
		}

		void wait(double seconds) {
			for (double waited = 0.0; waited < seconds - 1e-9; waited += 0.05) {
				frame(0.05);
			}
		}

		ui::Ref<TopBar>		bar;
		ui::Ref<LogDrawer>	drawer;
		ui::Ref<TurnBanner> banner;
		int					toggles = 0;
		bool				open = false;
	};

	TEST_F(BattleParts, TheTopBarFitsFrom1280To1600WithItsTickerOnOneLineAndLogTogglesTheDrawer) {
		lay();
		const std::string longLine =
			"Scavenger's vehicle plays Precision Shot at Road Warrior 1's vehicle, and it goes on well past anything the bar has room "
			"for, past the turn and past the LOG key, so the ticker has to cut it short with an ellipsis rather than run over them.";
		bar.get()->show({.wave = 2, .waves = 3, .arriving = 3, .turn = 4, .raidersActing = true, .ticker = longLine});
		for (const int width : {1280, 1440, 1600}) {
			EXPECT_EQ(lintAt(width, 800), "") << width;
			EXPECT_FLOAT_EQ(find("top")->getSize().y, TopBar::kHeight);
		}
		nlohmann::json ticker;
		find("top_ticker")->describe(ticker);
		EXPECT_EQ(ticker["text"], longLine);
		EXPECT_TRUE(ticker["shown"].get<std::string>().ends_with("...")) << ticker["shown"];
		EXPECT_TRUE(find("top_arriving") != nullptr) << "a wave still to come shows what's arriving";

		bar.get()->show({.wave = 3, .waves = 3, .turn = 5, .ticker = "Your turn."});
		frame();
		EXPECT_EQ(find("top_arriving"), nullptr) << "the last wave on the road leaves nothing to arrive";

		ASSERT_TRUE(press("log_toggle"));
		EXPECT_EQ(toggles, 1);
		bar.get()->show({.wave = 3, .waves = 3, .turn = 5, .ticker = "Your turn.", .logOpen = true});
		frame();
		EXPECT_TRUE(dynamic_cast<ui::Control*>(find("log_toggle"))->isActive()) << "lit while the log is open";
		EXPECT_NE(find("log"), nullptr);
		EXPECT_EQ(lintAt(1280, 720), "");
	}

	TEST_F(BattleParts, TheDrawerKeepsItsLastHundredLinesWrappedWithTheNewestAtTheFoot) {
		lay();
		drawer.get()->setVisible(true);
		std::vector<LogLine> lines;
		for (int index = 0; index < 120; ++index) {
			lines.push_back({
				.turn = 1 + index / 10,
				.text = "Line " + std::to_string(index) +
						(index % 3 == 0 ? ": Ram hits Scavenger's vehicle for 12, 5 to armor, 4 to structure, 3 to Scavenger." : "."),
				.tone = index % 2 == 0 ? LogTone::Hit : LogTone::Plain,
			});
		}
		drawer.get()->add({lines.data(), 60});
		frame();
		drawer.get()->add({lines.data() + 60, 60});
		frame();
		ASSERT_EQ(drawer.get()->lines().size(), static_cast<size_t>(LogDrawer::kKept));
		EXPECT_EQ(drawer.get()->lines().front().text, lines[20].text);
		EXPECT_EQ(drawer.get()->lines().back().text, lines.back().text);
		EXPECT_FLOAT_EQ(find("log")->getSize().x, LogDrawer::kWidth);
		const ui::Component* scroll = find("log_scroll");
		ASSERT_NE(scroll, nullptr);
		EXPECT_GT(scroll->getScrollMax().y, 0.0F);
		EXPECT_FLOAT_EQ(scroll->getScroll().y, scroll->getScrollMax().y) << "scrolled to the newest";
		EXPECT_EQ(lintAt(1280, 800), "");
	}

	TEST_F(BattleParts, TheBannerHoldsItsReadingTimeSlidesOnlyUnderMotionAndTheEndStays) {
		lay();
		banner.get()->announce(rules::Side::Raiders);
		frame();
		EXPECT_TRUE(banner.get()->showing());
		EXPECT_EQ(banner.get()->text(), "RAIDERS' TURN");
		EXPECT_EQ(lintAt(1280, 800), "");
		wait(TurnBanner::kHold + 0.1);
		EXPECT_TRUE(banner.get()->showing()) << "coming in, then the hold, before it starts to leave";
		wait(2.0 * TurnBanner::kMotion);
		EXPECT_FALSE(banner.get()->showing());
		EXPECT_EQ(banner.get()->text(), "");

		app->setReducedMotion(true);
		banner.get()->announce(rules::Side::Player);
		frame();
		EXPECT_EQ(banner.get()->text(), "YOUR TURN");
		wait(TurnBanner::kHold - 0.1);
		EXPECT_TRUE(banner.get()->showing()) << "the hold is reading time, kept under reduced motion";
		wait(0.2);
		EXPECT_FALSE(banner.get()->showing()) << "no slide in or out";

		banner.get()->announceEnd("FIGHT WON");
		wait(5.0);
		EXPECT_TRUE(banner.get()->showing());
		EXPECT_EQ(banner.get()->text(), "FIGHT WON");
	}

} // namespace
