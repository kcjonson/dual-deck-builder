#pragma once

#include "MapParams.h"
#include "Terrain.h"
#include "Water.h"

#include <random/Rng.h>

#include <vector>

namespace rules::map {

	// A blast site or spill: an impassable crater in a plume of contamination.
	struct Hotspot {
		double x{0};
		double y{0};
		// World units: everything nearer the centre than this is crater.
		double craterRadius{0};
		// World units: the contamination reaches this far, strongest at the centre.
		double plumeRadius{0};
		// The plume's contamination at the centre, 0 to 1.
		double strength{0};
	};

	// Stage 3 of area map generation, the hazards (Area Map Generation, Pipeline, 3. Biomes, hazards, and
	// cost), after the water, on the `hazards` stream's `hotspots` fork: up to `hotspots` hotspots,
	// dart-thrown past the metro a quarter of the radius apart, each kept off the land's drainage, so no
	// crater sits on a river, and off the lakes. Hotspot placement is plain arithmetic, no square root or trig.
	class Hazards {
	  public:
		// The params are validated, and the terrain and water are theirs.
		Hazards(const MapParams& params, const Terrain& terrain, const Water& water, const foundation::Rng& stream);

		[[nodiscard]] const std::vector<Hotspot>& hotspots() const { return sites; }

		// True inside a crater.
		[[nodiscard]] bool crater(double x, double y) const;
		// `contamination` with every plume over it, each falling off as (1 - d^2 / r^2)^2 and combining as
		// 1 - (1 - a)(1 - b), never past `ceiling`, the most the ground there can hold: so a plume fades with
		// the land's own contamination over the metro's blend ring.
		[[nodiscard]] double plumes(double x, double y, double contamination, double ceiling) const;

	  private:
		std::vector<Hotspot> sites;
	};

} // namespace rules::map
