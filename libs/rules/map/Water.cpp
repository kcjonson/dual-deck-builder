#include "Water.h"

#include "Land.h"
#include "LandFields.h"
#include "MapMath.h"
#include "Noise.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <numbers>
#include <utility>

namespace rules::map {

	namespace {

		// Moisture before the rivers: the map's level, `spread` either way from a noise layer `wavelength` world
		// units across, less `height` a unit of elevation.
		struct MoistureBeforeRivers {
			double wavelength = 650;
			int	   octaves = 2;
			float  gain = 0.5F;
			double spread = 0.55;
			double height = 0.6;
		};

		// Rain per cell: `base` plus moisture before the rivers, times one plus `ranges` of the range mask, so
		// wet country rains more and the ranges most.
		struct Rain {
			double base = 0.5;
			double ranges = 0.6;
		};

		// The routing's noise: `amplitude` of elevation over `wavelength` world units, one octave, whose
		// steepest grade is under a hundredth.
		struct Flats {
			double amplitude = 0.0015;
			double wavelength = 80;
		};

		// Wetness beside a river or lake: `creek` at the stream threshold, `gain` more a step of the square root
		// of the area's multiple of it, up to 1 on big rivers and beside lakes; fading to nothing `reach` world
		// units along the drainage from the water and `height` world units above it. Moisture gains `share` of it.
		struct Wetness {
			double creek = 0.5;
			double gain = 0.1;
			double reach = 120;
			double height = 12;
			double share = 0.35;
		};

		constexpr MoistureBeforeRivers kMoisture;
		constexpr Rain				   kRain;
		constexpr Flats				   kFlats;
		constexpr Wetness			   kWetness;

		// Low ground: 1 on the river or lake a cell drains to, 0.5 at the map's lowland level above it, 0 at
		// twice that. The level is the height above its water `share` of the land outside the ranges lies
		// under, past the relief radius, so a rugged map has as much low ground as a gentle one; never under
		// `least` world units.
		struct Lowland {
			double share = 0.45;
			double least = 1;
		};

		// Canyons: river valleys cut `reach` cells across, spreading `width` world units out from the river
		// and up to the valley's rim; `share` of the land outside the ranges at a dryness of `dryness` +
		// `drynessRange` and more, none at `dryness` and under.
		struct Canyons {
			int	   reach = 3;
			double width = 24;
			double share = 0.1;
			double dryness = 0.45;
			double drynessRange = 0.1;
		};

		constexpr Lowland kLowland;
		constexpr Canyons kCanyons;

		std::vector<double> moistureBeforeRivers(const LandSurface& land, double wetness, const NoiseLayer& noise) {
			const LandGrid&		grid = land.grid;
			std::vector<double> moisture(land.elevation.size());
			for (int row = 0; row < grid.size; ++row) {
				const double y = cellCentre(grid, row) / kMoisture.wavelength;
				for (int column = 0; column < grid.size; ++column) {
					const auto	 cell = static_cast<size_t>(row * grid.size + column);
					const double x = cellCentre(grid, column) / kMoisture.wavelength;
					const double spread = kMoisture.spread * noise.fractal(x, y, kMoisture.octaves, kMoisture.gain);
					moisture[cell] = clamp01(wetness + spread - kMoisture.height * land.elevation[cell]);
				}
			}
			return moisture;
		}

		std::vector<double> roughened(const LandSurface& land, const NoiseLayer& noise) {
			const LandGrid&		grid = land.grid;
			std::vector<double> heights(land.elevation.size());
			for (int row = 0; row < grid.size; ++row) {
				const double y = cellCentre(grid, row) / kFlats.wavelength;
				for (int column = 0; column < grid.size; ++column) {
					const auto cell = static_cast<size_t>(row * grid.size + column);
					heights[cell] = land.elevation[cell] + kFlats.amplitude * noise.sample(cellCentre(grid, column) / kFlats.wavelength, y);
				}
			}
			return heights;
		}

		// Cells no lake may cover: the metro's blend radius, and the grid's outermost cells, where drainage
		// leaves. Craters and places come after the water and keep off the lakes themselves.
		std::vector<uint8_t> lakeBlocked(const LandGrid& grid, double blendRadius) {
			std::vector<uint8_t> blocked(static_cast<size_t>(grid.cells()));
			for (int row = 0; row < grid.size; ++row) {
				const double y = cellCentre(grid, row);
				for (int column = 0; column < grid.size; ++column) {
					const double x = cellCentre(grid, column);
					const bool	 edge = row == 0 || column == 0 || row == grid.size - 1 || column == grid.size - 1;
					if (edge || x * x + y * y < blendRadius * blendRadius) {
						blocked[static_cast<size_t>(row * grid.size + column)] = 1;
					}
				}
			}
			return blocked;
		}

		// For each cell, the water its drainage reaches first, walking the routing downstream first so a cell's
		// receiver is done before it: a river or lake cell, or an outlet, is its own water; anything else takes
		// its receiver's, a step further along.
		struct NearestWater {
			// World units along the drainage to the river or lake...
			std::vector<double> along;
			// ...and above its surface, never below 0: height above the nearest drainage.
			std::vector<double> above;
			// The river or lake cell reached.
			std::vector<int> cell;
			// 0 to 1: how much wetness that water spreads.
			std::vector<double> strength;
		};

		NearestWater nearestWater(
			const LandGrid&			grid,
			std::span<const double> elevation,
			const Drainage&			routing,
			double					threshold,
			const LakeCells&		lakes
		) {
			const auto	 cells = elevation.size();
			NearestWater near{
				.along = std::vector<double>(cells),
				.above = std::vector<double>(cells),
				.cell = std::vector<int>(cells),
				.strength = std::vector<double>(cells),
			};
			std::vector<double> surface(cells);
			const double		diagonal = grid.cellSize * std::numbers::sqrt2;
			for (const int index : routing.order) {
				const auto cell = static_cast<size_t>(index);
				const int  receiver = routing.receivers[cell];
				const bool inLake = lakes.lakeOf[cell] >= 0;
				if (inLake || receiver < 0 || routing.area[cell] >= threshold) {
					near.cell[cell] = index;
					surface[cell] = inLake ? lakes.level[cell] : elevation[cell];
					near.strength[cell] =
						inLake ? 1 : clamp01(kWetness.creek + kWetness.gain * (std::sqrt(routing.area[cell] / threshold) - 1));
					continue;
				}
				const int  step = receiver - index;
				const bool square = step == 1 || step == -1 || step == grid.size || step == -grid.size;
				const auto below = static_cast<size_t>(receiver);
				near.along[cell] = near.along[below] + (square ? grid.cellSize : diagonal);
				near.cell[cell] = near.cell[below];
				surface[cell] = surface[below];
				near.strength[cell] = near.strength[below];
			}
			for (size_t cell = 0; cell < cells; ++cell) {
				near.above[cell] = std::max(0.0, (elevation[cell] - surface[cell]) * kRelief);
			}
			return near;
		}

		// Canyons per cell, 0 to 1: river valleys cut deepest into dry country. A river cell's cut is how deep a
		// valley it runs in; the cells draining to it within kCanyons.width along the drainage, and below the
		// valley's rim, share it. 0.5 where the cut passes the quantile its share of the land outside the ranges
		// lies above, only where features have room, and none on a map wetter than the canyons' dryness.
		std::vector<double> canyonField(
			const MapParams&	params,
			const Terrain&		terrain,
			const Drainage&		routing,
			double				threshold,
			const LakeCells&	lakes,
			const NearestWater& near
		) {
			const LandSurface&	land = terrain.surface();
			const auto			cells = land.elevation.size();
			std::vector<double> field(cells);
			const double		dryness = 1 - moistureLevel(params.aridity);
			const double		share = kCanyons.share * smooth01((dryness - kCanyons.dryness) / kCanyons.drynessRange);
			if (!(share > 0)) {
				return field;
			}
			std::vector<double> cut(cells);
			for (size_t cell = 0; cell < cells; ++cell) {
				if (routing.area[cell] >= threshold && lakes.lakeOf[cell] < 0) {
					cut[cell] = valleyDepth(land.elevation, land.grid.size, static_cast<int>(cell), kCanyons.reach);
				}
			}
			const std::span<const double> room = terrain.fields().room();
			std::vector<double>			  values(cells);
			for (size_t cell = 0; cell < cells; ++cell) {
				const double depth = cut[static_cast<size_t>(near.cell[cell])];
				if (depth > 0 && room[cell] > 0 && near.along[cell] <= kCanyons.width && near.above[cell] < depth * kRelief) {
					values[cell] = depth * room[cell];
				}
			}
			const double level = positiveQuantile(landValues(land, params.radius, terrain.start().relief, values, false), share);
			if (!(level < std::numeric_limits<double>::infinity())) {
				return field;
			}
			for (size_t cell = 0; cell < cells; ++cell) {
				field[cell] = smooth01((values[cell] / level - 1) * 2 + 0.5);
			}
			return field;
		}

	} // namespace

	Water::Water(const MapParams& params, const Terrain& terrain, const foundation::Rng& stream) {
		const LandSurface& land = terrain.surface();
		const LandGrid&	   grid = land.grid;
		const auto		   cells = land.elevation.size();

		const std::vector<double> before = moistureBeforeRivers(land, moistureLevel(params.aridity), NoiseLayer(stream, "moisture"));
		std::vector<double>		  rain(cells);
		for (size_t cell = 0; cell < cells; ++cell) {
			rain[cell] = (kRain.base + before[cell]) * (1 + kRain.ranges * land.mountains[cell]);
		}
		DrainageRouter router(grid.size);
		router.route(roughened(land, NoiseLayer(stream, "flats")), land.drainage.outlets);
		router.accumulate(rain);
		routing = router.drainage();
		streamThreshold = riverThreshold(params.riverDensity);

		LakeCells lakes = emptyLakeCells(cells);
		if (params.lakes > 0) {
			std::vector<uint8_t> blocked = lakeBlocked(grid, terrain.start().blend);
			naturalLakes({.grid = grid, .elevation = land.elevation, .levels = land.drainage.levels, .moisture = before}, blocked, lakes);
			foundation::Rng reservoirs = stream.fork("reservoirs");
			placeReservoirs(
				{.grid = grid,
				 .elevation = land.elevation,
				 .receivers = routing.receivers,
				 .area = routing.area,
				 .threshold = streamThreshold,
				 .count = params.lakes,
				 .radius = static_cast<double>(params.radius),
				 .inner = terrain.start().relief},
				reservoirs,
				blocked,
				lakes
			);
		}

		riverList = drawRivers(
			traceRivers({
				.receivers = routing.receivers,
				.area = routing.area,
				.threshold = streamThreshold,
				.lakeOf = lakes.lakeOf,
				.closedBasin = land.closedBasin,
			}),
			{.grid = grid, .area = routing.area, .threshold = streamThreshold, .elevation = land.elevation, .meander = params.riverMeander},
			NoiseLayer(stream, "meander")
		);

		const NearestWater near = nearestWater(grid, land.elevation, routing, streamThreshold, lakes);
		const double	   lowLevel =
			quantileAbove(landValues(land, params.radius, terrain.start().relief, near.above, false), 1 - kLowland.share);
		const double twiceLow = 2 * std::max(lowLevel, kLowland.least);
		moistureOf.resize(cells);
		lowlandOf.resize(cells);
		for (size_t cell = 0; cell < cells; ++cell) {
			const double above = near.above[cell];
			const double wetness =
				near.strength[cell] * (1 - smooth01(near.along[cell] / kWetness.reach)) * (1 - smooth01(above / kWetness.height));
			moistureOf[cell] = clamp01(before[cell] + kWetness.share * wetness);
			lowlandOf[cell] = 1 - smooth01(above / twiceLow);
		}
		canyonsOf = canyonField(params, terrain, routing, streamThreshold, lakes, near);
		aboveWaterOf = near.above;
		alongToWaterOf = near.along;
		lakeDepthOf = lakeDepthField(grid, land.elevation, lakes);
		index = RiverIndex(riverList, grid.halfExtent);
		lakeIndex = std::move(lakes.lakeOf);
		lakeList = std::move(lakes.lakes);
	}

} // namespace rules::map
