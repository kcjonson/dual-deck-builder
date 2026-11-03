#include "atlas/Sheet.h"

#include "atlas/Art.h"
#include "atlas/Ink.h"
#include "atlas/Tokens.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>
#include <utils/Log.h>
#include <vector/SVGLoader.h>
#include <vector/Types.h>

#include <glm/gtc/matrix_transform.hpp>

#include <array>
#include <numbers>
#include <optional>
#include <vector>

namespace game::atlas {

	namespace {

		namespace palette = tokens::palette;

		constexpr const char* kTapeArt = "tape";
		// The neatline (UI Art Direction, Components): 0.6 px outer and 1.6 px inner, 8 px apart, 18 px in from the sheet's edge.
		constexpr float kNeatlineInset = 18.0F;
		constexpr float kNeatlineGap = 8.0F;
		constexpr float kOuterRule = 0.6F;
		constexpr float kInnerRule = 1.6F;
		// The tape's centre from its corner of the sheet, and its turn, from the canvas mock.
		constexpr Foundation::Vec2 kTapeTopLeft{24.0F, 7.0F};
		constexpr Foundation::Vec2 kTapeBottomRight{-20.0F, -11.0F};
		constexpr float			   kTapeTurn = -34.0F * std::numbers::pi_v<float> / 180.0F;

		struct TapeArt {
			renderer::TessellatedMesh mesh;
			Foundation::Vec2		  size{0.0F, 0.0F};
		};

		// Embedded (salal_art), loaded and tessellated on first use, in the SVG's own units; empty, logged, if it doesn't load.
		const std::optional<TapeArt>& tapeArt() {
			static const std::optional<TapeArt> kArt = []() -> std::optional<TapeArt> {
				std::vector<renderer::LoadedSVGShape> shapes;
				if (!renderer::loadSVG(art::art(kTapeArt), 0.5F, shapes, kTapeArt) || shapes.empty()) {
					LOG_ERROR(Game, "The tape art %s didn't load; the sheet draws without tape", kTapeArt);
					return std::nullopt;
				}
				TapeArt tape;
				for (const renderer::LoadedSVGShape& shape : shapes) {
					renderer::appendShapeMesh(shape, tape.mesh);
					tape.size = {shape.width, shape.height};
				}
				return tape;
			}();
			return kArt;
		}

		void drawTape(const TapeArt& art, Foundation::Vec2 centre, float opacity, int32_t key) {
			std::vector<Foundation::Color> faded;
			if (opacity < 1.0F) {
				faded = art.mesh.colors;
				for (Foundation::Color& color : faded) {
					color.a *= opacity;
				}
			}
			glm::mat4 place = glm::translate(glm::mat4(1.0F), glm::vec3(centre.x, centre.y, 0.0F));
			place = glm::rotate(place, kTapeTurn, glm::vec3(0.0F, 0.0F, 1.0F));
			place = glm::translate(place, glm::vec3(-art.size.x * 0.5F, -art.size.y * 0.5F, 0.0F));
			Renderer::Primitives::PushTransform(place);
			Renderer::Primitives::drawTriangles({
				.vertices = art.mesh.vertices.data(),
				.indices = art.mesh.indices.data(),
				.vertexCount = art.mesh.vertices.size(),
				.indexCount = art.mesh.indices.size(),
				.colors = faded.empty() ? art.mesh.colors.data() : faded.data(),
				.id = "tape",
				.key = key,
				.antiAlias = true,
			});
			Renderer::Primitives::PopTransform();
		}

	} // namespace

	Sheet::Sheet(const Args& args)
		: look{.seed = paperSeed(args.identity), .wear = Wear::Worn, .folds = 2} {}

	bool Sheet::tapeLoaded() {
		return tapeArt().has_value();
	}

	void Sheet::render() {
		const ui::Theme& theme = getContext()->getTheme();
		const float		 alpha = opacity();
		const float		 margin = theme.get(tokens::sheet::margin);
		const int32_t	 key = drawKey();

		Renderer::Primitives::drawRect(
			{.bounds = {0.0F, 0.0F, size.x, size.y}, .style = {.fill = withAlpha(theme.get(palette::table), alpha)}, .key = key}
		);
		const Foundation::Rect sheet{margin, margin, size.x - 2.0F * margin, size.y - 2.0F * margin};
		Renderer::Primitives::drawRect({
			.bounds = sheet,
			.style =
				{.fill = withAlpha(theme.get(palette::sheet), alpha),
				 .boxShadow =
					 Foundation::BoxShadow{.color = withAlpha(theme.get(palette::shadow), alpha), .blur = 30.0F, .offset = {0.0F, 10.0F}}},
			.key = key,
		});
		drawPaper({.bounds = sheet, .tint = withAlpha(theme.get(palette::sheet), alpha), .look = look, .id = "sheet", .key = key});

		const Foundation::Color						 ink = withAlpha(theme.get(palette::ink), alpha);
		const std::array<std::pair<float, float>, 2> rules{{{kNeatlineInset, kOuterRule}, {kNeatlineInset + kNeatlineGap, kInnerRule}}};
		for (const auto& [inset, width] : rules) {
			Renderer::Primitives::drawRect({
				.bounds = {sheet.x + inset, sheet.y + inset, sheet.width - 2.0F * inset, sheet.height - 2.0F * inset},
				.style =
					{.fill = Foundation::Color(0.0F, 0.0F, 0.0F, 0.0F),
					 .border = Foundation::BorderStyle{.color = ink, .width = width, .position = Foundation::BorderPosition::Center}},
				.key = key,
			});
		}

		if (const std::optional<TapeArt>& tape = tapeArt()) {
			drawTape(*tape, {sheet.x + kTapeTopLeft.x, sheet.y + kTapeTopLeft.y}, alpha, key);
			drawTape(*tape, {sheet.x + sheet.width + kTapeBottomRight.x, sheet.y + sheet.height + kTapeBottomRight.y}, alpha, key);
		}
	}

} // namespace game::atlas
