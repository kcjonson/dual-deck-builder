#include "cards/CardInk.h"

#include "Fonts.h"
#include "atlas/Markers.h"

#include <font/FontRenderer.h>
#include <primitives/Primitives.h>

#include <algorithm>
#include <array>
#include <numbers>

namespace game::cards {

	namespace {

		constexpr float				kBaseSize = 16.0F; // drawText's scale 1
		constexpr Foundation::Color kClear{0.0F, 0.0F, 0.0F, 0.0F};
		constexpr const char*		kEllipsis = "...";

		const Renderer::FontRenderer* fontRenderer() {
			return Renderer::Primitives::getFontRenderer();
		}

		// The longest start of `text` that fits `width` with "..." after it.
		std::string cut(const std::string& text, Renderer::FontFamily face, float size, float width) {
			std::string kept = text;
			while (!kept.empty() && wordsWidth(kept + kEllipsis, face, size) > width) {
				kept.pop_back();
			}
			while (!kept.empty() && kept.back() == ' ') {
				kept.pop_back();
			}
			return kept + kEllipsis;
		}

		void drawRing(Foundation::Vec2 centre, float radius, float width, Foundation::Color color, int32_t key) {
			Renderer::Primitives::drawCircle({
				.center = centre,
				.radius = radius,
				.style = {.fill = kClear, .border = Foundation::BorderStyle{.color = color, .width = width}},
				.key = key,
			});
		}

		void drawGlyph(ArtGlyph glyph, Foundation::Vec2 centre, float size, Foundation::Color color, int32_t key) {
			const float half = size * 0.5F;
			const float stroke = std::max(1.5F, size * 0.07F);
			switch (glyph) {
				case ArtGlyph::Crosshair: {
					drawRing(centre, half * 0.62F, stroke, color, key);
					const std::array<Foundation::Vec2, 4> ways{{{0.0F, -1.0F}, {1.0F, 0.0F}, {0.0F, 1.0F}, {-1.0F, 0.0F}}};
					for (const Foundation::Vec2 way : ways) {
						Renderer::Primitives::drawLine({
							.start = {centre.x + way.x * half * 0.3F, centre.y + way.y * half * 0.3F},
							.end = {centre.x + way.x * half, centre.y + way.y * half},
							.style = {.color = color, .width = stroke},
							.key = key,
						});
					}
					break;
				}
				case ArtGlyph::Shield:
					atlas::drawShield({
						.topLeft = {centre.x - half * atlas::kShieldAspect, centre.y - half},
						.height = size,
						.fill = color,
						.key = key,
					});
					break;
				case ArtGlyph::Chevrons:
					for (const float lift : {-0.25F, 0.25F}) {
						const std::array<Foundation::Vec2, 3> chevron{{
							{centre.x - half * 0.7F, centre.y + lift * size + half * 0.3F},
							{centre.x, centre.y + lift * size - half * 0.3F},
							{centre.x + half * 0.7F, centre.y + lift * size + half * 0.3F},
						}};
						Renderer::Primitives::drawPolyline({.points = chevron, .width = stroke * 1.4F, .color = color, .key = key});
					}
					break;
				case ArtGlyph::Square:
					Renderer::Primitives::drawRect({
						.bounds = {centre.x - half * 0.6F, centre.y - half * 0.6F, size * 0.6F, size * 0.6F},
						.style = {.fill = kClear, .border = Foundation::BorderStyle{.color = color, .width = stroke}},
						.key = key,
					});
					break;
				case ArtGlyph::Ring:
					drawRing(centre, half * 0.62F, stroke, color, key);
					Renderer::Primitives::drawCircle({.center = centre, .radius = stroke, .style = {.fill = color}, .key = key});
					break;
			}
		}

	} // namespace

	void drawWords(const Words& words) {
		Renderer::Primitives::drawText({
			.text = words.text,
			.position = words.at,
			.scale = words.size / kBaseSize,
			.color = words.color,
			.font = words.face,
			.hAlign = words.align,
			.vAlign = words.boxHeight > 0.0F ? Foundation::VerticalAlign::Middle : Foundation::VerticalAlign::Top,
			.boxWidth = words.boxWidth,
			.boxHeight = words.boxHeight,
			.letterSpacing = words.letterSpacing,
			.key = words.key,
		});
	}

	float wordsWidth(const std::string& text, Renderer::FontFamily face, float size, float letterSpacing) {
		const Renderer::FontRenderer* fonts = fontRenderer();
		return fonts == nullptr || text.empty() ? 0.0F : fonts->MeasureText(text, size / kBaseSize, face, letterSpacing).x;
	}

	std::vector<std::string> wrappedLines(const std::string& text, Renderer::FontFamily face, float size, float width, int maxLines) {
		const Renderer::FontRenderer* fonts = fontRenderer();
		if (fonts == nullptr) {
			return {text};
		}
		const auto&				 wrapped = fonts->wrapText(text, size / kBaseSize, width, face);
		std::vector<std::string> lines(wrapped.lines.begin(), wrapped.lines.end());
		if (static_cast<int>(lines.size()) > maxLines) {
			std::string rest;
			for (size_t index = static_cast<size_t>(maxLines) - 1; index < lines.size(); ++index) {
				rest += (rest.empty() ? "" : " ") + lines[index];
			}
			lines.resize(static_cast<size_t>(maxLines));
			lines.back() = cut(rest, face, size, width);
		}
		return lines;
	}

	std::string fittedLine(const std::string& text, Renderer::FontFamily face, float size, float width) {
		return wordsWidth(text, face, size) <= width ? text : cut(text, face, size, width);
	}

	WordFlow
	flowWords(std::string_view text, rules::KeywordMarks marks, Renderer::FontFamily face, float size, float lineHeight, float width) {
		WordFlow flow{.lineHeight = lineHeight, .size = size, .face = face};
		if (fontRenderer() == nullptr) {
			return flow;
		}
		const float space = wordsWidth("x x", face, size) - wordsWidth("xx", face, size);
		int			line = 0;
		float		x = 0.0F;
		bool		any = false;
		for (const rules::TextWord& word : rules::keywordWords(text, marks)) {
			float wordWidth = 0.0F;
			for (const rules::TextPiece& piece : word) {
				wordWidth += wordsWidth(piece.text, face, size);
			}
			if (any && x + space + wordWidth > width) {
				++line;
				x = 0.0F;
			} else if (any) {
				x += space;
			}
			for (const rules::TextPiece& piece : word) {
				flow.pieces.push_back({.text = piece.text, .keyword = piece.keyword, .at = {x, static_cast<float>(line) * lineHeight}});
				x += wordsWidth(piece.text, face, size);
			}
			any = true;
		}
		flow.lines = any ? line + 1 : 0;
		return flow;
	}

	void
	drawFlow(const WordFlow& flow, Foundation::Vec2 origin, Foundation::Color plain, Foundation::Color keyword, int maxLines, int32_t key) {
		const float last = static_cast<float>(maxLines) * flow.lineHeight;
		for (const FlowPiece& piece : flow.pieces) {
			if (piece.at.y >= last) {
				break;
			}
			drawWords({
				.text = piece.text,
				.at = {origin.x + piece.at.x, origin.y + piece.at.y},
				.face = flow.face,
				.size = flow.size,
				.color = piece.keyword ? keyword : plain,
				.boxHeight = flow.lineHeight,
				.key = key,
			});
		}
	}

	void drawCostHex(
		Foundation::Vec2  topLeft,
		float			  side,
		float			  digitSize,
		int				  cost,
		Foundation::Color bone,
		Foundation::Color digits,
		int32_t			  key
	) {
		const float							  edge = side / 15.0F;
		const std::array<Foundation::Vec2, 6> outer = hexPoints({topLeft.x - edge, topLeft.y - edge}, side + edge * 2.0F);
		const std::array<Foundation::Vec2, 6> inner = hexPoints(topLeft, side);
		Renderer::Primitives::drawPolygon({.vertices = outer, .style = {.fill = {kHexEdge.r, kHexEdge.g, kHexEdge.b, bone.a}}, .key = key});
		Renderer::Primitives::drawPolygon({.vertices = inner, .style = {.fill = bone}, .key = key});
		drawWords({
			.text = std::to_string(cost),
			.at = topLeft,
			.face = fonts::kDisplayBold,
			.size = digitSize,
			.color = digits,
			.align = Foundation::HorizontalAlign::Center,
			.boxWidth = side,
			.boxHeight = side,
			.key = key,
		});
	}

	void drawGem(Foundation::Vec2 centre, float side, Foundation::Color color, int32_t key) {
		const float							  half = side * std::numbers::sqrt2_v<float> * 0.5F;
		const std::array<Foundation::Vec2, 4> points{{
			{centre.x, centre.y - half},
			{centre.x + half, centre.y},
			{centre.x, centre.y + half},
			{centre.x - half, centre.y},
		}};
		Renderer::Primitives::drawPolygon({.vertices = points, .style = {.fill = color}, .key = key});
	}

	void drawSeatMark(int seat, Foundation::Vec2 centre, float size, Foundation::Color color, int32_t key) {
		const float half = size * 0.5F;
		if (seat == 0) {
			const std::array<Foundation::Vec2, 3> triangle{{
				{centre.x, centre.y - half},
				{centre.x + half, centre.y + half * 0.8F},
				{centre.x - half, centre.y + half * 0.8F},
			}};
			Renderer::Primitives::drawPolygon({.vertices = triangle, .style = {.fill = color}, .key = key});
			return;
		}
		const std::array<Foundation::Vec2, 4> diamond{{
			{centre.x, centre.y - half},
			{centre.x + half, centre.y},
			{centre.x, centre.y + half},
			{centre.x - half, centre.y},
		}};
		Renderer::Primitives::drawPolygon({.vertices = diamond, .style = {.fill = color}, .key = key});
	}

	void
	drawArt(const Foundation::Rect& box, float radius, std::optional<int> seat, ArtGlyph glyph, float glyphSize, bool dim, int32_t key) {
		std::array<Foundation::Color, 2> ground = artGround(seat);
		if (dim) {
			ground = {dimmed(ground[0]), dimmed(ground[1])};
		}
		Renderer::Primitives::drawRect({
			.bounds = box,
			.style =
				{.fill = ground[1],
				 .border = Foundation::BorderStyle{.width = 0.0F, .cornerRadius = radius},
				 .gradient = Foundation::LinearGradient{.from = ground[0], .to = ground[1]}},
			.key = key,
		});
		drawGlyph(glyph, {box.x + box.width * 0.5F, box.y + box.height * 0.5F}, glyphSize, dim ? dimmed(kArtGlyph) : kArtGlyph, key);
	}

	void drawRounded(
		const Foundation::Rect&				   box,
		float								   radius,
		Foundation::Color					   fill,
		std::optional<Foundation::Color>	   border,
		float								   borderWidth,
		int32_t								   key,
		std::optional<Foundation::DashPattern> dash,
		std::optional<Foundation::BoxShadow>   shadow
	) {
		Renderer::Primitives::drawRect({
			.bounds = box,
			.style =
				{.fill = fill,
				 .border =
					 Foundation::BorderStyle{
						 .color = border.value_or(kClear),
						 .width = border ? borderWidth : 0.0F,
						 .cornerRadius = radius,
						 .position = Foundation::BorderPosition::Inside,
						 .dash = dash,
					 },
				 .boxShadow = shadow},
			.key = key,
		});
	}

} // namespace game::cards
