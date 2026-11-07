#include "atlas/Highlighter.h"

#include "BaseShader.h"
#include "atlas/Paper.h"
#include "atlas/Tokens.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <bit>

namespace game::atlas {

	std::array<uint32_t, 3> packHighlight(uint32_t seed, const HighlighterInk& ink) {
		return {seed, std::bit_cast<uint32_t>(ink.pool), std::bit_cast<uint32_t>(ink.streaks)};
	}

	Foundation::Color darkestHighlight(Foundation::Color highlighter, Foundation::Color paper) {
		const float alpha = std::min(1.0F, kHighlighterInk.alpha * kHighlighterInk.pool);
		return {
			highlighter.r * alpha + paper.r * (1.0F - alpha),
			highlighter.g * alpha + paper.g * (1.0F - alpha),
			highlighter.b * alpha + paper.b * (1.0F - alpha),
			1.0F,
		};
	}

	void drawHighlight(const HighlightDraw& mark) {
		const Foundation::Color yellow = mark.highlighter;
		Renderer::Primitives::drawRect({
			.bounds = mark.bounds,
			.style = {.fill = {yellow.r, yellow.g, yellow.b, yellow.a * kHighlighterInk.alpha * mark.opacity}},
			.fill = {.hook = &base_shader::kHighlighterFill, .params = packHighlight(mark.seed)},
			.id = mark.id,
			.key = mark.key,
		});
	}

	Highlight::Highlight(const Args& args)
		: seed(paperSeed(args.identity)),
		  marked(args.marked) {}

	void Highlight::describe(nlohmann::json& node) const {
		ui::Component::describe(node);
		node["marked"] = marked;
	}

	void Highlight::render() {
		if (!marked) {
			return;
		}
		drawHighlight({
			.bounds = {0.0F, 0.0F, size.x, size.y},
			.highlighter = getContext()->getTheme().get(tokens::palette::highlighter),
			.seed = seed,
			.opacity = opacity(),
			.id = getId().empty() ? nullptr : getId().c_str(),
			.key = drawKey(),
		});
	}

} // namespace game::atlas
