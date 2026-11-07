#include "scenes/event/EventPlate.h"

#include "Words.h"
#include "atlas/Ink.h"
#include "atlas/Tokens.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <span>
#include <utility>
#include <vector>

namespace game::event {

	namespace {

		using Foundation::Color;
		using Foundation::Rect;
		using Foundation::Vec2;
		namespace palette = atlas::tokens::palette;
		namespace Primitives = Renderer::Primitives;

		constexpr int				   kContours = 7;
		constexpr int				   kContourSteps = 24;
		constexpr float				   kCasing = 36.0F;
		constexpr float				   kRoad = 28.0F;
		constexpr float				   kVehicleLength = 92.0F;
		constexpr float				   kVehicleWidth = 40.0F;
		constexpr std::array<float, 3> kRings{18.0F, 30.0F, 42.0F};
		// The plate the scene's sizes are drawn for; a smaller one scales them down.
		constexpr float kDesignSide = 320.0F;
		constexpr Color kClear{0.0F, 0.0F, 0.0F, 0.0F};

		// A rectangle's corners about its centre, turned by `angle`.
		std::vector<Vec2> box(Vec2 centre, float angle, float length, float width) {
			const float		  cos = std::cos(angle);
			const float		  sin = std::sin(angle);
			std::vector<Vec2> corners;
			for (const auto [u, v] : std::array<std::pair<float, float>, 4>{{{-1.0F, -1.0F}, {1.0F, -1.0F}, {1.0F, 1.0F}, {-1.0F, 1.0F}}}) {
				corners.push_back({
					centre.x + u * length * cos * 0.5F - v * width * sin * 0.5F,
					centre.y + u * length * sin * 0.5F + v * width * cos * 0.5F,
				});
			}
			return corners;
		}

		void stroke(std::span<const Vec2> points, bool closed, Color color, float width, int32_t key) {
			Primitives::drawPolyline({
				.points = points,
				.width = width,
				.color = color,
				.cap = Primitives::LineCap::Round,
				.closed = closed,
				.key = key,
			});
		}

	} // namespace

	void EventPlate::describe(nlohmann::json& node) const {
		node["stopType"] = std::string(nameOf(rules::map::kStopTypeNames, stopType));
	}

	void EventPlate::render() {
		const ui::Theme& theme = getContext()->getTheme();
		const int32_t	 key = drawKey();
		const Color		 ink = theme.get(palette::ink);
		const Rect		 frame{0.0F, 0.0F, size.x, size.y};
		const float		 width = size.x;
		const float		 height = size.y;
		if (width <= 0.0F || height <= 0.0F) {
			return;
		}

		Primitives::pushClip(frame);
		Primitives::drawRect({.bounds = frame, .style = {.fill = theme.get(palette::paper)}, .id = "event_plate", .key = key});
		for (int line = 1; line <= kContours; ++line) {
			const float		  base = height * static_cast<float>(line) / static_cast<float>(kContours + 1);
			std::vector<Vec2> points;
			for (int step = 0; step <= kContourSteps; ++step) {
				const float x = width * static_cast<float>(step) / static_cast<float>(kContourSteps);
				points.push_back(
					{x, base + std::sin(static_cast<float>(step) * 0.55F + static_cast<float>(line) * 1.7F) * height * 0.035F}
				);
			}
			stroke(points, false, atlas::withAlpha(ink, 0.14F), 1.0F, key);
		}
		// The road, lower left to upper right, across the whole plate on its casing.
		const Vec2 from{-kCasing, height * 0.82F};
		const Vec2 to{width + kCasing, height * 0.3F};
		Primitives::drawLine({.start = from, .end = to, .style = {.color = theme.get(palette::casing), .width = kCasing}, .key = key});
		Primitives::drawLine({.start = from, .end = to, .style = {.color = theme.get(palette::highway), .width = kRoad}, .key = key});

		const float angle = std::atan2(to.y - from.y, to.x - from.x);
		const float scale = std::min(1.0F, std::min(width, height) / kDesignSide);
		const Vec2	middle{width * 0.5F, from.y + (to.y - from.y) * (width * 0.5F - from.x) / (to.x - from.x)};
		if (stopType == rules::map::StopType::Distress) {
			// On its side off the road, its people beside it, and the signal going out.
			const Vec2				normal{std::sin(angle), -std::cos(angle)};
			const float				off = 70.0F * scale;
			const Vec2				at{middle.x + normal.x * off, middle.y + normal.y * off};
			const std::vector<Vec2> body = box(at, angle + 0.4F, kVehicleLength * 0.85F * scale, kVehicleWidth * 0.85F * scale);
			Primitives::drawPolygon({.vertices = body, .style = {.fill = theme.get(palette::paper)}, .key = key});
			stroke(body, true, ink, 2.4F, key);
			for (int person = 0; person < 3; ++person) {
				Primitives::drawCircle({
					.center = {at.x + (static_cast<float>(person) * 14.0F - 30.0F) * scale, at.y + kVehicleWidth * 0.9F * scale},
					.radius = 4.0F * scale,
					.style = {.fill = ink},
					.key = key,
				});
			}
			for (const float ring : kRings) {
				std::vector<Vec2> arc;
				const float		  radius = (ring + kVehicleLength * 0.4F) * scale;
				for (int step = 0; step <= 12; ++step) {
					const float turn = -2.4F + 1.6F * static_cast<float>(step) / 12.0F;
					arc.push_back({at.x + std::cos(turn) * radius, at.y + std::sin(turn) * radius});
				}
				stroke(arc, false, theme.get(palette::stronghold), 1.8F, key);
			}
		} else {
			// Across both lanes, turned off the road's line, burnt out.
			const std::vector<Vec2> body = box(middle, angle + 1.1F, kVehicleLength * scale, kVehicleWidth * scale);
			Primitives::drawPolygon({.vertices = body, .style = {.fill = theme.get(palette::paper)}, .key = key});
			stroke(body, true, ink, 2.4F, key);
			stroke(std::array<Vec2, 2>{body[0], body[2]}, false, ink, 1.2F, key);
			stroke(std::array<Vec2, 2>{body[1], body[3]}, false, ink, 1.2F, key);
		}
		Primitives::popClip();

		// The plate's frame: a 1.6 px rule on its edge and a 0.6 px rule 4 px outside it.
		const auto rule = [&](const Rect& bounds, float line) {
			Primitives::drawRect({
				.bounds = bounds,
				.style =
					{.fill = kClear,
					 .border = Foundation::BorderStyle{.color = ink, .width = line, .position = Foundation::BorderPosition::Inside}},
				.key = key,
			});
		};
		rule(frame, 1.6F);
		rule({-4.6F, -4.6F, size.x + 9.2F, size.y + 9.2F}, 0.6F);
	}

	void JournalPage::onMount() {
		constexpr float kPadX = 18.0F;
		constexpr float kMargin = 12.0F;
		ui::Layout		layout = getLayout();
		layout.display = ui::Display::Flex;
		layout.flexDirection = ui::FlexDirection::Column;
		layout.alignItems = ui::AlignItems::Stretch;
		layout.gap = pitch;
		layout.padding = ui::Edges(pitch, kPadX, pitch, kPadX + kMargin);
		setLayout(layout);
	}

	void JournalPage::render() {
		constexpr float	 kPadX = 18.0F;
		constexpr float	 kMargin = 12.0F;
		constexpr float	 kRuleDrop = 0.82F;
		constexpr float	 kRuleInset = 6.0F;
		const ui::Theme& theme = getContext()->getTheme();
		const int32_t	 key = drawKey();
		const Color		 ink = theme.get(palette::ink);
		atlas::drawPaper({
			.bounds = {0.0F, 0.0F, size.x, size.y},
			.tint = theme.get(palette::paper),
			.look = look,
			.border = Foundation::BorderStyle{.color = ink, .width = 1.4F, .position = Foundation::BorderPosition::Inside},
			.id = getId().empty() ? nullptr : getId().c_str(),
			.key = key,
		});
		const Color rules = atlas::withAlpha(theme.get(palette::river), 0.28F);
		for (float y = pitch + pitch * kRuleDrop + 3.0F; y < size.y - pitch * 0.5F; y += pitch) {
			Primitives::drawRect(
				{.bounds = {kRuleInset, std::round(y), std::max(0.0F, size.x - 2.0F * kRuleInset), 1.0F},
				 .style = {.fill = rules},
				 .key = key}
			);
		}
		Primitives::drawRect({
			.bounds = {kPadX + kMargin * 0.5F - 1.0F, 1.4F, 1.2F, std::max(0.0F, size.y - 2.8F)},
			.style = {.fill = atlas::withAlpha(theme.get(palette::stronghold), 0.5F)},
			.key = key,
		});
	}

} // namespace game::event
