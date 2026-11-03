#pragma once

// The game's paper (procedural-paper.md): one surface's look packed into the twelve bytes shaders/paper.frag.glsl reads,
// the hook's tuning, and a component that draws a rect of it under its children.

#include <graphics/Color.h>
#include <graphics/PrimitiveStyles.h>
#include <graphics/Rect.h>
#include <ui/Component.h>

#include <array>
#include <cstdint>
#include <optional>
#include <string_view>

namespace game::atlas {

	// UI Art Direction, Wear: W0 clean, W1 handled, W2 worn, W3 damaged.
	enum class Wear : uint8_t { Clean, Handled, Worn, Damaged };
	enum class Corner : uint8_t { TopLeft, TopRight, BottomRight, BottomLeft };
	enum class HeroMark : uint8_t { None, Burn, Hole, Rip };
	enum class Side : uint8_t { None, Top, Right, Bottom, Left };

	struct PaperLook {
		uint32_t seed = 0; // paperSeed of what the surface is, never of the frame or the layout
		Wear	 wear = Wear::Handled;
		Corner	 grab = Corner::BottomRight; // W1's smudge
		Corner	 hero = Corner::TopRight;	 // W3's mark
		HeroMark mark = HeroMark::None;
		int		 folds = 0; // W2's creases, 0 to 7
		Side	 exposed = Side::None;
	};

	// A surface's seed from what it is: the scene and the surface's name, or the POI, driver or run it belongs to.
	[[nodiscard]] uint32_t paperSeed(std::string_view identity);

	[[nodiscard]] std::array<uint32_t, 3> packPaper(const PaperLook& look);

	// The hook's uniform block, std140 as PaperUniforms lays it out.
	struct PaperTuning {
		std::array<float, 4> strength;	// the most grime darkens the tint by, W0 to W3
		std::array<float, 4> shade;		// each channel's share of the darkening, and a fold's darkening
		float				 band;		// the edge band, a share of the shorter side
		float				 fade;		// grime fades to nothing over this much more
		float				 frequency; // the mottle's lowest frequency, cycles a px
		float				 octaves;
		float				 smallSide; // px under which a surface gets the edge tone only
		float				 edgeTone;	// the edge tone's share of the strength
		float				 smudge;	// W1's smudge, a share of the shorter side
		float				 hero;		// W3's mark's reach, a share of the shorter side
	};
	static_assert(sizeof(PaperTuning) == 64, "PaperUniforms is 64 bytes");

	inline constexpr PaperTuning kPaperTuning{
		.strength = {0.0F, 0.08F, 0.30F, 0.34F},
		.shade = {0.72F, 0.84F, 1.0F, 0.07F},
		.band = 0.06F,
		.fade = 0.06F,
		.frequency = 0.012F,
		.octaves = 4.0F,
		.smallSide = 120.0F,
		.edgeTone = 0.35F,
		.smudge = 0.28F,
		.hero = 0.22F,
	};

	// The paper hook's block filled from kPaperTuning, once the renderer is up.
	void tunePaper();

	// The darkest the hook makes `tint` at `wear`, anywhere outside W3's hero corner: each channel darkened by the
	// level's strength times its share.
	[[nodiscard]] Foundation::Color darkestPaper(Foundation::Color tint, Wear wear);

	// WCAG's contrast ratio of two opaque sRGB colours, 1 to 21.
	[[nodiscard]] float contrastRatio(Foundation::Color a, Foundation::Color b);

	struct PaperDraw {
		Foundation::Rect					   bounds;
		Foundation::Color					   tint;
		PaperLook							   look;
		std::optional<Foundation::BorderStyle> border;
		const char*							   id = nullptr;
		int32_t								   key = 0;
	};

	// A rect of paper through the hook, in the space it's drawn in.
	void drawPaper(const PaperDraw& paper);

	// A paper surface the size of its box: style.backgroundColor is the tint (the theme's raised surface when unset), and
	// style.borderColor and borderWidth an ink rule inside the box. Its children lie on it.
	class Paper : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			PaperLook look;
		};

		explicit Paper(const Args& args)
			: look(args.look) {}

		[[nodiscard]] const PaperLook& getLook() const { return look; }
		[[nodiscard]] const char*	   typeName() const override { return "Paper"; }

	  protected:
		void render() override;

		// The paper's tint and border as drawn, its opacity applied.
		[[nodiscard]] Foundation::Color						 tint() const;
		[[nodiscard]] std::optional<Foundation::BorderStyle> border() const;

	  private:
		PaperLook look;
	};

} // namespace game::atlas
