#pragma once

// The area map's land, baked once a map into premultiplied RGBA8 texels (area-map-atlas-style.md, The bake), and the
// fog over it, baked from what's known. No GL here: the texels are uploaded by MapPicture, so a test reads them.
//
// The land covers the disc's bounding square, row 0 at its north edge. A full ground sample costs about a microsecond,
// so the bake reads the land on lattices coarser than the texels and interpolates: the land's colour, relief and
// contamination every 16 world units or so, hill shade every half land cell read bicubic, and how far into a cliff
// every second texel, closed. Per texel over that: contamination hatched, built-up land round each ruin with the
// dressing's blocks on it, the dressing's plume hatching and mire stipple, lakes with a darker shore, craters, and the
// rim. Rivers, roads and everything after draw live. Texels past the rim are clear, so the view's paper shows there.

#include <rules/map/Dressing.h>
#include <rules/map/Ground.h>
#include <rules/map/LandFog.h>
#include <rules/map/Places.h>

#include <cstdint>
#include <stop_token>
#include <vector>

namespace game {

	struct Texels {
		int					 size{0}; // a side
		std::vector<uint8_t> rgba;	  // premultiplied, row 0 first
	};

	struct LandBakeArgs {
		// The land with its water and hazards.
		const rules::map::Ground& ground;
		const rules::map::Places& places;
		// Street grids, plume hatching, and stipple; none without one.
		const rules::map::Dressing* dressing = nullptr;
		int							size{0};
		// Asked before each row: once a stop is requested the bake gives up, and hands back no texels.
		std::stop_token stop{};
	};

	// About 2.5 world units a texel, held to 256 to 1024 a side.
	[[nodiscard]] int landBakeSize(int radius);

	[[nodiscard]] Texels bakeLand(const LandBakeArgs& args);

	// The fog over the disc's square: the fog's dark where the land isn't revealed, its edge softened over a cell, clear
	// past the rim. kFogTexelsPerCell texels a cell.
	[[nodiscard]] Texels bakeFog(const rules::map::LandFog& fog);

} // namespace game
