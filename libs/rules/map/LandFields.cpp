#include "LandFields.h"

#include "MapMath.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>
#include <numbers>
#include <utility>

namespace rules::map {

	namespace {

		// Contamination: 2 octaves of 450-unit noise, going from none to full over 1 / `sharpness` of it round
		// the calibrated threshold, calibrated on a lattice `calibration` of the radius apart.
		struct Contamination {
			double wavelength = 450;
			int	   octaves = 2;
			float  gain = 0.5F;
			double sharpness = 3;
			double calibration = 0.05;
		};

		// Rough country: the eroded grade averaged `blur` cells each way, swayed by `breaks` of a noise layer
		// `wavelength` units across, which breaks a steep belt into stretches with gaps where a road can climb;
		// `shareGentle` to `shareRugged` of the land past the relief radius by ruggedness.
		struct Roughness {
			int	   blur = 1;
			double shareGentle = 0.1;
			double shareRugged = 0.35;
			double breaks = 0.7;
			double wavelength = 300;
			int	   octaves = 2;
		};

		// Cliffs: `share` times ruggedness squared of the land past the relief radius, the steepest of the rough
		// country, and none where the averaged grade is under `least`, so a gentle map's quota doesn't put
		// cliffs on mild slopes.
		struct Cliffs {
			double share = 0.05;
			double least = 0.5;
		};

		// Badlands: `share` times ruggedness of the land outside the ranges, weighted toward the toxic, going
		// from none to full over a quarter of their threshold either side of it.
		struct Badlands {
			double share = 0.7;
			double toxic = 0.7;
			double sharpness = 2;
		};

		// Features keep `reach` cells off any range lift, and off a range mask of `mask` entirely.
		struct RangeClearance {
			int	   reach = 3;
			double mask = 0.1;
		};

		constexpr Contamination	 kContamination;
		constexpr Roughness		 kRoughness;
		constexpr Cliffs		 kCliffs;
		constexpr Badlands		 kBadlands;
		constexpr RangeClearance kRangeClearance;

		double distanceSquared(const LandGrid& grid, int row, int column) {
			const double x = cellCentre(grid, column);
			const double y = cellCentre(grid, row);
			return x * x + y * y;
		}

		// The value `share` of the disc past `inner` lies above, from a square lattice of samples over it.
		template <typename Sample>
		double calibrate(int radius, double inner, double share, Sample&& sample) {
			if (share <= 0) {
				return std::numeric_limits<double>::infinity();
			}
			if (share >= 1) {
				return -std::numeric_limits<double>::infinity();
			}
			const double		step = kContamination.calibration * radius;
			std::vector<double> samples;
			for (int row = 0; row * step < 2 * radius; ++row) {
				const double y = (row + 0.5) * step - radius;
				for (int column = 0; column * step < 2 * radius; ++column) {
					const double x = (column + 0.5) * step - radius;
					const double away = x * x + y * y;
					if (away >= inner * inner && away <= static_cast<double>(radius) * radius) {
						samples.push_back(sample(x, y));
					}
				}
			}
			return quantileAbove(std::move(samples), share);
		}

		// A box blur `reach` cells each way, along rows then columns, held at the edges.
		std::vector<double> blurred(const std::vector<double>& values, int size, int reach) {
			const auto			span = static_cast<double>(2 * reach + 1);
			std::vector<double> across(values.size());
			std::vector<double> out(values.size());
			for (int row = 0; row < size; ++row) {
				for (int column = 0; column < size; ++column) {
					double sum = 0;
					for (int offset = -reach; offset <= reach; ++offset) {
						sum += values[static_cast<size_t>(row * size + std::clamp(column + offset, 0, size - 1))];
					}
					across[static_cast<size_t>(row * size + column)] = sum / span;
				}
			}
			for (int row = 0; row < size; ++row) {
				for (int column = 0; column < size; ++column) {
					double sum = 0;
					for (int offset = -reach; offset <= reach; ++offset) {
						sum += across[static_cast<size_t>(std::clamp(row + offset, 0, size - 1) * size + column)];
					}
					out[static_cast<size_t>(row * size + column)] = sum / span;
				}
			}
			return out;
		}

	} // namespace

	LandFields::LandFields(const MapParams& params, const LandSurface& land, const StartRadii& radii, const foundation::Rng& stream)
		: grid(land.grid),
		  radii(radii),
		  contaminationNoise(stream, "contamination") {
		const int  size = grid.size;
		const auto cells = static_cast<size_t>(grid.cells());

		contaminationThreshold = calibrate(params.radius, radii.blend, params.contamination, [&](double x, double y) {
			return contaminationNoise.fractal(
				x / kContamination.wavelength, y / kContamination.wavelength, kContamination.octaves, kContamination.gain
			);
		});

		// Steep land runs in belts along the ranges, so the noise breaks a belt into stretches. None within the
		// relief radius, by a cell's diagonal, so no point inside it reads as rough.
		steepness = blurred(cellGrades(land), size, kRoughness.blur);
		roughness.assign(cells, 0);
		const NoiseLayer breaks(stream, "roughness");
		const double	 clear = radii.relief + std::numbers::sqrt2 * grid.cellSize;
		for (int row = 0; row < size; ++row) {
			for (int column = 0; column < size; ++column) {
				const auto cell = static_cast<size_t>(row * size + column);
				if (distanceSquared(grid, row, column) < clear * clear) {
					steepness[cell] = 0;
					continue;
				}
				const double sway = breaks.fractal(
					cellCentre(grid, column) / kRoughness.wavelength,
					cellCentre(grid, row) / kRoughness.wavelength,
					kRoughness.octaves,
					0.5F
				);
				roughness[cell] = steepness[cell] * (1 + kRoughness.breaks * sway);
			}
		}
		const double roughShare = lerp(kRoughness.shareGentle, kRoughness.shareRugged, params.ruggedness);
		const double rough = quantileAbove(landValues(land, params.radius, radii.relief, roughness, true), roughShare);
		// Ground with no grade at all is never rough, which only a map flatter than any erosion makes would need.
		roughThreshold = rough > 0 ? rough : std::numeric_limits<double>::infinity();
		std::vector<double> roughSteepness(cells);
		for (size_t cell = 0; cell < cells; ++cell) {
			roughSteepness[cell] = roughness[cell] >= roughThreshold ? steepness[cell] : 0;
		}
		const double cliffShare = kCliffs.share * params.ruggedness * params.ruggedness;
		cliffThreshold =
			std::max(positiveQuantile(landValues(land, params.radius, radii.relief, roughSteepness, true), cliffShare), kCliffs.least);

		// A cliff needs both its bilinear fields past their thresholds, which can't pass a square's largest
		// corner, so a square whose four corners are all under either holds none.
		const int squares = size - 1;
		open.assign(static_cast<size_t>(squares) * static_cast<size_t>(squares), 0);
		const double radiusSquared = static_cast<double>(params.radius) * params.radius;
		for (int row = 0; row < squares; ++row) {
			for (int column = 0; column < squares; ++column) {
				const auto corner = static_cast<size_t>(row * size + column);
				const auto north = corner + static_cast<size_t>(size);
				const auto under = [&](const std::vector<double>& field, double threshold) {
					return field[corner] < threshold && field[corner + 1] < threshold && field[north] < threshold &&
						   field[north + 1] < threshold;
				};
				if (!under(roughness, roughThreshold) && !under(steepness, cliffThreshold)) {
					continue;
				}
				// The disc is convex, so the square is inside it when its farthest corner is.
				const double farX = std::max(std::abs(cellCentre(grid, column)), std::abs(cellCentre(grid, column + 1)));
				const double farY = std::max(std::abs(cellCentre(grid, row)), std::abs(cellCentre(grid, row + 1)));
				if (farX * farX + farY * farY <= radiusSquared) {
					open[static_cast<size_t>(row * squares + column)] = 1;
				}
			}
		}

		roomCells = featureRoom(land, radii);
		badlandsCells.assign(cells, 0);
		const double badlandsShare = kBadlands.share * params.ruggedness * (0.3 + 0.7 * params.contamination);
		if (badlandsShare > 0) {
			std::vector<double> broken(cells);
			for (int row = 0; row < size; ++row) {
				for (int column = 0; column < size; ++column) {
					const auto cell = static_cast<size_t>(row * size + column);
					if (roomCells[cell] > 0) {
						const double toxic = contamination(cellCentre(grid, column), cellCentre(grid, row));
						broken[cell] = steepness[cell] * roomCells[cell] * (1 - kBadlands.toxic + kBadlands.toxic * toxic);
					}
				}
			}
			const double threshold = positiveQuantile(landValues(land, params.radius, radii.relief, broken, false), badlandsShare);
			if (threshold < std::numeric_limits<double>::infinity()) {
				for (size_t cell = 0; cell < cells; ++cell) {
					badlandsCells[cell] = smooth01((broken[cell] / threshold - 1) * kBadlands.sharpness + 0.5);
				}
			}
		}
	}

	double LandFields::contamination(double x, double y) const {
		const double away = x * x + y * y;
		if (away <= radii.metro * radii.metro || contaminationThreshold == std::numeric_limits<double>::infinity()) {
			return 0;
		}
		const double noise = contaminationNoise.fractal(
			x / kContamination.wavelength, y / kContamination.wavelength, kContamination.octaves, kContamination.gain
		);
		const double toxic = smooth01((noise - contaminationThreshold) * kContamination.sharpness + 0.5);
		return toxic * (1 - startWeight(radii, away));
	}

	bool LandFields::rough(double x, double y) const {
		return GridSampler(grid, roughness).bilinear(x, y) >= roughThreshold;
	}

	bool LandFields::cliff(double x, double y) const {
		return rough(x, y) && GridSampler(grid, steepness).bilinear(x, y) >= cliffThreshold;
	}

	double LandFields::cliffDepth(double x, double y) const {
		const double intoRough = GridSampler(grid, roughness).bilinear(x, y) / roughThreshold - 1;
		const double intoSteep = GridSampler(grid, steepness).bilinear(x, y) / cliffThreshold - 1;
		return std::min(intoRough, intoSteep);
	}

	double LandFields::badlands(double x, double y) const {
		return GridSampler(grid, badlandsCells).bilinear(x, y);
	}

	std::vector<double> cellGrades(const LandSurface& land) {
		const int			size = land.grid.size;
		const double		toGrade = kRelief / land.grid.cellSize;
		std::vector<double> grade(land.elevation.size());
		const auto			height = [&](int row, int column) {
			 return land.elevation[static_cast<size_t>(row * size + column)];
		};
		for (int row = 0; row < size; ++row) {
			const int below = std::max(row - 1, 0);
			const int above = std::min(row + 1, size - 1);
			for (int column = 0; column < size; ++column) {
				const int	 left = std::max(column - 1, 0);
				const int	 right = std::min(column + 1, size - 1);
				const double slopeX = (height(row, right) - height(row, left)) / (right - left) * toGrade;
				const double slopeY = (height(above, column) - height(below, column)) / (above - below) * toGrade;
				grade[static_cast<size_t>(row * size + column)] = std::sqrt(slopeX * slopeX + slopeY * slopeY);
			}
		}
		return grade;
	}

	std::vector<double> featureRoom(const LandSurface& land, const StartRadii& radii) {
		const LandGrid&		grid = land.grid;
		const int			size = grid.size;
		const int			reach = kRangeClearance.reach;
		std::vector<double> across(land.mountains.size());
		for (int row = 0; row < size; ++row) {
			for (int column = 0; column < size; ++column) {
				double most = 0;
				for (int at = std::max(0, column - reach); at <= std::min(size - 1, column + reach); ++at) {
					most = std::max(most, land.mountains[static_cast<size_t>(row * size + at)]);
				}
				across[static_cast<size_t>(row * size + column)] = most;
			}
		}
		const double		metroSquared = radii.metro * radii.metro;
		const double		reliefSquared = radii.relief * radii.relief;
		std::vector<double> room(land.mountains.size());
		for (int row = 0; row < size; ++row) {
			for (int column = 0; column < size; ++column) {
				double most = 0;
				for (int at = std::max(0, row - reach); at <= std::min(size - 1, row + reach); ++at) {
					most = std::max(most, across[static_cast<size_t>(at * size + column)]);
				}
				const double away = distanceSquared(grid, row, column);
				const double start = away >= reliefSquared ? 1 : smooth01((away - metroSquared) / (reliefSquared - metroSquared));
				room[static_cast<size_t>(row * size + column)] = start * (1 - smooth01(most / kRangeClearance.mask));
			}
		}
		return room;
	}

	std::vector<double> landValues(const LandSurface& land, int radius, double reliefRadius, std::span<const double> values, bool ranges) {
		const LandGrid&		grid = land.grid;
		const double		innerSquared = reliefRadius * reliefRadius;
		const double		outerSquared = static_cast<double>(radius) * radius;
		std::vector<double> all;
		std::vector<double> outside;
		for (int row = 0; row < grid.size; ++row) {
			for (int column = 0; column < grid.size; ++column) {
				const double away = distanceSquared(grid, row, column);
				if (away < innerSquared || away > outerSquared) {
					continue;
				}
				const auto cell = static_cast<size_t>(row * grid.size + column);
				all.push_back(values[cell]);
				if (land.mountains[cell] < 0.5) {
					outside.push_back(values[cell]);
				}
			}
		}
		return ranges || outside.empty() ? all : outside;
	}

} // namespace rules::map
