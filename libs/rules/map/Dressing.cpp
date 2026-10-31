#include "Dressing.h"

#include "Biome.h"
#include "LandGrid.h"

#include <algorithm>
#include <cmath>
#include <cstddef>

namespace rules::map {

	namespace {

		// Hatching runs out to where a plume's contamination falls to kHatchLevel, kHatchSpacing world units between
		// lines at the default dressing, at kHatchAngle degrees turned up to kHatchTurn either way.
		constexpr double kHatchLevel = 0.15;
		constexpr double kHatchSpacing = 8;
		constexpr double kHatchAngle = 45;
		constexpr double kHatchTurn = 15;
		// World units across a stipple cell at the default dressing.
		constexpr double kStippleSpacing = 12;

	} // namespace

	double dressingScale(double dressing) {
		return dressing / paramSpec(NumberParam::Dressing).defaultValue;
	}

	std::vector<HatchRegion> hatchRegions(HatchArgs args) {
		std::vector<HatchRegion> regions;
		if (!(args.scale > 0)) {
			return regions;
		}
		for (const Hotspot& hotspot : args.hotspots) {
			const double turn = (args.stream.nextDouble() * 2 - 1) * kHatchTurn;
			if (hotspot.x * hotspot.x + hotspot.y * hotspot.y > static_cast<double>(args.radius) * args.radius ||
				hotspot.strength <= kHatchLevel) {
				continue;
			}
			// A plume is strength (1 - d^2 / r^2)^2, so it falls to the level at r sqrt(1 - sqrt(level / strength)).
			const double outer = hotspot.plumeRadius * std::sqrt(1 - std::sqrt(kHatchLevel / hotspot.strength));
			if (outer <= hotspot.craterRadius) {
				continue;
			}
			const Point towards = unitVector(kHatchAngle + turn);
			regions.push_back({
				.at = {.x = hotspot.x, .y = hotspot.y},
				.inner = hotspot.craterRadius,
				.outer = outer,
				.ux = towards.x,
				.uy = towards.y,
				.spacing = kHatchSpacing / args.scale,
			});
		}
		return regions;
	}

	std::vector<Point> mireStipple(StippleArgs args) {
		std::vector<Point> dots;
		if (!(args.scale > 0)) {
			return dots;
		}
		const double	  spacing = kStippleSpacing / std::sqrt(args.scale);
		const double	  radius = args.ground.terrain().radius();
		const auto		  cells = static_cast<int>(std::floor(2 * radius / spacing)) + 1;
		const GridSampler lowland(args.ground.terrain().surface().grid, args.ground.water().lowland());
		for (int row = 0; row < cells; ++row) {
			for (int column = 0; column < cells; ++column) {
				// Every cell takes its two draws, so one cell's dot never moves another's.
				const double x = -radius + (column + args.stream.nextDouble()) * spacing;
				const double y = -radius + (row + args.stream.nextDouble()) * spacing;
				// Mire is only ever low ground, which is cheap to ask first.
				if (x * x + y * y > radius * radius || lowland.bilinear(x, y) < kBiomeThresholds.mireLowland) {
					continue;
				}
				if (args.ground.biome(x, y) == Biome::Mire && args.ground.waterAt(x, y) == WaterKind::None) {
					dots.push_back({.x = x, .y = y});
				}
			}
		}
		return dots;
	}

	Dressing generateDressing(const DressingArgs& args) {
		const double scale = dressingScale(args.params.dressing);
		const double thinned = std::min(scale, 1.0);
		Dressing	 dressing;
		dressing.names = nameMap({
			.terrain = args.ground.terrain(),
			.water = args.ground.water(),
			.places = args.places,
			.passes = args.network.passes,
			.placeNames = args.placeNames,
			.featureNames = args.featureNames,
			.stream = args.stream.fork("names"),
		});
		dressing.labels = mapLabels({
			.names = dressing.names,
			.water = args.ground.water(),
			.places = args.places,
			.network = args.network,
			.pois = args.pois,
			.poiNames = args.poiNames,
			.radius = args.params.radius,
			.scale = scale,
		});
		dressing.rails = railLines({
			.ground = args.ground,
			.count = static_cast<int>(std::lround(args.params.railLines * thinned)),
			.stream = args.stream.fork("rails"),
		});
		// Roads, collapsed spans, and rails all run through the grids, so their blocks are street.
		std::vector<std::span<const Point>> lines;
		for (const RoadStretch& stretch : args.network.stretches) {
			lines.emplace_back(stretch.points);
		}
		for (const RoadStretch& span : args.network.broken) {
			lines.emplace_back(span.points);
		}
		for (const RailLine& rail : dressing.rails) {
			lines.emplace_back(rail.points);
		}
		const std::vector<Ruin> ruins = ruinsOf(args.places);
		dressing.districts = streetGrids({
			.ruins = ruins,
			.lines = lines,
			.ground = args.ground,
			.built = args.params.streetGrids,
			.cover = thinned,
			.stream = args.stream.fork("grids"),
		});
		dressing.hatches = hatchRegions({
			.hotspots = args.ground.hotspots(),
			.radius = args.params.radius,
			.scale = scale,
			.stream = args.stream.fork("hatches"),
		});
		dressing.stipple = mireStipple({.ground = args.ground, .scale = scale, .stream = args.stream.fork("stipple")});
		return dressing;
	}

} // namespace rules::map
