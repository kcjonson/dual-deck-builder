#include "scenes/splash/ClosedAtlas.h"

#include "atlas/ArtView.h"
#include "atlas/Ink.h"
#include "atlas/Paper.h"
#include "atlas/Tokens.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>
#include <ui/shapes/Text.h>

#include <array>
#include <utility>

namespace game {

	namespace {

		namespace palette = atlas::tokens::palette;
		namespace styles = atlas::styles::print;

		// The mock's cover, and its page edges past the right and bottom (art/cover-edges).
		constexpr Foundation::Vec2 kCover{820.0F, 560.0F};
		constexpr float			   kPageEdges = 10.0F;
		// The neatline at the mock's size: the outer rule's insets (past the spine on the left) and the gap to the inner.
		constexpr float kNeatlineLeft = 44.0F;
		constexpr float kNeatlineInset = 18.0F;
		constexpr float kNeatlineGap = 8.0F;
		constexpr float kShadowBlur = 44.0F;
		constexpr float kShadowDrop = 22.0F;
		constexpr float kLogoShare = 82.0F; // percent of the room inside the neatline

		// The cover's face: the W2 sheet, its neatline in ink over it, and the cover's words and logo inside.
		class CoverFace : public atlas::Paper {
		  public:
			using Paper::Paper;

			[[nodiscard]] const char* typeName() const override { return "CoverFace"; }

		  protected:
			void render() override {
				Paper::render();
				const float									 scale = size.x / kCover.x;
				const Foundation::Color						 ink = atlas::withAlpha(getContext()->getTheme().get(palette::ink), opacity());
				const std::array<std::pair<float, float>, 2> rules{{{0.0F, 0.6F}, {kNeatlineGap, 1.6F}}};
				for (const auto& [gap, width] : rules) {
					const float left = (kNeatlineLeft + gap) * scale;
					const float inset = (kNeatlineInset + gap) * scale;
					Renderer::Primitives::drawRect({
						.bounds = {left, inset, size.x - left - inset, size.y - 2.0F * inset},
						.style =
							{.fill = Foundation::Color(0.0F, 0.0F, 0.0F, 0.0F),
							 .border =
								 Foundation::BorderStyle{.color = ink, .width = width, .position = Foundation::BorderPosition::Center}},
						.key = drawKey(),
					});
				}
			}
		};

	} // namespace

	float ClosedAtlas::heightFor(float width) {
		return width * kCover.y / kCover.x;
	}

	float ClosedAtlas::inkExtent() const {
		return kShadowBlur + kShadowDrop;
	}

	std::optional<Foundation::Vec2> ClosedAtlas::intrinsicSize(std::optional<float> width, float availableWidth) const {
		const float shown = width.value_or(availableWidth);
		return Foundation::Vec2{shown, heightFor(shown)};
	}

	void ClosedAtlas::onMount() {
		const ui::Theme& theme = getContext()->getTheme();
		const ui::Size	 whole{ui::percent(100.0F), ui::percent(100.0F)};
		const ui::Layout filling{.position = ui::Position::Absolute};

		addChild<atlas::ArtView>(
			{.id = "cover_edges", .size = whole, .layout = filling, .art = "cover-edges", .fit = atlas::ArtFit::Stretch}
		);
		ui::Ref<CoverFace> face = addChild<CoverFace>({
			.id = "cover",
			.size = whole,
			.layout =
				[] {
					ui::Layout layout{
						.display = ui::Display::Flex,
						.flexDirection = ui::FlexDirection::Column,
						.alignItems = ui::AlignItems::Center,
						.justifyContent = ui::JustifyContent::SpaceBetween,
					};
					layout.position = ui::Position::Absolute;
					layout.padding = ui::Edges(42.0F, 30.0F, 36.0F, 52.0F);
					return layout;
				}(),
			.style = {.backgroundColor = theme.get(palette::sheet)},
			.look = {.seed = atlas::paperSeed("splash/cover"), .wear = atlas::Wear::Worn, .folds = 1},
		});
		face.addChild<ui::Text>({
			.id = "cover_kicker",
			.style =
				styles::kicker.extend({.fontSize = 12.0F, .letterSpacing = 4.0F, .textTransform = Foundation::TextTransform::Uppercase}),
			.text = "A road atlas of the Halcyon region",
		});
		face.addChild<atlas::ArtView>({.id = "logo", .size = {ui::percent(kLogoShare), ui::kAuto}, .art = "logo"});
		face.addChild<ui::Text>({.id = "cover_edition", .style = styles::subtitle, .text = "fourth edition, revised after"});
		addChild<atlas::ArtView>(
			{.id = "cover_spine", .size = whole, .layout = filling, .art = "cover-spine", .fit = atlas::ArtFit::Stretch}
		);
	}

	void ClosedAtlas::render() {
		// The sheet's drop shadow, under the cover and its page edges; the face paints over the fill.
		const ui::Theme& theme = getContext()->getTheme();
		const float		 alpha = opacity();
		const float		 edges = kPageEdges * size.x / kCover.x;
		Renderer::Primitives::drawRect({
			.bounds = {edges, edges, size.x, size.y},
			.style =
				{.fill = atlas::withAlpha(theme.get(palette::sheet), alpha),
				 .boxShadow =
					 Foundation::BoxShadow{
						 .color = atlas::withAlpha(theme.get(palette::shadow), alpha), .blur = kShadowBlur, .offset = {0.0F, kShadowDrop}
					 }},
			.key = drawKey(),
		});
	}

} // namespace game
