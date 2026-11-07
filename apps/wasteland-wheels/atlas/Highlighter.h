#pragma once

// The highlighter (UI Art Direction, The hand; procedural-paper.md, Hand marks): the player's selection in lists, one
// pass of a chisel-tip marker drawn by shaders/highlighter.frag.glsl on the rect behind the label it marks, at normal
// blend, so the label's ink lands on top at full strength. Each mark is seeded by what it marks, so two never match.

#include <graphics/Color.h>
#include <graphics/Rect.h>
#include <ui/Component.h>

#include <array>
#include <cstdint>
#include <string>

namespace game::atlas {

	struct HighlighterInk {
		float alpha;   // Highlighter yellow's alpha in one pass
		float pool;	   // the most the darker start lays down, a factor on that
		float streaks; // how much lighter the gaps between the felt's fibres are, 0 to 1
	};

	inline constexpr HighlighterInk kHighlighterInk{.alpha = 0.66F, .pool = 1.24F, .streaks = 0.22F};

	[[nodiscard]] std::array<uint32_t, 3> packHighlight(uint32_t seed, const HighlighterInk& ink = kHighlighterInk);

	// The darkest the mark makes `paper`: the yellow at its pooled alpha over it.
	[[nodiscard]] Foundation::Color darkestHighlight(Foundation::Color highlighter, Foundation::Color paper);

	struct HighlightDraw {
		Foundation::Rect  bounds;
		Foundation::Color highlighter; // opaque; the ink's alpha is applied here
		uint32_t		  seed = 0;
		float			  opacity = 1.0F;
		const char*		  id = nullptr;
		int32_t			  key = 0;
	};

	// A mark through the hook, in the space it's drawn in.
	void drawHighlight(const HighlightDraw& mark);

	// A mark the size of its box, under its children, while it's marked: wrap what it marks in it (a label, or a card with
	// room round it). The pointer passes through it to them.
	class Highlight : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			std::string identity; // what seeds the mark: the scene and what's marked
			bool		marked = true;
		};

		explicit Highlight(const Args& args);

		[[nodiscard]] bool		  isMarked() const { return marked; }
		[[nodiscard]] const char* typeName() const override { return "Highlight"; }
		void					  describe(nlohmann::json& node) const override;

	  protected:
		void render() override;

	  private:
		uint32_t seed;
		bool	 marked;
	};

} // namespace game::atlas
