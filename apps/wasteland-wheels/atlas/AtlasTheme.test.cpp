// The game's theme loads clean in both its modes, and each puts ui's text on its surfaces at 4.5:1 or better.

#include "atlas/AtlasTheme.h"
#include "Fonts.h"
#include "atlas/Paper.h"
#include "atlas/Tokens.h"

#include <ui/theme/Tokens.h>

#include <gtest/gtest.h>

#include <array>
#include <string>

namespace {

	namespace color = ui::tokens::color;

	bool same(Foundation::Color a, Foundation::Color b) {
		return a.r == b.r && a.g == b.g && a.b == b.b && a.a == b.a;
	}

	TEST(GameTheme, BothModesLoadWithoutADiagnostic) {
		for (const char* mode : {"atlas", "dark"}) {
			const ui::ThemeLoad load = ui::Theme::load(
				{.tokens = &game::atlas::tokenTable(), .inputs = {{"theme", mode}}, .fontFamilies = game::fonts::familyNames()}
			);
			for (const ui::dtcg::Diagnostic& diagnostic : load.diagnostics) {
				ADD_FAILURE() << mode << ": " << diagnostic.text();
			}
		}
	}

	TEST(GameTheme, TextHoldsFourAndAHalfToOneOnEverySurfaceInBothModes) {
		for (const ui::Theme* theme : {&game::atlas::theme(), &game::atlas::darkTheme()}) {
			const std::array<ui::ColorToken, 5> surfaces{
				color::surface::base, color::surface::raised, color::surface::sunken, color::surface::overlay, color::surface::control
			};
			for (const ui::ColorToken surface : surfaces) {
				EXPECT_GE(game::atlas::contrastRatio(theme->get(color::text::primary), theme->get(surface)), 4.5F);
				EXPECT_GE(game::atlas::contrastRatio(theme->get(color::text::secondary), theme->get(surface)), 4.5F);
			}
		}
	}

	TEST(GameTheme, TheDarkModeIsTheBattleMocksAndTheAtlasIsUnchanged) {
		const ui::Theme& dark = game::atlas::darkTheme();
		const ui::Theme& atlas = game::atlas::theme();
		EXPECT_TRUE(same(dark.get(color::surface::base), dark.get(game::atlas::tokens::battle::asphalt)));
		EXPECT_TRUE(same(dark.get(color::text::primary), dark.get(game::atlas::tokens::battle::bone)));
		EXPECT_TRUE(same(dark.get(color::focus), dark.get(game::atlas::tokens::battle::warn)));
		EXPECT_TRUE(same(atlas.get(color::surface::base), atlas.get(game::atlas::tokens::palette::sheet)));
		EXPECT_TRUE(same(atlas.get(color::text::primary), atlas.get(game::atlas::tokens::palette::ink)));
	}

} // namespace
