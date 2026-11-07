#include "atlas/Sheet.h"

#include "atlas/ArtView.h"
#include "atlas/Ink.h"
#include "atlas/Tokens.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>

#include <array>
#include <numbers>

namespace game::atlas {

	namespace {

		namespace palette = tokens::palette;

		constexpr const char* kTapeArt = "tape";
		// The neatline (UI Art Direction, Components): 0.6 px outer and 1.6 px inner, 8 px apart, 18 px in from the sheet's edge.
		constexpr float kNeatlineInset = 18.0F;
		constexpr float kNeatlineGap = 8.0F;
		constexpr float kOuterRule = 0.6F;
		constexpr float kInnerRule = 1.6F;
		// The tape's centre from its corner of the sheet, and its turn, from the canvas mock.
		constexpr Foundation::Vec2 kTapeTopLeft{24.0F, 7.0F};
		constexpr Foundation::Vec2 kTapeBottomRight{-20.0F, -11.0F};
		constexpr float			   kTapeTurn = -34.0F * std::numbers::pi_v<float> / 180.0F;

	} // namespace

	Sheet::Sheet(const Args& args)
		: look{
			  .seed = paperSeed(args.identity),
			  .wear = args.mark == HeroMark::None ? Wear::Worn : Wear::Damaged,
			  .hero = args.hero,
			  .mark = args.mark,
			  .folds = 2,
		  } {}

	bool Sheet::tapeLoaded() {
		return artMesh(kTapeArt) != nullptr;
	}

	void Sheet::render() {
		const ui::Theme& theme = getContext()->getTheme();
		const float		 alpha = opacity();
		const float		 margin = theme.get(tokens::sheet::margin);
		const int32_t	 key = drawKey();

		Renderer::Primitives::drawRect(
			{.bounds = {0.0F, 0.0F, size.x, size.y}, .style = {.fill = withAlpha(theme.get(palette::table), alpha)}, .key = key}
		);
		const Foundation::Rect sheet{margin, margin, size.x - 2.0F * margin, size.y - 2.0F * margin};
		Renderer::Primitives::drawRect({
			.bounds = sheet,
			.style =
				{.fill = withAlpha(theme.get(palette::sheet), alpha),
				 .boxShadow =
					 Foundation::BoxShadow{.color = withAlpha(theme.get(palette::shadow), alpha), .blur = 30.0F, .offset = {0.0F, 10.0F}}},
			.key = key,
		});
		drawPaper({.bounds = sheet, .tint = withAlpha(theme.get(palette::sheet), alpha), .look = look, .id = "sheet", .key = key});

		const Foundation::Color						 ink = withAlpha(theme.get(palette::ink), alpha);
		const std::array<std::pair<float, float>, 2> rules{{{kNeatlineInset, kOuterRule}, {kNeatlineInset + kNeatlineGap, kInnerRule}}};
		for (const auto& [inset, width] : rules) {
			Renderer::Primitives::drawRect({
				.bounds = {sheet.x + inset, sheet.y + inset, sheet.width - 2.0F * inset, sheet.height - 2.0F * inset},
				.style =
					{.fill = Foundation::Color(0.0F, 0.0F, 0.0F, 0.0F),
					 .border = Foundation::BorderStyle{.color = ink, .width = width, .position = Foundation::BorderPosition::Center}},
				.key = key,
			});
		}

		if (const ArtMesh* tape = artMesh(kTapeArt)) {
			for (const Foundation::Vec2 centre :
				 {Foundation::Vec2{sheet.x + kTapeTopLeft.x, sheet.y + kTapeTopLeft.y},
				  Foundation::Vec2{sheet.x + sheet.width + kTapeBottomRight.x, sheet.y + sheet.height + kTapeBottomRight.y}}) {
				drawArt({
					.name = kTapeArt,
					.bounds = {centre.x - tape->size.x * 0.5F, centre.y - tape->size.y * 0.5F, tape->size.x, tape->size.y},
					.turn = kTapeTurn,
					.opacity = alpha,
					.key = key,
				});
			}
		}
	}

} // namespace game::atlas
