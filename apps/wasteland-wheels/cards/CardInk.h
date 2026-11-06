#pragma once

// What a card prints and draws with, in the space it's called in: words at a point in one of the game's faces, rules text
// flowed with its keywords in their own colour (Battle Screen Design 5), and the card's marks: the cost hex, the rarity
// gem, the seat's mark, and the art's placeholder. The engine's text draws one colour a run, so a keyword is a run of its
// own placed on the measured widths; with no fonts loaded nothing measures, and a flow has no lines.

#include "cards/CardStyle.h"

#include <graphics/Color.h>
#include <graphics/PrimitiveStyles.h>
#include <graphics/Rect.h>
#include <math/Types.h>
#include <primitives/FontFamily.h>
#include <rules/core/CardText.h>

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace game::cards {

	struct Words {
		std::string					text;
		Foundation::Vec2			at; // the top left, or its box's
		Renderer::FontFamily		face;
		float						size = 12.0F; // px
		Foundation::Color			color;
		Foundation::HorizontalAlign align = Foundation::HorizontalAlign::Left;
		float						boxWidth = 0.0F;
		float						boxHeight = 0.0F; // centred in it when set
		float						letterSpacing = 0.0F;
		int32_t						key = 0;
	};

	void drawWords(const Words& words);

	// How wide `text` prints; 0 with no fonts loaded.
	[[nodiscard]] float wordsWidth(const std::string& text, Renderer::FontFamily face, float size, float letterSpacing = 0.0F);

	// `text` on at most `maxLines` lines of `width`, the last cut with "..." when the rest doesn't fit.
	[[nodiscard]] std::vector<std::string>
	wrappedLines(const std::string& text, Renderer::FontFamily face, float size, float width, int maxLines);

	// One line of `text` in `width`, cut with "..." when it doesn't fit.
	[[nodiscard]] std::string fittedLine(const std::string& text, Renderer::FontFamily face, float size, float width);

	struct FlowPiece {
		std::string		 text;
		bool			 keyword = false;
		Foundation::Vec2 at; // its line box's top left, in the flow's space
	};

	// Rules text laid out once: each piece where it prints and how many lines it takes. A word wider than the box takes a
	// line of its own and runs over it.
	struct WordFlow {
		std::vector<FlowPiece> pieces;
		int					   lines = 0;
		float				   lineHeight = 0.0F;
		float				   size = 0.0F;
		Renderer::FontFamily   face;
	};

	[[nodiscard]] WordFlow
	flowWords(std::string_view text, rules::KeywordMarks marks, Renderer::FontFamily face, float size, float lineHeight, float width);

	// The flow at `origin`, its first `maxLines` lines, plain words in `plain` and keywords in `keyword`.
	void
	drawFlow(const WordFlow& flow, Foundation::Vec2 origin, Foundation::Color plain, Foundation::Color keyword, int maxLines, int32_t key);

	// The cost hex: bone, edged in the ground colour, its digits in display bold.
	void drawCostHex(
		Foundation::Vec2  topLeft,
		float			  side,
		float			  digitSize,
		int				  cost,
		Foundation::Color bone,
		Foundation::Color digits,
		int32_t			  key
	);

	// The rarity gem, a square turned 45 degrees, `side` along each edge.
	void drawGem(Foundation::Vec2 centre, float side, Foundation::Color color, int32_t key);

	// Driver 1's triangle or driver 2's diamond, `size` across.
	void drawSeatMark(int seat, Foundation::Vec2 centre, float size, Foundation::Color color, int32_t key);

	// The art strip: the seat's ground and the placeholder glyph, `glyph` px tall, at its lower right.
	void
	drawArt(const Foundation::Rect& box, float radius, std::optional<int> seat, ArtGlyph glyph, float glyphSize, bool dim, int32_t key);

	// A rounded rect: `fill` with an optional border inside its edge.
	void drawRounded(
		const Foundation::Rect&				   box,
		float								   radius,
		Foundation::Color					   fill,
		std::optional<Foundation::Color>	   border,
		float								   borderWidth,
		int32_t								   key,
		std::optional<Foundation::DashPattern> dash = std::nullopt,
		std::optional<Foundation::BoxShadow>   shadow = std::nullopt
	);

} // namespace game::cards
