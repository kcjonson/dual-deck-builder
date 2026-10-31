#include "Hazards.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <optional>

namespace rules::map {

	namespace {

		// A hotspot draws its crater radius, its plume as a multiple of that, and its strength; centres sit
		// `spacing` of the radius apart, past the blend radius by the largest crater and inside `outer` of the
		// radius; one that finds no room in `attempts` candidates is left out.
		struct Placement {
			double craterMin = 14;
			double craterMax = 26;
			double plumeMin = 5;
			double plumeMax = 8;
			double strengthMin = 0.75;
			double strengthMax = 1;
			double spacing = 0.25;
			double outer = 0.9;
			int	   attempts = 48;
		};

		// Craters keep off the land's drainage, so no blast site sits on a river: no cell within `margin`
		// cells of the crater carries `area` cells of it, under the least a river needs at any riverDensity and
		// the heaviest rain. The water's routing can move a river a cell on flat ground, so the margin is two.
		// And no lake cell lies within `lakeGap` world units and a cell of the crater.
		struct Clearance {
			double area = 40;
			double margin = 2;
			double lakeGap = 20;
		};

		constexpr Placement kPlacement;
		constexpr Clearance kClearance;

		double between(foundation::Rng& rng, double min, double max) {
			return min + (max - min) * rng.nextDouble();
		}

		// Whether no cell whose centre lies within `reach` of (x, y) carries kClearance.area of the land's
		// drainage, and none within `lakeReach` is a lake.
		bool clearOf(const LandSurface& land, const Water& water, double x, double y, double reach, double lakeReach) {
			const LandGrid& grid = land.grid;
			const double	far = std::max(reach, lakeReach);
			const int		first = std::max(0, static_cast<int>(std::floor((x - far + grid.halfExtent) / grid.cellSize)));
			const int		last = std::min(grid.size - 1, static_cast<int>(std::floor((x + far + grid.halfExtent) / grid.cellSize)));
			const int		bottom = std::max(0, static_cast<int>(std::floor((y - far + grid.halfExtent) / grid.cellSize)));
			const int		top = std::min(grid.size - 1, static_cast<int>(std::floor((y + far + grid.halfExtent) / grid.cellSize)));
			for (int row = bottom; row <= top; ++row) {
				const double dy = cellCentre(grid, row) - y;
				for (int column = first; column <= last; ++column) {
					const double dx = cellCentre(grid, column) - x;
					const double squared = dx * dx + dy * dy;
					const auto	 cell = static_cast<size_t>(row * grid.size + column);
					if (squared <= reach * reach && land.drainage.area[cell] >= kClearance.area) {
						return false;
					}
					if (squared <= lakeReach * lakeReach && water.lakeOf()[cell] >= 0) {
						return false;
					}
				}
			}
			return true;
		}

		struct Point {
			double x;
			double y;
		};

		// The first of kPlacement.attempts candidates in the ring from `inner` to `outer` that `fits`. Each is
		// drawn in the ring's bounding square, two draws, until it lands in the ring.
		template <typename Fits>
		std::optional<Point> throwDart(foundation::Rng& rng, double inner, double outer, Fits&& fits) {
			if (!(outer > 0 && inner < outer)) {
				return std::nullopt;
			}
			const double innerSquared = inner > 0 ? inner * inner : 0;
			for (int attempt = 0; attempt < kPlacement.attempts; ++attempt) {
				Point  point{};
				double squared = 0;
				do {
					point = {.x = (rng.nextDouble() * 2 - 1) * outer, .y = (rng.nextDouble() * 2 - 1) * outer};
					squared = point.x * point.x + point.y * point.y;
				} while (squared < innerSquared || squared > outer * outer);
				if (fits(point)) {
					return point;
				}
			}
			return std::nullopt;
		}

	} // namespace

	Hazards::Hazards(const MapParams& params, const Terrain& terrain, const Water& water, const foundation::Rng& stream) {
		foundation::Rng	   rng = stream.fork("hotspots");
		const LandSurface& land = terrain.surface();
		const double	   spacing = kPlacement.spacing * params.radius;
		const double	   inner = terrain.start().blend + kPlacement.craterMax;
		const double	   outer = kPlacement.outer * params.radius;
		for (int index = 0; index < params.hotspots; ++index) {
			const double			   crater = between(rng, kPlacement.craterMin, kPlacement.craterMax);
			const double			   plume = crater * between(rng, kPlacement.plumeMin, kPlacement.plumeMax);
			const double			   strength = between(rng, kPlacement.strengthMin, kPlacement.strengthMax);
			const std::optional<Point> site = throwDart(rng, inner, outer, [&](Point point) {
				const bool spaced = std::ranges::all_of(sites, [&](const Hotspot& other) {
					return (point.x - other.x) * (point.x - other.x) + (point.y - other.y) * (point.y - other.y) >= spacing * spacing;
				});
				return spaced && clearOf(
									 land,
									 water,
									 point.x,
									 point.y,
									 crater + kClearance.margin * land.grid.cellSize,
									 crater + kClearance.lakeGap + land.grid.cellSize
								 );
			});
			if (site) {
				sites.push_back({.x = site->x, .y = site->y, .craterRadius = crater, .plumeRadius = plume, .strength = strength});
			}
		}
	}

	bool Hazards::crater(double x, double y) const {
		return std::ranges::any_of(sites, [&](const Hotspot& site) {
			return (x - site.x) * (x - site.x) + (y - site.y) * (y - site.y) < site.craterRadius * site.craterRadius;
		});
	}

	double Hazards::plumes(double x, double y, double contamination, double ceiling) const {
		double out = contamination;
		for (const Hotspot& site : sites) {
			const double squared = (x - site.x) * (x - site.x) + (y - site.y) * (y - site.y);
			const double reach = site.plumeRadius * site.plumeRadius;
			if (squared < reach) {
				const double falloff = 1 - squared / reach;
				out += site.strength * falloff * falloff * (ceiling - out);
			}
		}
		return out;
	}

} // namespace rules::map
