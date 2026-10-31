#include "Ground.h"

#include <cassert>

namespace rules::map {

	namespace {

		// Inside the metro moisture is scrub's middling level.
		constexpr double kStartMoisture = 0.45;

	} // namespace

	Ground::Ground(const Terrain& terrain, const Water& water)
		: Ground(terrain, water, nullptr) {}

	Ground::Ground(const Terrain& terrain, const Water& water, const Hazards& layer)
		: Ground(terrain, water, &layer) {}

	Ground::Ground(const Terrain& terrain, const Water& water, const Hazards* layer)
		: land(&terrain),
		  wet(&water),
		  hazards(layer),
		  riverWater(&water.riverIndex()) {
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
		const double own = land->fields().contamination(x, y);
		if (hazards == nullptr) {
			return own;
		}
		// The metro's blend caps the plumes as it does the land's own, so none reaches the metro.
		return hazards->plumes(x, y, own, 1 - startWeight(land->start(), x * x + y * y));
	}

	bool Ground::crater(double x, double y) const {
		return hazards != nullptr && hazards->crater(x, y);
	}

	std::span<const Hotspot> Ground::hotspots() const {
		if (hazards == nullptr) {
			return {};
		}
		return hazards->hotspots();
	}

	Ground Ground::withRivers(const RiverIndex& rivers) const {
		Ground other = *this;
		other.riverWater = &rivers;
		return other;
	}

	WaterKind Ground::waterAt(double x, double y) const {
		if (GridSampler(land->surface().grid, wet->lakeDepth()).bilinear(x, y) > 0) {
			return WaterKind::Lake;
		}
		return riverWater->contains(x, y) ? WaterKind::River : WaterKind::None;
	}

	bool Ground::bridged(double x, double y) const {
		const double reach = land->start().metro + kMetroBridges;
		return x * x + y * y <= reach * reach;
	}

	Obstacle Ground::obstacle(double x, double y) const {
		if (crater(x, y)) {
			return Obstacle::Crater;
		}
		const WaterKind water = waterAt(x, y);
		if (water == WaterKind::Lake) {
			return Obstacle::Lake;
		}
		if (water == WaterKind::River && !bridged(x, y)) {
			return Obstacle::River;
		}
		return land->fields().cliff(x, y) ? Obstacle::Cliff : Obstacle::None;
	}

} // namespace rules::map
