// The splash in the atlas: the closed atlas's art loads, the decks lie by the book, it lints 0 at the sizes the game
// opens at, and the loader fills before it hands off to the menu.

#include "GameTesting.h"
#include "atlas/ArtView.h"
#include "atlas/Gauges.h"

#include <ui/shapes/Text.h>

namespace {

	using namespace game;
	using namespace game::testing;

	class Splash : public GameTest {};

	TEST_F(Splash, TheClosedAtlasAndItsDecksDrawAndItLintsZero) {
		start(fixtureMakers(), true);
		go(scenes::kSplash);
		for (const char* art : {"cover-edges", "cover-spine", "logo"}) {
			EXPECT_NE(atlas::artMesh(art), nullptr) << art;
		}
		for (const char* id : {"book", "deck_a", "deck_b", "loader_bar", "build"}) {
			EXPECT_NE(find(id), nullptr) << id;
		}
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
	}

	TEST_F(Splash, TheLoaderFillsAsItHoldsThenTheMenuOpens) {
		start();
		go(scenes::kSplash);
		const auto* bar = dynamic_cast<const atlas::ScaleBar*>(find("loader_bar"));
		ASSERT_NE(bar, nullptr);
		const int early = bar->filledCount();
		frame(0.25);
		frame(0.25);
		EXPECT_GT(bar->filledCount(), early);
		EXPECT_EQ(dynamic_cast<const ui::Text*>(find("loader_percent"))->getText(), std::to_string(state()["percent"].get<int>()) + "%");
		for (int index = 0; index < 8 && top() == scenes::kSplash; ++index) {
			frame(0.25);
		}
		EXPECT_EQ(top(), scenes::kMainMenu);
	}

} // namespace
