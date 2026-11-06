#pragma once

// The game's flat-fill vector art (procedural-paper.md, Everything else): the SVGs in art/, embedded by salal_art, loaded
// through salal's renderer/vector and tessellated once, on first use, then drawn at a size and a tint. ArtView lays a
// piece out as a component; drawArt is the same draw for a component placing art in its own render, as the sheet does
// its tape. Some art is generated (scripts/vector-art.mjs), the rest drawn by hand.

#include <graphics/Color.h>
#include <graphics/Rect.h>
#include <math/Types.h>
#include <ui/Component.h>
#include <ui/theme/TokenTable.h>
#include <vector/Types.h>

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace game::atlas {

	// How art fits the rect it's drawn to: Contain keeps its proportions, centred; Stretch fills the rect on each axis.
	enum class ArtFit : uint8_t { Contain, Stretch };

	struct ArtMesh {
		std::vector<renderer::TessellatedMesh> chunks; // each under the 16-bit index limit
		Foundation::Vec2					   size;   // the SVG's width and height: the box that fits the rect
		Foundation::Rect					   bounds; // what it covers, in the same units, past the box where art runs over it
	};

	// The art `name` (art/<name>.svg), loaded on first use. Null, logged once, when nothing is embedded by that name, it
	// doesn't load, or one of its shapes doesn't tessellate.
	[[nodiscard]] const ArtMesh* artMesh(std::string_view name);

	struct ArtDraw {
		std::string_view				 name;
		Foundation::Rect				 bounds; // the art's box drawn to this rect
		ArtFit							 fit = ArtFit::Contain;
		float							 turn = 0.0F; // radians, about the rect's centre
		std::optional<Foundation::Color> tint;		  // every colour this one's, alphas multiplied; else the art's own
		float							 opacity = 1.0F;
		int32_t							 key = 0;
	};

	// Draws nothing and returns false when the art isn't there (artMesh logs why).
	bool drawArt(const ArtDraw& art);

	// A piece of art the size of its box, or of the art when its size is auto (at a set width, the height in proportion).
	// Decoration: the pointer passes through it.
	class ArtView : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			std::string					  art;
			ArtFit						  fit = ArtFit::Contain;
			std::optional<ui::ColorToken> tint;
		};

		explicit ArtView(const Args& args)
			: art(args.art),
			  fit(args.fit),
			  tint(args.tint) {}

		[[nodiscard]] const char* typeName() const override { return "ArtView"; }
		// Art that runs past its box, as the cover's page edges do.
		[[nodiscard]] float inkExtent() const override;
		void				describe(nlohmann::json& node) const override;

	  protected:
		void										  render() override;
		[[nodiscard]] std::optional<Foundation::Vec2> intrinsicSize(std::optional<float> width, float availableWidth) const override;
		[[nodiscard]] ui::PointerEvents				  defaultPointerEvents() const override { return ui::PointerEvents::None; }

	  private:
		std::string					  art;
		ArtFit						  fit;
		std::optional<ui::ColorToken> tint;
	};

} // namespace game::atlas
