#include "Terrain.h"

#include "MapMath.h"

namespace rules::map {

	Terrain::Terrain(const MapParams& params, const foundation::Rng& stream)
		: discRadius(params.radius),
		  radii(startRadii(params.radius, params.metroSize)),
		  land(generateLand(params, stream)),
		  terracing(terracePull(moistureLevel(params.aridity))) {}

	LandSample Terrain::sample(double x, double y) const {
		const GridSample ground = GridSampler(land.grid, land.elevation).bicubic(x, y);
		double			 elevation = ground.value;
		double			 slopeX = ground.gradientX;
		double			 slopeY = ground.gradientY;
		const double	 distanceSquared = x * x + y * y;
		const double	 metroSquared = radii.metro * radii.metro;
		if (terracing > 0 && distanceSquared > metroSquared) {
			const double blendSquared = radii.blend * radii.blend;
			double		 pull = terracing;
			double		 pullX = 0;
			double		 pullY = 0;
			if (distanceSquared < blendSquared) {
				const double span = blendSquared - metroSquared;
				const double ramp = (blendSquared - distanceSquared) / span;
				pull *= 1 - smooth01(ramp);
				const double change = 2 * terracing * smoothSlope(ramp) / span;
				pullX = change * x;
				pullY = change * y;
			}
			const double lift = terraceLift(elevation);
			const double scale = terraceSlope(elevation, pull);
			slopeX = slopeX * scale + lift * pullX;
			slopeY = slopeY * scale + lift * pullY;
			elevation += lift * pull;
		}
		if (elevation < 0 || elevation > 1) {
			elevation = elevation < 0 ? 0 : 1;
			slopeX = 0;
			slopeY = 0;
		}
		return {.elevation = elevation, .slopeX = slopeX, .slopeY = slopeY};
	}

	double Terrain::elevation(double x, double y) const {
		return sample(x, y).elevation;
	}

} // namespace rules::map
