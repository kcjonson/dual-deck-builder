#include "atlas/Paper.h"

#include "BaseShader.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>
#include <ui/theme/Tokens.h>

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstddef>
#include <span>

namespace game::atlas {

	namespace {

		float linear(float channel) {
			return channel <= 0.04045F ? channel / 12.92F : std::pow((channel + 0.055F) / 1.055F, 2.4F);
		}

		float luminance(Foundation::Color color) {
			return 0.2126F * linear(color.r) + 0.7152F * linear(color.g) + 0.0722F * linear(color.b);
		}

		Foundation::Color faded(Foundation::Color color, float opacity) {
			return {color.r, color.g, color.b, color.a * opacity};
		}

	} // namespace

	uint32_t paperSeed(std::string_view identity) {
		uint32_t hash = 2166136261U;
		for (const char character : identity) {
			hash = (hash ^ static_cast<uint8_t>(character)) * 16777619U;
		}
		return hash;
	}

	std::array<uint32_t, 3> packPaper(const PaperLook& look) {
		const auto	   folds = static_cast<uint32_t>(std::clamp(look.folds, 0, 7));
		const uint32_t bits = static_cast<uint32_t>(look.wear) | (static_cast<uint32_t>(look.grab) << 2U) |
							  (static_cast<uint32_t>(look.hero) << 4U) | (static_cast<uint32_t>(look.mark) << 6U) | (folds << 8U) |
							  (static_cast<uint32_t>(look.exposed) << 11U);
		return {look.seed, bits, 0U};
	}

	void tunePaper() {
		Renderer::Primitives::setHookUniforms(base_shader::kPaper, std::as_bytes(std::span(&kPaperTuning, 1)));
	}

	Foundation::Color darkestPaper(Foundation::Color tint, Wear wear) {
		const float strength = kPaperTuning.strength.at(static_cast<size_t>(wear));
		return {
			tint.r * (1.0F - strength * kPaperTuning.shade[0]),
			tint.g * (1.0F - strength * kPaperTuning.shade[1]),
			tint.b * (1.0F - strength * kPaperTuning.shade[2]),
			tint.a,
		};
	}

	float contrastRatio(Foundation::Color a, Foundation::Color b) {
		const float lighter = std::max(luminance(a), luminance(b));
		const float darker = std::min(luminance(a), luminance(b));
		return (lighter + 0.05F) / (darker + 0.05F);
	}

	void drawPaper(const PaperDraw& paper) {
		Renderer::Primitives::drawRect({
			.bounds = paper.bounds,
			.style = {.fill = paper.tint, .border = paper.border},
			.fill = {.hook = &base_shader::kPaperFill, .params = packPaper(paper.look)},
			.id = paper.id,
			.key = paper.key,
		});
	}

	Foundation::Color Paper::tint() const {
		const Foundation::Color fill = style.backgroundColor.value_or(getContext()->getTheme().get(ui::tokens::color::surface::raised));
		return faded(fill, opacity());
	}

	std::optional<Foundation::BorderStyle> Paper::border() const {
		const float width = style.borderWidth.value_or(0.0F);
		if (width <= 0.0F) {
			return std::nullopt;
		}
		return Foundation::BorderStyle{
			.color = faded(style.borderColor.value_or(getContext()->getTheme().get(ui::tokens::color::text::primary)), opacity()),
			.width = width,
			.position = Foundation::BorderPosition::Inside,
		};
	}

	void Paper::render() {
		drawPaper({
			.bounds = {0.0F, 0.0F, size.x, size.y},
			.tint = tint(),
			.look = look,
			.border = border(),
			.id = getId().empty() ? nullptr : getId().c_str(),
			.key = drawKey(),
		});
	}

} // namespace game::atlas
