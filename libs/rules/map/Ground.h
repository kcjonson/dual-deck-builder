#pragma once

#include "Biome.h"
#include "Hazards.h"
#include "Terrain.h"
#include "Water.h"

namespace rules::map {

	// Everything about one point of the ground.
	struct GroundSample {
		double		elevation{0};
		double		slopeX{0};
		double		slopeY{0};
		BiomeFields fields;
		Biome		biome{Biome::Scrub};
	};

	// The ground as later stages read it: the land with its water over it, and its hazards once that stage
	// lays them, as fields of (x, y) in world units. A view: it holds the layers it was made over, which have
	// to outlive it, and allocates nothing. Inside the metro the fields are scrub's, moisture its middling
	// level and no contamination, plumes included, blending back to the land's own over the blend ring.
	class Ground {
	  public:
		// The water is the one made over this terrain, and the hazards over both.
		Ground(const Terrain& terrain, const Water& water);
		Ground(const Terrain& terrain, const Water& water, const Hazards& layer);

		[[nodiscard]] const Terrain& terrain() const { return *land; }
		[[nodiscard]] const Water&	 water() const { return *wet; }

		[[nodiscard]] GroundSample sample(double x, double y) const;
		[[nodiscard]] Biome		   biome(double x, double y) const;
		// 0 dry to 1 wet.
		[[nodiscard]] double moisture(double x, double y) const;
		// 0 clean to 1 toxic: the land's own, and the hotspots' plumes once they're laid.
		[[nodiscard]] double contamination(double x, double y) const;
		// True inside a crater: none before the hazards are laid.
		[[nodiscard]] bool crater(double x, double y) const;

	  private:
		Ground(const Terrain& terrain, const Water& water, const Hazards* layer);

		const Terrain* land;
		const Water*   wet;
		const Hazards* hazards;
	};

} // namespace rules::map
