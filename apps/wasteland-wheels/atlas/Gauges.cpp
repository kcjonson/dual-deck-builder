#include "atlas/Gauges.h"

#include "atlas/Ink.h"
#include "atlas/Tokens.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>

namespace game::atlas {

	namespace {

		namespace palette = tokens::palette;

		constexpr float kSegmentWidth = 32.0F;
		constexpr float kScaleHeight = 8.0F;
		constexpr float kCasedWidth = 160.0F;
		constexpr float kCasedHeight = 12.0F;
		// The casing's share of the cased bar's height on each side.
		constexpr float kCasingShare = 0.2F;

		float unit(float value) {
			return std::isfinite(value) ? std::clamp(value, 0.0F, 1.0F) : 0.0F;
		}

	} // namespace

	ScaleBar::ScaleBar(const Args& args)
		: segmentCount(std::max(1, args.segments)),
		  amount(args.value ? std::optional(unit(*args.value)) : std::nullopt),
		  tone(args.tone),
		  frameWidth(args.frame) {}

	void ScaleBar::setValue(std::optional<float> value) {
		amount = value ? std::optional(unit(*value)) : std::nullopt;
	}

	int ScaleBar::filledCount() const {
		return amount ? static_cast<int>(std::lround(*amount * static_cast<float>(segmentCount))) : (segmentCount + 1) / 2;
	}

	bool ScaleBar::isFilled(int index) const {
		return amount ? index < filledCount() : index % 2 == 0;
	}

	void ScaleBar::describe(nlohmann::json& node) const {
		node["segments"] = segmentCount;
		node["filled"] = filledCount();
		if (amount) {
			node["value"] = *amount;
		}
	}

	std::optional<Foundation::Vec2> ScaleBar::intrinsicSize(std::optional<float> width, float /*availableWidth*/) const {
		return Foundation::Vec2{width.value_or(static_cast<float>(segmentCount) * kSegmentWidth), kScaleHeight};
	}

	void ScaleBar::render() {
		const ui::Theme&		theme = getContext()->getTheme();
		const float				alpha = opacity();
		const int32_t			key = drawKey();
		const bool				highway = tone == ScaleTone::Highway;
		const Foundation::Color fill = withAlpha(theme.get(highway ? palette::highway : palette::ink), alpha);
		const Foundation::Color frame = withAlpha(theme.get(highway ? palette::casing : palette::ink), alpha);
		Renderer::Primitives::drawRect({
			.bounds = {0.0F, 0.0F, size.x, size.y},
			.style =
				{.fill = withAlpha(theme.get(palette::paper), alpha),
				 .border = Foundation::BorderStyle{.color = frame, .width = frameWidth, .position = Foundation::BorderPosition::Inside}},
			.id = getId().empty() ? nullptr : getId().c_str(),
			.key = key,
		});
		const float inner = size.x - frameWidth * 2.0F;
		const float step = inner / static_cast<float>(segmentCount);
		const float height = size.y - frameWidth * 2.0F;
		for (int index = 0; index < segmentCount; ++index) {
			if (isFilled(index)) {
				Renderer::Primitives::drawRect(
					{.bounds = {frameWidth + static_cast<float>(index) * step, frameWidth, step, height},
					 .style = {.fill = fill},
					 .key = key}
				);
			}
		}
		// A count's segments are split by seams in the frame's colour, as a scale's alternation splits them already.
		if (amount) {
			for (int index = 1; index < segmentCount; ++index) {
				const float x = frameWidth + static_cast<float>(index) * step;
				Renderer::Primitives::drawRect({.bounds = {x - 0.5F, frameWidth, 1.0F, height}, .style = {.fill = frame}, .key = key});
			}
		}
	}

	CasedBar::CasedBar(const Args& args)
		: amount(unit(args.value)),
		  seat(args.seat) {}

	void CasedBar::setValue(float value) {
		amount = unit(value);
	}

	float CasedBar::casingWidth() const {
		return std::max(1.0F, std::round(size.y * kCasingShare));
	}

	float CasedBar::fillWidth() const {
		return std::max(0.0F, size.x - casingWidth() * 2.0F) * amount;
	}

	void CasedBar::describe(nlohmann::json& node) const {
		node["value"] = amount;
		node["seat"] = seat;
	}

	std::optional<Foundation::Vec2> CasedBar::intrinsicSize(std::optional<float> width, float /*availableWidth*/) const {
		return Foundation::Vec2{width.value_or(kCasedWidth), kCasedHeight};
	}

	void CasedBar::render() {
		const ui::Theme& theme = getContext()->getTheme();
		const float		 alpha = opacity();
		const int32_t	 key = drawKey();
		const float		 edge = casingWidth();
		const bool		 first = seat == 0;
		Renderer::Primitives::drawRect({
			.bounds = {0.0F, 0.0F, size.x, size.y},
			.style = {.fill = withAlpha(theme.get(first ? palette::casing : palette::routeTealCasing), alpha)},
			.id = getId().empty() ? nullptr : getId().c_str(),
			.key = key,
		});
		const Foundation::Rect track{edge, edge, std::max(0.0F, size.x - edge * 2.0F), std::max(0.0F, size.y - edge * 2.0F)};
		Renderer::Primitives::drawRect({.bounds = track, .style = {.fill = withAlpha(theme.get(palette::paper), alpha)}, .key = key});
		if (const float filled = fillWidth(); filled > 0.0F) {
			Renderer::Primitives::drawRect({
				.bounds = {track.x, track.y, filled, track.height},
				.style = {.fill = withAlpha(theme.get(first ? palette::highway : palette::routeTeal), alpha)},
				.key = key,
			});
		}
	}

} // namespace game::atlas
