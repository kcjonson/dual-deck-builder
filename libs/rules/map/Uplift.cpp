#include "Uplift.h"

#include "MapMath.h"
#include "Noise.h"

#include <math/DeterministicMath.h>

#include <cstddef>
#include <numbers>
#include <utility>

namespace rules::map {

	namespace {

		// Rolling country, varying this much either way, lifting more with ruggedness. Round the metro it
		// fades to metroShare of itself rather than to nothing: ground with no lift erodes dead flat, and
		// drainage crosses a dead flat in ruler-straight lines.
		struct Hills {
			double wavelength = 450;
			int	   octaves = 3;
			float  gain = 0.5F;
			double variation = 0.8;
			double liftMin = 0.04;
			double liftMax = 0.12;
			double metroShare = 0.5;
		};

		// The belt layer's wavelengths along the grain and across it, and the lift over the hills. The mask
		// goes from none to full over `ramp` of the belt value, centred on the coverage threshold.
		struct Ranges {
			double alongWavelength = 1500;
			double acrossWavelength = 520;
			int	   octaves = 3;
			float  gain = 0.45F;
			double ramp = 0.26;
			double liftMin = 0.7;
			double liftMax = 1.8;
		};

		constexpr Hills	 kHills;
		constexpr Ranges kRanges;
		constexpr double kWarpWavelength = 800;
		constexpr double kWarpAmplitude = 160;
		// Where the warp's second axis samples, away from its first.
		constexpr double kWarpOffsetX = 40.7;
		constexpr double kWarpOffsetY = -40.3;
		constexpr double kBreaksWavelength = 500;
		constexpr int	 kBreaksOctaves = 2;
		constexpr double kBreaksWeight = 0.25;

	} // namespace

	UpliftField buildUplift(const UpliftArgs& args, const foundation::Rng& stream) {
		const NoiseLayer hills(stream, "hills");
		const NoiseLayer ranges(stream, "ranges");
		const NoiseLayer warp(stream, "rangeWarp");
		const NoiseLayer breaks(stream, "rangeBreaks");
		foundation::Rng	 grainStream = stream.fork("grain");
		const double	 grainAngle = grainStream.nextDouble() * std::numbers::pi;
		const double	 grainX = foundation::det_math::cos(grainAngle);
		const double	 grainY = foundation::det_math::sin(grainAngle);

		const LandGrid&		grid = args.grid;
		const int			size = grid.size;
		const auto			cells = static_cast<size_t>(grid.cells());
		const double		radiusSquared = args.radius * args.radius;
		const double		reliefSquared = args.reliefRadius * args.reliefRadius;
		std::vector<double> belts(cells);
		std::vector<double> calibration;
		for (int row = 0; row < size; ++row) {
			const double y = cellCentre(grid, row);
			for (int column = 0; column < size; ++column) {
				const double x = cellCentre(grid, column);
				const double warpedX = x + kWarpAmplitude * warp.sample(x / kWarpWavelength, y / kWarpWavelength);
				const double warpedY =
					y + kWarpAmplitude * warp.sample(x / kWarpWavelength + kWarpOffsetX, y / kWarpWavelength + kWarpOffsetY);
				const double along = warpedX * grainX + warpedY * grainY;
				const double across = warpedY * grainX - warpedX * grainY;
				const double belt =
					ranges.fractal(along / kRanges.alongWavelength, across / kRanges.acrossWavelength, kRanges.octaves, kRanges.gain) +
					kBreaksWeight * breaks.fractal(x / kBreaksWavelength, y / kBreaksWavelength, kBreaksOctaves, 0.5F);
				belts[static_cast<size_t>(row * size + column)] = belt;
				const double distanceSquared = x * x + y * y;
				if (distanceSquared >= reliefSquared && distanceSquared <= radiusSquared) {
					calibration.push_back(belt);
				}
			}
		}
		const double threshold = quantileAbove(std::move(calibration), args.mountainCoverage);

		const double hillLift = lerp(kHills.liftMin, kHills.liftMax, args.ruggedness);
		const double rangeLift = lerp(kRanges.liftMin, kRanges.liftMax, args.ruggedness);
		const double metroSquared = args.metroRadius * args.metroRadius;
		UpliftField	 field{
			 .uplift = std::vector<double>(cells), .mountains = std::vector<double>(cells), .grainX = grainX, .grainY = grainY
		 };
		for (int row = 0; row < size; ++row) {
			const double y = cellCentre(grid, row);
			for (int column = 0; column < size; ++column) {
				const double x = cellCentre(grid, column);
				const auto	 cell = static_cast<size_t>(row * size + column);
				const double distanceSquared = x * x + y * y;
				// On squared distance, as the rest of the start's blends are.
				const double fade =
					distanceSquared >= reliefSquared ? 1 : smooth01((distanceSquared - metroSquared) / (reliefSquared - metroSquared));
				const double mask = fade > 0 ? fade * smooth01((belts[cell] - threshold) / kRanges.ramp + 0.5) : 0;
				const double hillNoise = hills.fractal(x / kHills.wavelength, y / kHills.wavelength, kHills.octaves, kHills.gain);
				const double lift = hillLift * (1 + kHills.variation * hillNoise);
				field.uplift[cell] = (kHills.metroShare + (1 - kHills.metroShare) * fade) * lift + rangeLift * mask;
				field.mountains[cell] = mask;
			}
		}
		return field;
	}

} // namespace rules::map
