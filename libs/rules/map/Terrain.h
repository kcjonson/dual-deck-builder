#pragma once

#include "Land.h"
#include "MapParams.h"

#include <random/Rng.h>

namespace rules::map {

	// The land at one point.
	struct LandSample {
		// 0 to 1: outlets and valley floors to the highest peaks.
		double elevation{0};
		// Elevation's gradient, per world unit east and north; downhill is against it.
		double slopeX{0};
		double slopeY{0};
	};

	// Stage 1 of area map generation (Area Map Generation, Pipeline, 1. Terrain): the eroded land, read as
	// elevation over the disc, the compound at the origin, so later stages and the renderer sample it at any
	// resolution. Building one erodes the land, which is most of the time; sampling allocates nothing.
	//
	// Elevation is the eroded grid sampled bicubic, terraced on a dry map, with its exact gradient. It's
	// terraced as it's sampled rather than on the grid, so a riser follows the land's contours instead of
	// its cells, and the pull fades out over the blend ring, since the metro is flat ground, not a bench.
	class Terrain {
	  public:
		// The params are validated; `stream` is the stage's, which the terrain forks by feature.
		Terrain(const MapParams& params, const foundation::Rng& stream);

		Terrain(const Terrain&) = delete;
		Terrain& operator=(const Terrain&) = delete;
		Terrain(Terrain&&) = default;
		Terrain& operator=(Terrain&&) = default;
		~Terrain() = default;

		// World units: the disc's radius.
		[[nodiscard]] int				radius() const { return discRadius; }
		[[nodiscard]] const StartRadii& start() const { return radii; }
		// The eroded land on its grid with its drainage, for the water stage to trace rivers and fill lakes
		// from.
		[[nodiscard]] const LandSurface& surface() const { return land; }

		[[nodiscard]] LandSample sample(double x, double y) const;
		[[nodiscard]] double	 elevation(double x, double y) const;

	  private:
		int			discRadius;
		StartRadii	radii;
		LandSurface land;
		// How hard dry land is pulled toward terraces past the blend ring.
		double terracing;
	};

} // namespace rules::map
