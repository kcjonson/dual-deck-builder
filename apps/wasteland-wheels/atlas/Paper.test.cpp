// The paper hook's contract without a GPU: ink holds 4.5:1 on the darkest the hook makes any paper at any wear, and a
// paper rect reaches the backend through the hook with its look packed and the tuning in its block.

#include "atlas/Paper.h"
#include "BaseShader.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Tokens.h"

#include <backend/NullBackend.h>
#include <primitives/Primitives.h>

#include <gtest/gtest.h>

#include <array>
#include <cstring>
#include <memory>
#include <span>
#include <utility>

namespace {

	using namespace game::atlas;
	namespace palette = game::atlas::tokens::palette;

	TEST(Paper, InkHoldsFourAndAHalfToOneOnEveryPaperAtEveryWear) {
		const ui::Theme&											atlas = theme();
		const Foundation::Color										ink = atlas.get(palette::ink);
		const std::array<std::pair<const char*, ui::ColorToken>, 4> papers{{
			{"sheet", palette::sheet},
			{"paper", palette::paper},
			{"freshPaper", palette::freshPaper},
			{"index", palette::index},
		}};
		for (const auto& [name, token] : papers) {
			for (const Wear wear : {Wear::Clean, Wear::Handled, Wear::Worn, Wear::Damaged}) {
				const float ratio = contrastRatio(ink, darkestPaper(atlas.get(token), wear));
				EXPECT_GE(ratio, 4.5F) << name << " at W" << static_cast<int>(wear);
			}
		}
	}

	TEST(Paper, ARectOfPaperGoesThroughTheHookWithItsLookAndTheTuning) {
		auto							backend = std::make_unique<Renderer::backend::NullBackend>();
		Renderer::backend::NullBackend* gpu = backend.get();
		Renderer::Primitives::init(std::move(backend), base_shader::source());
		Renderer::Primitives::setViewport(640, 480);
		tunePaper();

		const PaperLook look{.seed = paperSeed("compound/sheet"), .wear = Wear::Worn, .folds = 2, .exposed = Side::Left};
		Renderer::Primitives::beginFrame();
		drawPaper({.bounds = {10.0F, 10.0F, 300.0F, 200.0F}, .tint = Foundation::Color(0.93F, 0.9F, 0.82F, 1.0F), .look = look});
		Renderer::Primitives::endFrame();

		ASSERT_EQ(gpu->draws().size(), 1U);
		const Renderer::backend::NullBackend::RecordedDraw& draw = gpu->draws().front();
		ASSERT_EQ(draw.fills.size(), 1U);
		EXPECT_EQ(draw.fills.front().index, base_shader::kPaperFill.index);
		EXPECT_EQ(draw.fills.front().params, packPaper(look));
		const std::span<const std::byte> block = draw.hookBlock(base_shader::kPaper.binding);
		ASSERT_EQ(block.size(), sizeof(PaperTuning));
		EXPECT_EQ(std::memcmp(block.data(), &kPaperTuning, sizeof(PaperTuning)), 0);
		Renderer::Primitives::shutdown();
	}

	TEST(Paper, ASeedIsWhatTheSurfaceIsAndTheLookPacksIntoItsBits) {
		EXPECT_EQ(paperSeed("compound/needs"), paperSeed("compound/needs"));
		EXPECT_NE(paperSeed("compound/needs"), paperSeed("compound/the_day"));
		const std::array<uint32_t, 3> packed = packPaper(
			{.seed = 7U,
			 .wear = Wear::Damaged,
			 .grab = Corner::BottomLeft,
			 .hero = Corner::TopRight,
			 .mark = HeroMark::Rip,
			 .folds = 9,
			 .exposed = Side::Bottom}
		);
		EXPECT_EQ(packed[0], 7U);
		EXPECT_EQ(packed[1], 3U | (3U << 2U) | (1U << 4U) | (3U << 6U) | (7U << 8U) | (3U << 11U)) << "folds clamp to 7";
		EXPECT_EQ(packed[2], 0U);
	}

} // namespace
