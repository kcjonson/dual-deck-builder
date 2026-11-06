#include "cards/CardBack.h"

#include "atlas/Art.h"
#include "atlas/Ink.h"
#include "atlas/Tokens.h"
#include "cards/CardStyle.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>
#include <utils/Log.h>
#include <vector/SVGLoader.h>
#include <vector/Types.h>

#include <nlohmann/json.hpp>

#include <glm/gtc/matrix_transform.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <numbers>
#include <vector>

namespace game::cards {

	namespace {

		namespace palette = atlas::tokens::palette;

		constexpr const char* kMarkArt = "mark-small";
		// The mark's two paints, which deck B's back takes in its own colours.
		constexpr Foundation::Color kMarkHighway = hex(0xD86036);
		constexpr Foundation::Color kMarkCasing = hex(0x682C1E);
		constexpr int				kContours = 5;
		constexpr int				kContourPoints = 48;

		struct MarkArt {
			renderer::TessellatedMesh mesh;
			Foundation::Vec2		  size{0.0F, 0.0F};
		};

		// Embedded (salal_art), loaded and tessellated on first use in the SVG's own units; empty, logged, if it doesn't load.
		const std::optional<MarkArt>& markArt() {
			static const std::optional<MarkArt> kArt = []() -> std::optional<MarkArt> {
				std::vector<renderer::LoadedSVGShape> shapes;
				if (!renderer::loadSVG(art::art(kMarkArt), 0.5F, shapes, kMarkArt) || shapes.empty()) {
					LOG_ERROR(Game, "The small mark %s didn't load; card backs draw without it", kMarkArt);
					return std::nullopt;
				}
				MarkArt mark;
				for (const renderer::LoadedSVGShape& shape : shapes) {
					renderer::appendShapeMesh(shape, mark.mesh);
					mark.size = {shape.width, shape.height};
				}
				return mark;
			}();
			return kArt;
		}

		bool near(Foundation::Color a, Foundation::Color b) {
			constexpr float kTolerance = 0.02F;
			return std::abs(a.r - b.r) < kTolerance && std::abs(a.g - b.g) < kTolerance && std::abs(a.b - b.b) < kTolerance;
		}

		void drawMark(
			const MarkArt&			art,
			const Foundation::Rect& box,
			Foundation::Color		highway,
			Foundation::Color		casing,
			float					alpha,
			int32_t					key
		) {
			std::vector<Foundation::Color> colors = art.mesh.colors;
			for (Foundation::Color& color : colors) {
				if (near(color, kMarkHighway)) {
					color = {highway.r, highway.g, highway.b, color.a};
				} else if (near(color, kMarkCasing)) {
					color = {casing.r, casing.g, casing.b, color.a};
				}
				color.a *= alpha;
			}
			const float scale = box.height / art.size.y;
			glm::mat4	place = glm::translate(glm::mat4(1.0F), glm::vec3(box.x + (box.width - art.size.x * scale) * 0.5F, box.y, 0.0F));
			place = glm::scale(place, glm::vec3(scale, scale, 1.0F));
			Renderer::Primitives::PushTransform(place);
			Renderer::Primitives::drawTriangles({
				.vertices = art.mesh.vertices.data(),
				.indices = art.mesh.indices.data(),
				.vertexCount = art.mesh.vertices.size(),
				.indexCount = art.mesh.indices.size(),
				.colors = colors.data(),
				.id = "card_back_mark",
				.key = key,
				.antiAlias = true,
			});
			Renderer::Primitives::PopTransform();
		}

		// Faint contour lines round a hill under the mark, the same on every back: closed wobbling loops, nested.
		void drawContours(Foundation::Vec2 size, float scale, Foundation::Color ink, int32_t key) {
			const Foundation::Vec2						 centre{size.x * 0.5F, size.y * 0.53F};
			std::array<Foundation::Vec2, kContourPoints> points{};
			for (int ring = 0; ring < kContours; ++ring) {
				const float reach = (0.11F + 0.055F * static_cast<float>(ring)) * size.x;
				for (int index = 0; index < kContourPoints; ++index) {
					const float turn = 2.0F * std::numbers::pi_v<float> * static_cast<float>(index) / kContourPoints;
					const float wobble = 1.0F + 0.08F * std::sin(3.0F * turn + static_cast<float>(ring)) +
										 0.05F * std::sin(5.0F * turn + 2.0F * static_cast<float>(ring));
					points.at(static_cast<size_t>(index)) = {
						centre.x + std::cos(turn) * reach * wobble,
						centre.y + std::sin(turn) * reach * wobble * 1.3F,
					};
				}
				Renderer::Primitives::drawPolyline(
					{.points = points, .width = std::max(0.6F, 0.7F * scale), .color = ink, .closed = true, .key = key}
				);
			}
		}

	} // namespace

	CardBack::CardBack(const Args& args)
		: deck(args.seat),
		  width(args.width),
		  look{.seed = atlas::paperSeed(args.seat == 0 ? "card-back/a" : "card-back/b"), .wear = atlas::Wear::Handled} {}

	float CardBack::heightFor(float width) {
		return width * back::kHeight / back::kWidth;
	}

	bool CardBack::markLoaded() {
		return markArt().has_value();
	}

	void CardBack::describe(nlohmann::json& node) const {
		node["deck"] = deck == 0 ? "a" : "b";
	}

	std::optional<Foundation::Vec2> CardBack::intrinsicSize(std::optional<float> boxWidth, float /*availableWidth*/) const {
		const float shown = boxWidth.value_or(width);
		return Foundation::Vec2{shown, heightFor(shown)};
	}

	void CardBack::render() {
		const ui::Theme& theme = getContext()->getTheme();
		const float		 alpha = opacity();
		const int32_t	 key = drawKey();
		const float		 scale = size.x / back::kWidth;
		const bool		 first = deck == 0;
		const auto		 ink = [&](ui::ColorToken token) {
			  return atlas::withAlpha(theme.get(token), alpha);
		};
		const auto inset = [&](float by) {
			return Foundation::Rect{by * scale, by * scale, size.x - by * scale * 2.0F, size.y - by * scale * 2.0F};
		};
		const Foundation::Color fill = ink(first ? palette::highway : palette::routeTeal);
		const Foundation::Color casing = ink(first ? palette::casing : palette::routeTealCasing);

		atlas::drawPaper({
			.bounds = {0.0F, 0.0F, size.x, size.y},
			.tint = ink(palette::paper),
			.look = look,
			.border =
				Foundation::BorderStyle{
					.color = ink(palette::ink),
					.width = back::kEdge * scale,
					.cornerRadius = back::kRadius * scale,
					.position = Foundation::BorderPosition::Inside,
				},
			.id = getId().empty() ? nullptr : getId().c_str(),
			.key = key,
		});
		Renderer::Primitives::drawRect({
			.bounds = inset(back::kBandInset),
			.style =
				{.fill = fill,
				 .border =
					 Foundation::BorderStyle{
						 .color = casing,
						 .width = back::kBandStroke * scale,
						 .cornerRadius = back::kBandRadius * scale,
						 .position = Foundation::BorderPosition::Inside,
					 }},
			.key = key,
		});
		Renderer::Primitives::drawRect({
			.bounds = inset(back::kInnerInset),
			.style =
				{.fill = ink(palette::paper), .border = Foundation::BorderStyle{.width = 0.0F, .cornerRadius = back::kInnerRadius * scale}},
			.key = key,
		});
		Renderer::Primitives::drawRect({
			.bounds = inset(back::kRuleInset),
			.style =
				{.fill = {0.0F, 0.0F, 0.0F, 0.0F},
				 .border =
					 Foundation::BorderStyle{
						 .color = casing, .width = std::max(0.6F, back::kRuleStroke * scale), .position = Foundation::BorderPosition::Inside
					 }},
			.key = key,
		});
		drawContours(size, scale, atlas::withAlpha(ink(palette::ink), 0.12F), key);
		if (const std::optional<MarkArt>& mark = markArt()) {
			const float height = back::kMarkHeight * scale;
			drawMark(*mark, {0.0F, (size.y - height) * 0.5F, size.x, height}, fill, casing, alpha, key);
		}
	}

} // namespace game::cards
