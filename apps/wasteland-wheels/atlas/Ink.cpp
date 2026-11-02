#include "atlas/Ink.h"

#include "Fonts.h"

#include <font/FontRenderer.h>
#include <primitives/Primitives.h>
#include <ui/Context.h>

#include <algorithm>
#include <array>
#include <cmath>

namespace game::atlas {

	namespace {

		constexpr Foundation::Color kWhite{1.0F, 1.0F, 1.0F, 1.0F};
		constexpr float				kBaseSize = 16.0F; // drawText's scale 1

	} // namespace

	Foundation::Color withAlpha(Foundation::Color color, float alpha) {
		color.a *= alpha;
		return color;
	}

	void drawDashedLine(Foundation::Vec2 from, Foundation::Vec2 to, Foundation::Color color, float width, Dashes dashes, int32_t key) {
		const Foundation::Vec2 along = to - from;
		const float			   length = std::sqrt(along.x * along.x + along.y * along.y);
		if (length <= 0.0F || dashes.dash <= 0.0F) {
			return;
		}
		const Foundation::Vec2 step = along / length;
		for (float at = 0.0F; at < length; at += dashes.dash + dashes.gap) {
			const float end = std::min(length, at + dashes.dash);
			Renderer::Primitives::drawLine({
				.start = from + step * at,
				.end = from + step * end,
				.style = {.color = color, .width = width},
				.key = key,
			});
		}
	}

	void drawDashedRect(const Foundation::Rect& bounds, Foundation::Color color, float width, Dashes dashes, int32_t key) {
		const float							  half = width * 0.5F;
		const float							  left = bounds.x + half;
		const float							  top = bounds.y + half;
		const float							  right = bounds.x + bounds.width - half;
		const float							  bottom = bounds.y + bounds.height - half;
		const std::array<Foundation::Vec2, 4> corners{{{left, top}, {right, top}, {right, bottom}, {left, bottom}}};
		for (size_t side = 0; side < corners.size(); ++side) {
			drawDashedLine(corners.at(side), corners.at((side + 1) % corners.size()), color, width, dashes, key);
		}
	}

	void drawIcon(ui::Context& context, std::string_view name, Foundation::Vec2 topLeft, float size, Foundation::Color color, int32_t key) {
		const std::optional<Renderer::FontRenderer::GlyphQuad> quad =
			context.icons().quad(name, {topLeft.x, topLeft.y}, size, {color.r, color.g, color.b, color.a});
		if (quad.has_value()) {
			Renderer::Primitives::drawGlyphs(&*quad, 1, key);
		}
	}

	void drawCircled(Foundation::Vec2 centre, float radius, const std::string& text, Foundation::Color ink, int32_t key) {
		Renderer::Primitives::drawCircle({
			.center = centre,
			.radius = radius,
			.style = {.fill = withAlpha(kWhite, ink.a), .border = Foundation::BorderStyle{.color = ink, .width = radius * 0.15F}},
			.key = key,
		});
		const float size = radius * 1.15F;
		print({
			.text = text,
			.position = {centre.x - radius, centre.y - size * 0.62F},
			.face = fonts::kDisplayBold,
			.size = size,
			.color = ink,
			.align = Foundation::HorizontalAlign::Center,
			.boxWidth = radius * 2.0F,
			.key = key,
		});
	}

	void drawDiamond(Foundation::Vec2 centre, float size, Foundation::Color color, int32_t key) {
		const float							  half = size * 0.5F;
		const std::array<Foundation::Vec2, 4> points{{
			{centre.x, centre.y - half},
			{centre.x + half, centre.y},
			{centre.x, centre.y + half},
			{centre.x - half, centre.y},
		}};
		Renderer::Primitives::drawPolygon({.vertices = points, .style = {.fill = color}, .key = key});
	}

	void print(const Print& text) {
		Renderer::Primitives::drawText({
			.text = text.text,
			.position = text.position,
			.scale = text.size / kBaseSize,
			.color = text.color,
			.font = text.face,
			.hAlign = text.align,
			.boxWidth = text.boxWidth,
			.letterSpacing = text.letterSpacing,
			.key = text.key,
		});
	}

	float printedWidth(const std::string& text, Renderer::FontFamily face, float size, float letterSpacing) {
		const Renderer::FontRenderer* fonts = Renderer::Primitives::getFontRenderer();
		return fonts == nullptr ? 0.0F : fonts->MeasureText(text, size / kBaseSize, face, letterSpacing).x;
	}

} // namespace game::atlas
