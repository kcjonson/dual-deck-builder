#include "Land.h"

#include "Erosion.h"
#include "MapMath.h"
#include "Noise.h"
#include "ParamValidator.h"
#include "Uplift.h"

#include <math/DeterministicMath.h>

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <limits>
#include <numbers>
#include <span>
#include <utility>

namespace rules::map {

	namespace {

		// dt, K, the uplift's rate per unit of time, the iterations at half size and then full size, and the
		// hillslope diffusion at ruggedness 0 and 1, so rugged ranges keep sharper slopes. The numbers are
		// terrain-erosion.md's.
		struct ErosionSchedule {
			double timeStep = 1.2;
			double erodibility = 0.11;
			double upliftRate = 0.1;
			int	   coarseIterations = 40;
			int	   fineIterations = 10;
			double diffusionGentle = 0.05;
			double diffusionRugged = 0.025;
		};

		// The surface erosion starts from: a little of the uplift, so ranges start as ridges, and low noise.
		struct InitialSurface {
			double lift = 0.05;
			double relief = 0.02;
			double wavelength = 120;
			int	   octaves = 3;
			float  gain = 0.5F;
		};

		constexpr ErosionSchedule kErosion;
		constexpr InitialSurface  kInitial;
		// Eroded height h becomes elevation h / sqrt(h^2 + kHeightScale^2): about h / kHeightScale in the
		// lowlands, easing toward 1 on the highest peaks, so no tuning of the uplift flattens the tops.
		constexpr double kHeightScale = 6;
		// With no outlets, the sink sits this share of the radius from the compound.
		constexpr double kBasinDistance = 0.55;

		double distanceSquared(const LandGrid& grid, int row, int column) {
			const double x = cellCentre(grid, column);
			const double y = cellCentre(grid, row);
			return x * x + y * y;
		}

		// The cell `along` steps round the edge, counterclockwise from the south-west corner.
		int perimeterCell(int size, int along) {
			const int side = size - 1;
			if (along < side) {
				return along;
			}
			if (along < 2 * side) {
				return (along - side) * size + side;
			}
			if (along < 3 * side) {
				return side * size + side - (along - 2 * side);
			}
			return (side - (along - 3 * side)) * size;
		}

		// The coarse cells holding the given cells of a grid twice the size, in order, each once.
		std::vector<int> coarseCells(std::span<const int> cells, int size) {
			const int		 half = size / 2;
			std::vector<int> coarse;
			for (const int cell : cells) {
				const int row = cell / size;
				const int column = cell - row * size;
				const int coarseCell = (row / 2) * half + column / 2;
				if (std::ranges::find(coarse, coarseCell) == coarse.end()) {
					coarse.push_back(coarseCell);
				}
			}
			return coarse;
		}

		// Erodes the uplift from a low starting surface, coarse first, then at full size from that land
		// upsampled: under half the time of a full-size run. Diffusion acts per cell, so on cells twice as
		// wide the coarse pass takes a quarter of it, to smooth as much per world unit.
		std::vector<double> erodeCoarseToFine(
			const LandGrid&			grid,
			std::span<const double> uplift,
			std::span<const int>	outlets,
			double					ruggedness,
			const foundation::Rng&	stream,
			DrainageRouter&			router
		) {
			const int				  size = grid.size;
			const LandGrid			  coarse = coarseGrid(grid);
			const int				  half = coarse.size;
			const auto				  coarseCount = static_cast<size_t>(coarse.cells());
			const std::vector<double> coarseUplift = downsample(uplift, size);
			const std::vector<int>	  coarseOutlets = coarseCells(outlets, size);
			const double			  diffusion = lerp(kErosion.diffusionGentle, kErosion.diffusionRugged, ruggedness);

			const NoiseLayer	noise(stream, "initial");
			std::vector<double> coarseHeight(coarseCount);
			std::vector<double> coarseRate(coarseCount);
			for (int row = 0; row < half; ++row) {
				const double y = cellCentre(coarse, row) / kInitial.wavelength;
				for (int column = 0; column < half; ++column) {
					const double x = cellCentre(coarse, column) / kInitial.wavelength;
					const auto	 cell = static_cast<size_t>(row * half + column);
					coarseHeight[cell] =
						kInitial.lift * coarseUplift[cell] + kInitial.relief * (1 + noise.fractal(x, y, kInitial.octaves, kInitial.gain));
					coarseRate[cell] = kErosion.upliftRate * coarseUplift[cell];
				}
			}
			for (const int outlet : coarseOutlets) {
				coarseHeight[static_cast<size_t>(outlet)] = 0;
			}
			DrainageRouter coarseRouter(half);
			erode(
				{.heights = coarseHeight,
				 .upliftRate = coarseRate,
				 .outlets = coarseOutlets,
				 .iterations = kErosion.coarseIterations,
				 .timeStep = kErosion.timeStep,
				 .erodibility = kErosion.erodibility,
				 .diffusion = diffusion / 4},
				coarseRouter
			);

			std::vector<double> height = upsample(coarseHeight, half);
			std::vector<double> rate(uplift.size());
			for (size_t cell = 0; cell < rate.size(); ++cell) {
				rate[cell] = kErosion.upliftRate * uplift[cell];
			}
			for (const int outlet : outlets) {
				height[static_cast<size_t>(outlet)] = 0;
			}
			erode(
				{.heights = height,
				 .upliftRate = rate,
				 .outlets = outlets,
				 .iterations = kErosion.fineIterations,
				 .timeStep = kErosion.timeStep,
				 .erodibility = kErosion.erodibility,
				 .diffusion = diffusion},
				router
			);
			return height;
		}

		// Only ever lowers land, toward the lowest water level in the metro, where its water leaves, rather
		// than its lowest cell, which would sink it into a basin. Inside the metro every cell above that floor
		// keeps the same share of its height above it, so heights keep their order and water runs across the
		// metro as it did, easing back to the land's own height at the blend radius. The ring keeps less of
		// its inner edge than its outer, which would dam the ways water leaves, so then, upstream first, each
		// cell's old receiver that was below it comes down to the cell's new height at most. `routing` is the
		// land's before flattening.
		void flattenMetro(const LandGrid& grid, std::vector<double>& elevation, const DrainageRouter& routing, const StartRadii& radii) {
			const int					  size = grid.size;
			const double				  metroSquared = radii.metro * radii.metro;
			const double				  blendSquared = radii.blend * radii.blend;
			const double				  toGrade = kRelief / (2 * grid.cellSize);
			const std::span<const double> levels = routing.levels();
			double						  floorLevel = std::numeric_limits<double>::infinity();
			double						  steepest = 0;
			for (int row = 1; row < size - 1; ++row) {
				for (int column = 1; column < size - 1; ++column) {
					if (distanceSquared(grid, row, column) > metroSquared) {
						continue;
					}
					const auto cell = static_cast<size_t>(row * size + column);
					floorLevel = std::min(floorLevel, levels[cell]);
					const double slopeX = (elevation[cell + 1] - elevation[cell - 1]) * toGrade;
					const double slopeY = (elevation[cell + size] - elevation[cell - size]) * toGrade;
					steepest = std::max(steepest, std::sqrt(slopeX * slopeX + slopeY * slopeY));
				}
			}
			assert(floorLevel < std::numeric_limits<double>::infinity() && "flattenMetro: the metro covers cells");

			const std::vector<double> before = elevation;
			const double			  keep = steepest * kMetroRelief > kMetroGrade ? kMetroGrade / steepest : kMetroRelief;
			const double			  pull = 1 - keep;
			for (int row = 0; row < size; ++row) {
				for (int column = 0; column < size; ++column) {
					const double away = distanceSquared(grid, row, column);
					if (away >= blendSquared) {
						continue;
					}
					const auto	 cell = static_cast<size_t>(row * size + column);
					const double above = elevation[cell] - floorLevel;
					if (!(above > 0)) {
						continue;
					}
					const double weight = away <= metroSquared ? 1 : smooth01((blendSquared - away) / (blendSquared - metroSquared));
					elevation[cell] -= above * pull * weight;
				}
			}
			const std::span<const int> receivers = routing.receivers();
			const std::span<const int> order = routing.order();
			for (size_t index = order.size(); index-- > 0;) {
				const auto cell = static_cast<size_t>(order[index]);
				const int  receiver = receivers[cell];
				if (receiver < 0) {
					continue;
				}
				const auto below = static_cast<size_t>(receiver);
				if (before[below] < before[cell] && elevation[below] > elevation[cell]) {
					elevation[below] = elevation[cell];
				}
			}
		}

		// Raises standing water round the metro to dry land: every cell inside the blend radius where water
		// stands, and all the water it connects to, goes up to its level, so a pit the flattening left becomes
		// flat ground and no step stands where the blend radius cuts across it. Each level is above its
		// receiver's, so the routing stands as it was.
		void fillMetroWater(const LandGrid& grid, std::vector<double>& elevation, std::span<const double> levels, double blendRadius) {
			const int		 size = grid.size;
			const double	 blendSquared = blendRadius * blendRadius;
			std::vector<int> pending;
			for (int row = 0; row < size; ++row) {
				for (int column = 0; column < size; ++column) {
					const int cell = row * size + column;
					if (distanceSquared(grid, row, column) < blendSquared && levels[cell] > elevation[cell]) {
						elevation[cell] = levels[cell];
						pending.push_back(cell);
					}
				}
			}
			while (!pending.empty()) {
				const int cell = pending.back();
				pending.pop_back();
				const int row = cell / size;
				const int column = cell - row * size;
				for (int nextRow = std::max(0, row - 1); nextRow <= std::min(size - 1, row + 1); ++nextRow) {
					for (int nextColumn = std::max(0, column - 1); nextColumn <= std::min(size - 1, column + 1); ++nextColumn) {
						const int next = nextRow * size + nextColumn;
						if (levels[next] > elevation[next]) {
							elevation[next] = levels[next];
							pending.push_back(next);
						}
					}
				}
			}
		}

	} // namespace

	StartRadii startRadii(int radius, double metroSize) {
		const double metro = metroSize * radius;
		const double blend = metro + std::max(0.5 * metro, 0.06 * radius);
		return {.metro = metro, .blend = blend, .relief = blend + 0.1 * radius};
	}

	LandSurface generateLand(const MapParams& params, const foundation::Rng& stream) {
		assert(validateMapParams(params).clamps.empty() && "generateLand: generation runs on validated params");
		const LandGrid	 grid = landGridFor(params.radius);
		const StartRadii radii = startRadii(params.radius, params.metroSize);
		UpliftField		 uplift = buildUplift(
			 {.grid = grid,
				  .radius = static_cast<double>(params.radius),
				  .metroRadius = radii.metro,
				  .reliefRadius = radii.relief,
				  .mountainCoverage = params.mountainCoverage,
				  .ruggedness = params.ruggedness},
			 stream
		 );
		foundation::Rng outletStream = stream.fork("outlets");
		const Outlets	outlets = placeOutlets(grid, params.rivers, params.radius, outletStream);

		DrainageRouter		router(grid.size);
		std::vector<double> elevation = erodeCoarseToFine(grid, uplift.uplift, outlets.cells, params.ruggedness, stream, router);
		for (double& height : elevation) {
			height = height / std::sqrt(height * height + kHeightScale * kHeightScale);
		}
		router.route(elevation, outlets.cells);
		flattenMetro(grid, elevation, router, radii);
		router.route(elevation, outlets.cells);
		router.accumulate();
		Drainage drainage = router.drainage();
		fillMetroWater(grid, elevation, drainage.levels, radii.blend);
		return {
			.grid = grid,
			.elevation = std::move(elevation),
			.mountains = std::move(uplift.mountains),
			.drainage = std::move(drainage),
			.closedBasin = outlets.closedBasin,
		};
	}

	Outlets placeOutlets(const LandGrid& grid, int count, int radius, foundation::Rng& rng) {
		if (count <= 0) {
			const double angle = rng.nextDouble() * 2 * std::numbers::pi;
			const double distance = kBasinDistance * radius;
			const int	 sink = cellAt(grid, foundation::det_math::cos(angle) * distance, foundation::det_math::sin(angle) * distance);
			assert(sink >= 0 && "placeOutlets: a closed basin's sink is inside the disc");
			return {.cells = {sink}, .closedBasin = true};
		}
		const int	 size = grid.size;
		const int	 perimeter = 4 * (size - 1);
		const double spacing = static_cast<double>(perimeter) / count;
		const double start = rng.nextDouble() * perimeter;
		Outlets		 outlets;
		for (int outlet = 0; outlet < count; ++outlet) {
			const auto along = static_cast<int>(std::floor(start + (outlet + 0.25 + 0.5 * rng.nextDouble()) * spacing));
			outlets.cells.push_back(perimeterCell(size, along % perimeter));
		}
		return outlets;
	}

	double moistureLevel(double aridity) {
		return aridity;
	}

	double terracePull(double wetness) {
		return kTerraces.strength * smooth01((kTerraces.below - wetness) / (kTerraces.below - kTerraces.full));
	}

	double terraceHeight(double height, double pull) {
		return height + terraceLift(height) * pull;
	}

	double terraceLift(double height) {
		const double riser = kTerraces.riserEnd - kTerraces.riserStart;
		const double scaled = height * kTerraces.steps;
		const double bench = std::floor(scaled);
		return (bench + smooth01((scaled - bench - kTerraces.riserStart) / riser)) / kTerraces.steps - height;
	}

	double terraceSlope(double height, double pull) {
		const double riser = kTerraces.riserEnd - kTerraces.riserStart;
		const double scaled = height * kTerraces.steps;
		const double bench = std::floor(scaled);
		return 1 + (smoothSlope((scaled - bench - kTerraces.riserStart) / riser) / riser - 1) * pull;
	}

} // namespace rules::map
