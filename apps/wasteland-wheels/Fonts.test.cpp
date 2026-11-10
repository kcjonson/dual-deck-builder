// The game's faces as the game loads them, from fonts/ in its own folder, and ui's font roles on them in every scene.

#include "Fonts.h"
#include "GameTesting.h"

#include <primitives/Primitives.h>
#include <ui/theme/Tokens.h>

#include <cstdint>
#include <set>

namespace {

	using namespace game;
	using namespace game::testing;

	class Fonts : public GameTest {};

	TEST_F(Fonts, EveryFaceLoadsFromBesideTheExe) {
		app = app::App::create(
			{.applicationName = "wasteland-wheels-tests", .fontAtlases = fonts::atlases(), .defaultFont = fonts::kBody},
			std::make_unique<app::HeadlessPlatform>(1280, 800)
		);
		ASSERT_NE(app, nullptr) << "the body face, the default, didn't load";
		const Renderer::FontRenderer* renderer = Renderer::Primitives::getFontRenderer();
		ASSERT_NE(renderer, nullptr);
		std::set<uint32_t> atlases;
		for (const Renderer::FontAtlasSource& source : fonts::atlases()) {
			atlases.insert(renderer->getAtlasTexture(source.family).value);
			EXPECT_EQ(renderer->crampedGlyphs(source.family), "") << source.jsonPath;
		}
		EXPECT_EQ(atlases.size(), fonts::atlases().size()) << "a face that doesn't load draws in the body face";
	}

	TEST_F(Fonts, ASceneDrawsHeadingsInDisplayProseInBodyAndFiguresInMono) {
		start();
		go(scenes::kMainMenu);
		const ui::Theme& theme = app->scenes().top()->ui().getTheme();
		EXPECT_EQ(theme.style(ui::styles::text::title.theme).fontFamily, fonts::kDisplaySemibold);
		EXPECT_EQ(theme.style(ui::styles::text::body.theme).fontFamily, fonts::kBody);
		EXPECT_EQ(theme.style(ui::styles::label.theme).fontFamily, fonts::kMono);
		ASSERT_NE(find("title"), nullptr);
		EXPECT_EQ(find("title")->getStyle().fontFamily, fonts::kDisplayBold);
		ASSERT_NE(find("continue_line"), nullptr);
		EXPECT_EQ(find("continue_line")->getStyle().fontFamily, fonts::kBody);
	}

} // namespace
