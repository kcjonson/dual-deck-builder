// The highlighter hook's contract without a GPU: ink holds 4.5:1 on the darkest mark over any paper the selection sits on,
// one pass stays in the spec's 0.6 to 0.75, and a mark reaches the backend through the hook with its seed and ink packed.

#include "atlas/Highlighter.h"
#include "BaseShader.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Paper.h"
#include "atlas/Tokens.h"

#include <backend/NullBackend.h>
#include <primitives/Primitives.h>

#include <gtest/gtest.h>

#include <array>
#include <bit>
#include <memory>
#include <utility>

namespace {

	using namespace game::atlas;
	namespace palette = game::atlas::tokens::palette;

	TEST(Highlighter, InkHoldsFourAndAHalfToOneOnTheDarkestMarkOverEveryPaper) {
		EXPECT_GE(kHighlighterInk.alpha, 0.6F);
		EXPECT_LE(kHighlighterInk.alpha, 0.75F);
		const ui::Theme&											atlas = theme();
		const Foundation::Color										ink = atlas.get(palette::ink);
		const Foundation::Color										yellow = atlas.get(palette::highlighter);
		const std::array<std::pair<const char*, ui::ColorToken>, 4> papers{{
			{"sheet", palette::sheet},
			{"paper", palette::paper},
			{"freshPaper", palette::freshPaper},
			{"index", palette::index},
		}};
		for (const auto& [name, token] : papers) {
			for (const Wear wear : {Wear::Clean, Wear::Handled, Wear::Worn}) {
				const Foundation::Color under = darkestPaper(atlas.get(token), wear);
				EXPECT_GE(contrastRatio(ink, darkestHighlight(yellow, under)), 4.5F) << name << " at W" << static_cast<int>(wear);
			}
		}
	}

	TEST(Highlighter, AMarkGoesThroughTheHookWithItsSeedAndInk) {
		auto							backend = std::make_unique<Renderer::backend::NullBackend>();
		Renderer::backend::NullBackend* gpu = backend.get();
		Renderer::Primitives::init(std::move(backend), base_shader::source());
		Renderer::Primitives::setViewport(640, 480);

		const uint32_t seed = paperSeed("crew/driver-2");
		Renderer::Primitives::beginFrame();
		drawHighlight({.bounds = {10.0F, 10.0F, 120.0F, 24.0F}, .highlighter = Foundation::Color(0.96F, 0.85F, 0.3F, 1.0F), .seed = seed});
		Renderer::Primitives::endFrame();

		ASSERT_EQ(gpu->draws().size(), 1U);
		const Renderer::backend::NullBackend::RecordedDraw& draw = gpu->draws().front();
		ASSERT_EQ(draw.fills.size(), 1U);
		EXPECT_EQ(draw.fills.front().index, base_shader::kHighlighterFill.index);
		EXPECT_EQ(draw.fills.front().params, packHighlight(seed));
		EXPECT_EQ(std::bit_cast<float>(packHighlight(seed)[1]), kHighlighterInk.pool);
		EXPECT_NE(packHighlight(paperSeed("crew/driver-1"))[0], packHighlight(seed)[0]) << "two marks never match";
		Renderer::Primitives::shutdown();
	}

} // namespace
