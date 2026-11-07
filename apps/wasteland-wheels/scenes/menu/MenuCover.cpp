#include "scenes/menu/MenuCover.h"

#include "atlas/ArtView.h"
#include "atlas/Ink.h"
#include "atlas/LegendBox.h"
#include "atlas/Markers.h"
#include "atlas/Tokens.h"
#include "cards/DeckStack.h"
#include "scenes/map/MapStyle.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>
#include <ui/shapes/Text.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <numbers>

namespace game {

	namespace {

		namespace palette = atlas::tokens::palette;
		namespace styles = atlas::styles::print;
		using Foundation::Vec2;

		// The cover's own space, the canvas's 640 by 840; every shape is built here once and mapped onto the box.
		constexpr float kWidth = 640.0F;
		constexpr float kHeight = 840.0F;
		// How far the torn sheet runs past the box.
		constexpr float kBleedTop = 10.0F;
		constexpr float kBleedBottom = 10.0F;
		constexpr float kBleedLeft = 6.0F;
		constexpr float kBleedRight = 12.0F;
		constexpr float kShadowBlur = 14.0F;
		constexpr float kShadowDrop = 12.0F;
		// The torn edge: points per side, its bites, and the grime band inside it (W2: 6% of the short side).
		constexpr int	kAcross = 40;
		constexpr int	kDown = 56;
		constexpr float kBite = 5.0F;
		constexpr float kWobble = 3.0F;
		constexpr float kBand = 0.06F * kWidth;
		constexpr float kTilt = -0.8F * std::numbers::pi_v<float> / 180.0F;
		constexpr float kDeckWidth = 76.0F;

		struct Notch {
			int	  edge;
			float at;
			float width;
			float depth;
		};

		// The bigger tears: a corner gone at the top right and the bottom left, and a few nicks.
		constexpr std::array<Notch, 6> kNotches{{
			{.edge = 0, .at = 0.97F, .width = 0.08F, .depth = 24.0F},
			{.edge = 1, .at = 0.03F, .width = 0.06F, .depth = 22.0F},
			{.edge = 1, .at = 0.53F, .width = 0.03F, .depth = 12.0F},
			{.edge = 2, .at = 0.6F, .width = 0.03F, .depth = 14.0F},
			{.edge = 2, .at = 0.96F, .width = 0.08F, .depth = 26.0F},
			{.edge = 3, .at = 0.08F, .width = 0.1F, .depth = 22.0F},
		}};

		class Scatter {
		  public:
			explicit Scatter(uint32_t seed)
				: state(seed) {}

			float next() {
				state ^= state << 13U;
				state ^= state >> 17U;
				state ^= state << 5U;
				return static_cast<float>(state % 100000U) / 100000.0F;
			}

		  private:
			uint32_t state;
		};

		// Side `edge`'s point `t` along it, clockwise from the top.
		Vec2 edgePoint(int edge, float t) {
			switch (edge) {
				case 0:
					return {t * kWidth, 0.0F};
				case 1:
					return {kWidth, t * kHeight};
				case 2:
					return {kWidth - t * kWidth, kHeight};
				default:
					return {0.0F, kHeight - t * kHeight};
			}
		}

		Vec2 towardMiddle(Vec2 point, float distance) {
			const Vec2	middle{kWidth * 0.5F, kHeight * 0.5F};
			const Vec2	away = point - middle;
			const float keep = 1.0F - distance / std::hypot(away.x, away.y);
			return middle + away * keep;
		}

		struct Ellipse {
			Vec2  centre;
			Vec2  radii;
			float turn = 0.0F;
			int	  steps = 32;
			float wobble = 0.0F;
		};

		std::vector<Vec2> ellipse(const Ellipse& shape) {
			constexpr float	  kKeep = kBand * 0.5F;
			std::vector<Vec2> points;
			const float		  cos = std::cos(shape.turn);
			const float		  sin = std::sin(shape.turn);
			for (int step = 0; step < shape.steps; ++step) {
				const float angle = 2.0F * std::numbers::pi_v<float> * static_cast<float>(step) / static_cast<float>(shape.steps);
				const float swell = 1.0F + shape.wobble * std::sin(angle * 3.0F + shape.centre.x * 0.01F);
				const float x = std::cos(angle) * shape.radii.x * swell;
				const float y = std::sin(angle) * shape.radii.y * swell;
				points.push_back({
					std::clamp(shape.centre.x + x * cos - y * sin, kKeep, kWidth - kKeep),
					std::clamp(shape.centre.y + x * sin + y * cos, kKeep, kHeight - kKeep),
				});
			}
			return points;
		}

		// A cubic run through `points`: start, then control, control, end per segment.
		std::vector<Vec2> cubic(std::initializer_list<Vec2> given) {
			const std::vector<Vec2> points(given);
			constexpr int			kSteps = 16;
			std::vector<Vec2>		out{points.front()};
			for (size_t index = 1; index + 2 < points.size(); index += 3) {
				const Vec2 p0 = points[index - 1];
				const Vec2 p1 = points[index];
				const Vec2 p2 = points[index + 1];
				const Vec2 p3 = points[index + 2];
				for (int step = 1; step <= kSteps; ++step) {
					const float t = static_cast<float>(step) / kSteps;
					const float u = 1.0F - t;
					out.push_back(p0 * (u * u * u) + p1 * (3.0F * u * u * t) + p2 * (3.0F * u * t * t) + p3 * (t * t * t));
				}
			}
			return out;
		}

		struct CoverShapes {
			std::vector<Vec2>				   outer;
			std::vector<Vec2>				   inner;
			std::vector<std::vector<Vec2>>	   relief; // nested rings, lowland then upland
			std::vector<std::vector<Vec2>>	   contours;
			std::vector<Vec2>				   toxic;
			std::vector<std::pair<Vec2, Vec2>> hatch;
			std::vector<Vec2>				   lake;
			std::vector<Vec2>				   river;
			std::vector<std::vector<Vec2>>	   backRoads;
			std::vector<std::vector<Vec2>>	   highways;
		};

		constexpr Vec2	kHome{320.0F, 444.0F};
		constexpr Vec2	kScale{26.0F, 768.0F};
		constexpr int	kReliefRings = 4;
		constexpr Vec2	kToxicCentre{470.0F, 551.0F};
		constexpr Vec2	kToxicRadii{100.0F, 58.0F};
		constexpr float kToxicTurn = 0.42F;

		// Diagonal chords across the contaminated ellipse, 10 apart, at 45 degrees on the page.
		std::vector<std::pair<Vec2, Vec2>> hatchChords() {
			std::vector<std::pair<Vec2, Vec2>> chords;
			const float						   cos = std::cos(kToxicTurn);
			const float						   sin = std::sin(kToxicTurn);
			const float						   along = std::numbers::pi_v<float> / 4.0F - kToxicTurn;
			const Vec2						   d{std::cos(along), std::sin(along)};
			const Vec2						   n{-d.y, d.x};
			const Vec2						   r = kToxicRadii;
			const float						   reach = std::max(r.x, r.y);
			for (float offset = -reach; offset <= reach; offset += 10.0F) {
				const Vec2	o = n * offset;
				const float a = d.x * d.x / (r.x * r.x) + d.y * d.y / (r.y * r.y);
				const float b = 2.0F * (o.x * d.x / (r.x * r.x) + o.y * d.y / (r.y * r.y));
				const float c = o.x * o.x / (r.x * r.x) + o.y * o.y / (r.y * r.y) - 1.0F;
				const float disc = b * b - 4.0F * a * c;
				if (disc <= 0.0F) {
					continue;
				}
				const float root = std::sqrt(disc);
				const auto	end = [&](float t) {
					 const Vec2 local = o + d * t;
					 return Vec2{kToxicCentre.x + local.x * cos - local.y * sin, kToxicCentre.y + local.x * sin + local.y * cos};
				};
				chords.emplace_back(end((-b - root) / (2.0F * a)), end((-b + root) / (2.0F * a)));
			}
			return chords;
		}

		const CoverShapes& shapes() {
			static const CoverShapes kShapes = [] {
				CoverShapes			 made;
				Scatter				 scatter(0x0c0e5U);
				std::vector<float>	 depths;
				std::vector<Vec2>	 edges;
				std::array<float, 4> phase{};
				for (float& start : phase) {
					start = scatter.next() * 6.0F;
				}
				for (int edge = 0; edge < 4; ++edge) {
					const int count = edge % 2 == 0 ? kAcross : kDown;
					for (int step = 0; step < count; ++step) {
						const float t = static_cast<float>(step) / static_cast<float>(count);
						float		depth =
							scatter.next() * kBite + (std::sin(t * 9.0F + phase.at(static_cast<size_t>(edge))) + 1.0F) * 0.5F * kWobble;
						for (const Notch& notch : kNotches) {
							if (notch.edge != edge) {
								continue;
							}
							const float across = (t - notch.at) / notch.width;
							if (std::abs(across) < 1.0F) {
								depth += notch.depth * (1.0F - across * across) * (0.75F + scatter.next() * 0.25F);
							}
						}
						edges.push_back(edgePoint(edge, t));
						depths.push_back(depth);
					}
				}
				for (size_t index = 0; index < edges.size(); ++index) {
					made.outer.push_back(towardMiddle(edges[index], depths[index]));
					made.inner.push_back(towardMiddle(edges[index], depths[index] + kBand));
				}
				for (const auto& [centre, radii] :
					 {std::pair{Vec2{140.0F, 644.0F}, Vec2{230.0F, 160.0F}}, std::pair{Vec2{500.0F, 204.0F}, Vec2{230.0F, 150.0F}}}) {
					for (int ring = 0; ring < kReliefRings; ++ring) {
						const float share = 1.0F - 0.22F * static_cast<float>(ring);
						made.relief.push_back(ellipse({.centre = centre, .radii = radii * share, .steps = 28}));
					}
				}
				for (const float radius : {74.0F, 50.0F, 28.0F}) {
					made.contours.push_back(ellipse(
						{.centre = {128.0F, 470.0F}, .radii = {radius, radius * 0.62F}, .turn = -0.3F, .steps = 40, .wobble = 0.08F}
					));
				}
				made.toxic = ellipse({.centre = kToxicCentre, .radii = kToxicRadii, .turn = kToxicTurn, .wobble = 0.04F});
				made.hatch = hatchChords();
				made.lake = ellipse({.centre = {140.0F, 754.0F}, .radii = {84.0F, 34.0F}, .turn = 0.06F, .wobble = 0.05F});
				made.river = cubic({{8, 322}, {120, 304}, {220, 364}, {320, 384}, {420, 404}, {520, 444}, {632, 425}});
				made.highways = {
					cubic({{8, 543}, {120, 524}, {240, 474}, {320, 444}, {400, 414}, {520, 324}, {632, 281}}),
					cubic({{320, 444}, {310, 564}, {330, 684}, {358, 806}}),
				};
				made.backRoads = {
					cubic({{320, 444}, {400, 494}, {460, 544}, {520, 624}}),
					cubic({{320, 444}, {260, 494}, {200, 544}, {120, 584}}),
					cubic({{320, 444}, {330, 364}, {360, 304}, {420, 244}}),
				};
				return made;
			}();
			return kShapes;
		}

		Foundation::Color tone(mapstyle::Rgb8 colour, float alpha) {
			return mapstyle::rgb(colour, alpha);
		}

	} // namespace

	float MenuCover::inkExtent() const {
		return std::max(kBleedRight, kBleedTop) + kShadowBlur + kShadowDrop;
	}

	void MenuCover::onMount() {
		setTransform({.rotate = kTilt});
		const ui::Theme& theme = getContext()->getTheme();

		// The logo in its cartouche at the cover's head.
		ui::Ref<atlas::LegendBox> cartouche = addChild<atlas::LegendBox>({
			.id = "cartouche",
			.layout =
				[] {
					ui::Layout layout{
						.display = ui::Display::Flex,
						.flexDirection = ui::FlexDirection::Column,
						.gap = 6.0F,
						.alignItems = ui::AlignItems::Center
					};
					layout.padding = ui::Edges(14.0F, 18.0F, 12.0F, 18.0F);
					layout.position = ui::Position::Absolute;
					layout.inset = {.top = ui::percent(4.0F), .right = ui::percent(6.0F), .left = ui::percent(6.0F)};
					return layout;
				}(),
			.style = {.backgroundColor = theme.get(palette::freshPaper)},
			.look = {.seed = atlas::paperSeed("main_menu/cartouche"), .wear = atlas::Wear::Clean},
		});
		cartouche.addChild<ui::Text>({
			.id = "cover_kicker",
			.style = styles::kicker.extend(
				{.textAlign = Foundation::HorizontalAlign::Center,
				 .letterSpacing = 3.0F,
				 .textTransform = Foundation::TextTransform::Uppercase}
			),
			.text = "A road atlas of the Halcyon region",
			.wrap = true,
		});
		cartouche.addChild<atlas::ArtView>({.id = "logo", .size = {ui::percent(100.0F), ui::kAuto}, .art = "logo"});
		cartouche.addChild<ui::Text>(
			{.id = "cover_edition",
			 .style = styles::note.extend({.textAlign = Foundation::HorizontalAlign::Center}),
			 .text = "fourth edition, revised after"}
		);

		// The scale's label, with the paper halo of a label on the map.
		addChild<ui::Text>({
			.id = "cover_scale",
			.layout = {.position = ui::Position::Absolute, .inset = {.bottom = ui::percent(7.4F), .left = ui::percent(16.2F)}},
			.style = styles::kicker.extend({.color = theme.get(palette::ink), .textShadow = atlas::paperHalo(theme.get(palette::paper))}),
			.text = "0 \xC2\xB7 20 mi",
		});

		// The two decks set down on the map's lower right, B over A.
		const auto deck = [&](int seat, float right, float bottom, float turn) {
			addChild<cards::DeckStack>({
				.id = seat == 0 ? "deck_a" : "deck_b",
				.size = {kDeckWidth, ui::kAuto},
				.transform = {.rotate = turn * std::numbers::pi_v<float> / 180.0F},
				.layout = {.position = ui::Position::Absolute, .inset = {.right = ui::percent(right), .bottom = ui::percent(bottom)}},
				.seat = seat,
				.width = kDeckWidth,
				.under = seat == 0 ? 3 : 4,
			});
		};
		deck(0, 21.0F, 9.0F, -9.0F);
		deck(1, 7.0F, 5.0F, 8.0F);
	}

	void MenuCover::place() {
		placedFor = size;
		const Foundation::Rect sheet{-kBleedLeft, -kBleedTop, size.x + kBleedLeft + kBleedRight, size.y + kBleedTop + kBleedBottom};
		const auto			   map = [&](Vec2 point) {
			return Vec2{sheet.x + point.x / kWidth * sheet.width, sheet.y + point.y / kHeight * sheet.height};
		};
		const auto mapAll = [&](const std::vector<Vec2>& points) {
			std::vector<Vec2> out;
			out.reserve(points.size());
			for (const Vec2 point : points) {
				out.push_back(map(point));
			}
			return out;
		};
		const auto mapEach = [&](const std::vector<std::vector<Vec2>>& lines) {
			std::vector<std::vector<Vec2>> out;
			for (const std::vector<Vec2>& line : lines) {
				out.push_back(mapAll(line));
			}
			return out;
		};
		const CoverShapes& made = shapes();
		rim = mapAll(made.outer);
		band = rim;
		const std::vector<Vec2> inner = mapAll(made.inner);
		band.insert(band.end(), inner.begin(), inner.end());
		const auto count = static_cast<uint16_t>(rim.size());
		bandIndices.clear();
		for (uint16_t index = 0; index < count; ++index) {
			const auto next = static_cast<uint16_t>((index + 1) % count);
			bandIndices.insert(
				bandIndices.end(),
				{index,
				 next,
				 static_cast<uint16_t>(count + next),
				 index,
				 static_cast<uint16_t>(count + next),
				 static_cast<uint16_t>(count + index)}
			);
		}
		relief = mapEach(made.relief);
		contours = mapEach(made.contours);
		toxic = mapAll(made.toxic);
		hatch.clear();
		for (const auto& [from, to] : made.hatch) {
			hatch.emplace_back(map(from), map(to));
		}
		lake = mapAll(made.lake);
		river = mapAll(made.river);
		backRoads = mapEach(made.backRoads);
		highways = mapEach(made.highways);
		home = map(kHome);
		scaleAt = map(kScale);
	}

	void MenuCover::render() {
		if (size != placedFor) {
			place();
		}
		const ui::Theme& theme = getContext()->getTheme();
		const float		 alpha = opacity();
		const int32_t	 key = drawKey();
		const auto		 ink = [&](ui::ColorToken token, float share = 1.0F) {
			  return atlas::withAlpha(theme.get(token), alpha * share);
		};
		const float lines = std::clamp(size.x / kWidth, 0.8F, 1.4F);

		Renderer::Primitives::drawPolygon({
			.vertices = rim,
			.style =
				{.fill = tone(mapstyle::kLandDry, alpha),
				 .shadow = Foundation::BoxShadow{.color = ink(palette::shadow, 0.7F), .blur = kShadowBlur, .offset = {0.0F, kShadowDrop}}},
			.key = key,
		});
		for (size_t index = 0; index < relief.size(); ++index) {
			const bool lowland = index < static_cast<size_t>(kReliefRings);
			Renderer::Primitives::drawPolygon({
				.vertices = relief[index],
				.style =
					{.fill = lowland ? tone(mapstyle::kLandWet, 0.85F * alpha / kReliefRings)
									 : tone(mapstyle::kLandHigh, 0.9F * alpha / kReliefRings)},
				.key = key,
			});
		}
		// The grime band inside the torn edge, aged brown fading inward.
		const Foundation::Color grime{107.0F / 255.0F, 74.0F / 255.0F, 34.0F / 255.0F, 0.3F * alpha};
		bandColors.assign(band.size(), Foundation::Color(grime.r, grime.g, grime.b, 0.0F));
		std::fill(bandColors.begin(), bandColors.begin() + static_cast<std::ptrdiff_t>(rim.size()), grime);
		Renderer::Primitives::drawTriangles({
			.vertices = band.data(),
			.indices = bandIndices.data(),
			.vertexCount = band.size(),
			.indexCount = bandIndices.size(),
			.colors = bandColors.data(),
			.key = key,
		});
		for (const std::vector<Vec2>& ring : contours) {
			Renderer::Primitives::drawPolyline(
				{.points = ring, .width = lines, .color = ink(palette::inkDim, 0.22F), .closed = true, .key = key}
			);
		}
		Renderer::Primitives::drawPolygon({.vertices = toxic, .style = {.fill = ink(palette::rustHatch, 0.1F)}, .key = key});
		for (const auto& [from, to] : hatch) {
			Renderer::Primitives::drawLine(
				{.start = from, .end = to, .style = {.color = ink(palette::rustHatch, 0.5F), .width = lines}, .key = key}
			);
		}
		Renderer::Primitives::drawPolygon({
			.vertices = lake,
			.style = {.fill = ink(palette::riverDim), .border = Foundation::LineStyle{.color = ink(palette::river, 0.7F), .width = 1.2F}},
			.key = key,
		});
		Renderer::Primitives::drawPolyline({.points = river, .width = 2.4F * lines, .color = ink(palette::riverBright), .key = key});
		for (const std::vector<Vec2>& road : backRoads) {
			Renderer::Primitives::drawPolyline({.points = road, .width = 1.4F * lines, .color = ink(palette::backRoad, 0.8F), .key = key});
		}
		for (const std::vector<Vec2>& road : highways) {
			Renderer::Primitives::drawPolyline({.points = road, .width = 6.0F * lines, .color = ink(palette::casing), .key = key});
		}
		for (const std::vector<Vec2>& road : highways) {
			Renderer::Primitives::drawPolyline({.points = road, .width = 3.6F * lines, .color = ink(palette::highway), .key = key});
		}
		Renderer::Primitives::drawCircle({
			.center = home,
			.radius = 30.0F * lines,
			.style = {.fill = ink(palette::builtUp), .border = Foundation::BorderStyle{.color = ink(palette::ink, 0.3F), .width = 1.0F}},
			.key = key,
		});
		atlas::drawStar(home, 13.0F * lines, ink(palette::ink), std::nullopt, key);

		// The scale: three segments, ink, paper, ink, in an ink frame.
		const float segment = 34.0F * lines;
		const float height = 6.0F;
		for (int index = 0; index < 3; ++index) {
			Renderer::Primitives::drawRect({
				.bounds = {scaleAt.x + segment * static_cast<float>(index), scaleAt.y, segment, height},
				.style =
					{.fill = index == 1 ? ink(palette::paper) : ink(palette::ink),
					 .border =
						 Foundation::BorderStyle{
							 .color = ink(palette::ink), .width = 1.0F, .position = Foundation::BorderPosition::Inside
						 }},
				.key = key,
			});
		}
	}

} // namespace game
