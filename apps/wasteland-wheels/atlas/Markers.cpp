#include "atlas/Markers.h"

#include "Fonts.h"
#include "atlas/Ink.h"
#include "atlas/Tokens.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <numbers>
#include <vector>

namespace game::atlas {

	namespace {

		namespace palette = tokens::palette;

		constexpr float kShieldWidth = 40.0F;
		constexpr float kShieldHeight = 49.0F;
		constexpr int	kCurveSteps = 8;
		constexpr float kStarInner = 0.42F;

		const char* nameOf(MarkerKind kind) {
			switch (kind) {
				case MarkerKind::Circled:
					return "circled";
				case MarkerKind::Shield:
					return "shield";
				case MarkerKind::Diamond:
					return "diamond";
				case MarkerKind::Star:
					return "star";
			}
			return "";
		}

	} // namespace

	std::span<const Foundation::Vec2> shieldOutline() {
		static const std::vector<Foundation::Vec2> kOutline = [] {
			std::vector<Foundation::Vec2> points;
			const auto					  at = [](float x, float y) {
				   return Foundation::Vec2{(x - 3.0F) / kShieldWidth, y / kShieldHeight};
			};
			const auto quad = [&points](Foundation::Vec2 from, Foundation::Vec2 control, Foundation::Vec2 to) {
				for (int step = 1; step <= kCurveSteps; ++step) {
					const float t = static_cast<float>(step) / kCurveSteps;
					const float a = (1.0F - t) * (1.0F - t);
					const float b = 2.0F * (1.0F - t) * t;
					const float c = t * t;
					points.push_back({a * from.x + b * control.x + c * to.x, a * from.y + b * control.y + c * to.y});
				}
			};
			points.push_back(at(3.0F, 7.0F));
			quad(at(3.0F, 7.0F), at(23.0F, 0.0F), at(43.0F, 7.0F));
			points.push_back(at(43.0F, 26.0F));
			quad(at(43.0F, 26.0F), at(43.0F, 42.0F), at(23.0F, 49.0F));
			quad(at(23.0F, 49.0F), at(3.0F, 42.0F), at(3.0F, 26.0F));
			return points;
		}();
		return kOutline;
	}

	void drawShield(const ShieldDraw& shield) {
		const float					  width = shield.height * kShieldAspect;
		std::vector<Foundation::Vec2> points;
		points.reserve(shieldOutline().size());
		for (const Foundation::Vec2 point : shieldOutline()) {
			points.push_back({shield.topLeft.x + point.x * width, shield.topLeft.y + point.y * shield.height});
		}
		std::optional<Foundation::LineStyle> edge;
		if (shield.edge && shield.edgeWidth > 0.0F) {
			edge = Foundation::LineStyle{.color = *shield.edge, .width = shield.edgeWidth};
		}
		Renderer::Primitives::drawPolygon({.vertices = points, .style = {.fill = shield.fill, .border = edge}, .key = shield.key});
	}

	void drawStar(Foundation::Vec2 centre, float radius, Foundation::Color fill, std::optional<Foundation::Color> edge, int32_t key) {
		std::array<Foundation::Vec2, 10> points{};
		for (size_t index = 0; index < points.size(); ++index) {
			const float reach = index % 2 == 0 ? radius : radius * kStarInner;
			const float angle = -std::numbers::pi_v<float> * 0.5F + static_cast<float>(index) * std::numbers::pi_v<float> / 5.0F;
			points.at(index) = {centre.x + std::cos(angle) * reach, centre.y + std::sin(angle) * reach};
		}
		std::optional<Foundation::LineStyle> border;
		if (edge) {
			border = Foundation::LineStyle{.color = *edge, .width = std::max(1.0F, radius * 0.12F)};
		}
		Renderer::Primitives::drawPolygon({.vertices = points, .style = {.fill = fill, .border = border}, .key = key});
	}

	Marker::Marker(const Args& args)
		: markerKind(args.kind),
		  text(args.text),
		  extent(args.extent),
		  tone(args.tone),
		  faded(args.faded) {}

	Foundation::Vec2 Marker::boxFor(MarkerKind kind, float extent) {
		return {kind == MarkerKind::Shield ? std::round(extent * kShieldAspect) : extent, extent};
	}

	void Marker::describe(nlohmann::json& node) const {
		node["kind"] = nameOf(markerKind);
		if (!text.empty()) {
			node["text"] = text;
		}
		if (faded) {
			node["faded"] = true;
		}
	}

	std::optional<Foundation::Vec2> Marker::intrinsicSize(std::optional<float> /*width*/, float /*availableWidth*/) const {
		return boxFor(markerKind, extent);
	}

	void Marker::render() {
		const ui::Theme& theme = getContext()->getTheme();
		const float		 alpha = opacity();
		const int32_t	 key = drawKey();
		const auto		 ink = [&](ui::ColorToken token) {
			  return withAlpha(theme.get(faded ? palette::fadedPrint : token), alpha);
		};
		const float			   side = std::min(size.x, size.y);
		const Foundation::Vec2 centre = size * 0.5F;
		switch (markerKind) {
			case MarkerKind::Circled:
				drawCircled(centre, side * 0.5F - 1.0F, text, ink(palette::ink), key);
				break;
			case MarkerKind::Diamond:
				drawDiamond(centre, side, ink(palette::stronghold), key);
				break;
			case MarkerKind::Star:
				drawStar(centre, side * 0.5F, ink(palette::ink), withAlpha(theme.get(palette::freshPaper), alpha), key);
				break;
			case MarkerKind::Shield: {
				const bool				highway = tone == ShieldTone::Highway && !faded;
				const float				height = size.y;
				const float				width = height * kShieldAspect;
				const Foundation::Vec2	topLeft{(size.x - width) * 0.5F, 0.0F};
				const Foundation::Color figures = highway ? ink(palette::onHighway) : ink(palette::casing);
				drawShield({
					.topLeft = topLeft,
					.height = height,
					.fill = highway ? ink(palette::highway) : withAlpha(theme.get(palette::freshPaper), alpha),
					.edge = ink(palette::casing),
					.edgeWidth = std::max(1.0F, height * 0.06F),
					.key = key,
				});
				if (!text.empty()) {
					print({
						.text = text,
						.position = {topLeft.x, height * 0.16F},
						.face = fonts::kDisplayBold,
						.size = height * (text.size() > 2 ? 0.44F : 0.56F),
						.color = figures,
						.align = Foundation::HorizontalAlign::Center,
						.boxWidth = width,
						.key = key,
					});
					break;
				}
				const std::array<Foundation::Vec2, 3> arrow{{
					{centre.x - width * 0.22F, height * 0.48F},
					{centre.x, height * 0.26F},
					{centre.x + width * 0.22F, height * 0.48F},
				}};
				Renderer::Primitives::drawPolyline({.points = arrow, .width = height * 0.09F, .color = figures, .key = key});
				Renderer::Primitives::drawLine({
					.start = {centre.x, height * 0.28F},
					.end = {centre.x, height * 0.7F},
					.style = {.color = figures, .width = height * 0.09F},
					.key = key,
				});
				break;
			}
		}
	}

} // namespace game::atlas
