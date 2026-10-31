#include "Water.h"

#include "Land.h"
#include "MapMath.h"
#include "Noise.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
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

		// Each cell's wetness from the water its drainage reaches first, walking the routing downstream first
		// so a cell's receiver is done before it: a river or lake cell, or an outlet, is its own water; anything
		// else takes its receiver's, a step further along.
		std::vector<double> wetnessBeside(
			const LandGrid&			grid,
			std::span<const double> elevation,
			const Drainage&			routing,
			double					threshold,
			const LakeCells&		lakes
		) {
			const auto			cells = elevation.size();
			std::vector<double> along(cells);
			std::vector<double> surface(cells);
			std::vector<double> strength(cells);
			const double		diagonal = grid.cellSize * std::numbers::sqrt2;
			for (const int index : routing.order) {
				const auto cell = static_cast<size_t>(index);
				const int  receiver = routing.receivers[cell];
				const bool inLake = lakes.lakeOf[cell] >= 0;
				if (inLake || receiver < 0 || routing.area[cell] >= threshold) {
					surface[cell] = inLake ? lakes.level[cell] : elevation[cell];
					strength[cell] = inLake ? 1 : clamp01(kWetness.creek + kWetness.gain * (std::sqrt(routing.area[cell] / threshold) - 1));
					continue;
				}
				const int  step = receiver - index;
				const bool square = step == 1 || step == -1 || step == grid.size || step == -grid.size;
				const auto below = static_cast<size_t>(receiver);
				along[cell] = along[below] + (square ? grid.cellSize : diagonal);
				surface[cell] = surface[below];
				strength[cell] = strength[below];
			}
			std::vector<double> wetness(cells);
			for (size_t cell = 0; cell < cells; ++cell) {
				const double above = std::max(0.0, (elevation[cell] - surface[cell]) * kRelief);
				wetness[cell] = strength[cell] * (1 - smooth01(along[cell] / kWetness.reach)) * (1 - smooth01(above / kWetness.height));
			}
			return wetness;
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

		const std::vector<double> wetness = wetnessBeside(grid, land.elevation, routing, streamThreshold, lakes);
		moistureOf.resize(cells);
		for (size_t cell = 0; cell < cells; ++cell) {
			moistureOf[cell] = clamp01(before[cell] + kWetness.share * wetness[cell]);
		}
		lakeDepthOf = lakeDepthField(grid, land.elevation, lakes);
		lakeIndex = std::move(lakes.lakeOf);
		lakeList = std::move(lakes.lakes);
	}

} // namespace rules::map
