#include "atlas/ArtView.h"

#include "atlas/Art.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>
#include <utils/Log.h>
#include <vector/SVGLoader.h>

#include <glm/gtc/matrix_transform.hpp>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <functional>
#include <limits>
#include <map>
#include <string>

namespace game::atlas {

	namespace {

		// Curves flattened to a quarter of an SVG unit, so art drawn up to twice its size stays within half a pixel.
		constexpr float	 kCurveTolerance = 0.25F;
		constexpr size_t kChunkVertices = std::numeric_limits<uint16_t>::max();

		void append(const renderer::TessellatedMesh& piece, renderer::TessellatedMesh& chunk) {
			const auto base = static_cast<uint16_t>(chunk.vertices.size());
			chunk.vertices.insert(chunk.vertices.end(), piece.vertices.begin(), piece.vertices.end());
			chunk.colors.insert(chunk.colors.end(), piece.colors.begin(), piece.colors.end());
			for (const uint16_t index : piece.indices) {
				chunk.indices.push_back(static_cast<uint16_t>(base + index));
			}
		}

		// A shape's fill and stroke tessellated apart, so either one failing is caught: appendShapeMesh only warns.
		bool tessellate(const renderer::LoadedSVGShape& shape, renderer::TessellatedMesh& piece) {
			renderer::LoadedSVGShape part = shape;
			if (shape.hasFill) {
				part.hasStroke = false;
				renderer::appendShapeMesh(part, piece);
				if (piece.indices.empty()) {
					return false;
				}
			}
			if (shape.hasStroke) {
				const size_t before = piece.indices.size();
				part.hasFill = false;
				part.hasStroke = true;
				renderer::appendShapeMesh(part, piece);
				if (piece.indices.size() == before) {
					return false;
				}
			}
			return true;
		}

		std::optional<ArtMesh> load(const std::string& name) {
			const std::span<const std::byte> svg = art::art(name);
			if (svg.empty()) {
				LOG_ERROR(Game, "No art is embedded as %s", name.c_str());
				return std::nullopt;
			}
			std::vector<renderer::LoadedSVGShape> shapes;
			if (!renderer::loadSVG(svg, kCurveTolerance, shapes, name) || shapes.empty()) {
				LOG_ERROR(Game, "The art %s didn't load", name.c_str());
				return std::nullopt;
			}
			ArtMesh mesh{.size = {shapes.front().width, shapes.front().height}};
			mesh.chunks.emplace_back();
			for (size_t i = 0; i < shapes.size(); ++i) {
				renderer::TessellatedMesh piece;
				if (!tessellate(shapes[i], piece)) {
					LOG_ERROR(Game, "Shape %zu of the art %s didn't tessellate", i, name.c_str());
					return std::nullopt;
				}
				if (mesh.chunks.back().vertices.size() + piece.vertices.size() > kChunkVertices) {
					mesh.chunks.emplace_back();
				}
				append(piece, mesh.chunks.back());
			}
			Foundation::Vec2 low{std::numeric_limits<float>::max()};
			Foundation::Vec2 high{std::numeric_limits<float>::lowest()};
			for (const renderer::TessellatedMesh& chunk : mesh.chunks) {
				for (const Foundation::Vec2& vertex : chunk.vertices) {
					low = glm::min(low, vertex);
					high = glm::max(high, vertex);
				}
			}
			mesh.bounds = {low.x, low.y, high.x - low.x, high.y - low.y};
			return mesh;
		}

		// The art's box in the rect: its scale and its top left.
		struct Placement {
			Foundation::Vec2 scale;
			Foundation::Vec2 origin;
		};

		Placement place(const ArtMesh& mesh, const Foundation::Rect& rect, ArtFit fit) {
			Foundation::Vec2 scale{rect.width / mesh.size.x, rect.height / mesh.size.y};
			if (fit == ArtFit::Contain) {
				scale = Foundation::Vec2{std::min(scale.x, scale.y)};
			}
			const Foundation::Vec2 drawn = mesh.size * scale;
			return {.scale = scale, .origin = {rect.x + (rect.width - drawn.x) * 0.5F, rect.y + (rect.height - drawn.y) * 0.5F}};
		}

	} // namespace

	const ArtMesh* artMesh(std::string_view name) {
		static std::map<std::string, std::optional<ArtMesh>, std::less<>> loaded;
		auto															  found = loaded.find(name);
		if (found == loaded.end()) {
			std::string key(name);
			found = loaded.emplace(key, load(key)).first;
		}
		return found->second ? &*found->second : nullptr;
	}

	bool drawArt(const ArtDraw& art) {
		const ArtMesh* mesh = artMesh(art.name);
		if (mesh == nullptr) {
			return false;
		}
		if (art.bounds.width <= 0.0F || art.bounds.height <= 0.0F || art.opacity <= 0.0F) {
			return true;
		}
		const Placement		   placement = place(*mesh, art.bounds, art.fit);
		const Foundation::Vec2 centre{art.bounds.x + art.bounds.width * 0.5F, art.bounds.y + art.bounds.height * 0.5F};
		glm::mat4			   transform = glm::translate(glm::mat4(1.0F), glm::vec3(centre, 0.0F));
		transform = glm::rotate(transform, art.turn, glm::vec3(0.0F, 0.0F, 1.0F));
		transform = glm::translate(transform, glm::vec3(placement.origin - centre, 0.0F));
		transform = glm::scale(transform, glm::vec3(placement.scale, 1.0F));

		static std::vector<Foundation::Color> recoloured;
		const bool							  recolour = art.tint.has_value() || art.opacity < 1.0F;
		Renderer::Primitives::PushTransform(transform);
		for (const renderer::TessellatedMesh& chunk : mesh->chunks) {
			if (recolour) {
				recoloured.resize(chunk.colors.size());
				for (size_t i = 0; i < chunk.colors.size(); ++i) {
					Foundation::Color color = art.tint.value_or(chunk.colors[i]);
					color.a = chunk.colors[i].a * (art.tint ? art.tint->a : 1.0F) * art.opacity;
					recoloured[i] = color;
				}
			}
			Renderer::Primitives::drawTriangles({
				.vertices = chunk.vertices.data(),
				.indices = chunk.indices.data(),
				.vertexCount = chunk.vertices.size(),
				.indexCount = chunk.indices.size(),
				.colors = recolour ? recoloured.data() : chunk.colors.data(),
				.id = "art",
				.key = art.key,
				.antiAlias = true,
			});
		}
		Renderer::Primitives::PopTransform();
		return true;
	}

	float ArtView::inkExtent() const {
		const ArtMesh* mesh = artMesh(art);
		if (mesh == nullptr || size.x <= 0.0F || size.y <= 0.0F) {
			return 0.0F;
		}
		const Placement		   placement = place(*mesh, {0.0F, 0.0F, size.x, size.y}, fit);
		const Foundation::Vec2 low = placement.origin + Foundation::Vec2{mesh->bounds.x, mesh->bounds.y} * placement.scale;
		const Foundation::Vec2 high =
			placement.origin +
			Foundation::Vec2{mesh->bounds.x + mesh->bounds.width, mesh->bounds.y + mesh->bounds.height} * placement.scale;
		return std::max({0.0F, -low.x, -low.y, high.x - size.x, high.y - size.y});
	}

	void ArtView::describe(nlohmann::json& node) const {
		node["art"] = art;
		node["fit"] = fit == ArtFit::Contain ? "contain" : "stretch";
	}

	void ArtView::render() {
		std::optional<Foundation::Color> colour;
		if (tint) {
			colour = getContext()->getTheme().get(*tint);
		}
		drawArt({.name = art, .bounds = {0.0F, 0.0F, size.x, size.y}, .fit = fit, .tint = colour, .opacity = opacity(), .key = drawKey()});
	}

	std::optional<Foundation::Vec2> ArtView::intrinsicSize(std::optional<float> width, float /*availableWidth*/) const {
		const ArtMesh* mesh = artMesh(art);
		if (mesh == nullptr) {
			return Foundation::Vec2{0.0F, 0.0F};
		}
		if (width) {
			return Foundation::Vec2{*width, *width * mesh->size.y / mesh->size.x};
		}
		return mesh->size;
	}

} // namespace game::atlas
