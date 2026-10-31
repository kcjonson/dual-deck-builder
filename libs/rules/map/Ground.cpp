#include "Ground.h"

#include <cassert>

namespace rules::map {

	namespace {

		// Inside the metro moisture is scrub's middling level.
		constexpr double kStartMoisture = 0.45;

	} // namespace

	Ground::Ground(const Terrain& terrain, const Water& water)
		: land(&terrain),
		  wet(&water) {
		assert(water.moisture().size() == static_cast<size_t>(terrain.surface().grid.cells()) && "Ground: the water is the terrain's");
	}

	GroundSample Ground::sample(double x, double y) const {
		const LandSample  ground = land->sample(x, y);
		const LandGrid&	  grid = land->surface().grid;
		const BiomeFields fields{
			.lowland = GridSampler(grid, wet->lowland()).bilinear(x, y),
			.moisture = moisture(x, y),
			.contamination = contamination(x, y),
			.mountains = land->mountains(x, y),
			.canyons = GridSampler(grid, wet->canyons()).bilinear(x, y),
			.badlands = land->fields().badlands(x, y),
		};
		return {
			.elevation = ground.elevation,
			.slopeX = ground.slopeX,
			.slopeY = ground.slopeY,
			.fields = fields,
			.biome = classifyBiome(fields)
		};
	}

	Biome Ground::biome(double x, double y) const {
		return sample(x, y).biome;
	}

	double Ground::moisture(double x, double y) const {
		const double moisture = GridSampler(land->surface().grid, wet->moisture()).bilinear(x, y);
		return moisture + (kStartMoisture - moisture) * startWeight(land->start(), x * x + y * y);
	}

	double Ground::contamination(double x, double y) const {
		return land->fields().contamination(x, y);
	}

} // namespace rules::map
