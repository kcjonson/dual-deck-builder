#include "MapLabels.h"

#include "LandGrid.h"
#include "PoiData.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <utility>

namespace rules::map {

	namespace {

		// Rivers: named draining kRiverNamed times the stream threshold where they end, with kRiverCourse world units
		// of course inside kRiverReach of the radius, a river from kBigRiver times and a creek under it; labelled from
		// kRiverLabelled times over the dressing's scale, a candidate every kRiverEvery world units of course, each set
		// along kRiverHalf either side of its anchor.
		constexpr double kRiverNamed = 4;
		constexpr double kBigRiver = 25;
		constexpr double kRiverCourse = 120;
		constexpr double kRiverReach = 0.92;
		constexpr double kRiverLabelled = 8;
		constexpr double kRiverEvery = 450;
		constexpr double kRiverHalf = 90;
		// Lakes: named from kLakeNamed cells with their middle inside kLakeReach of the radius, labelled from
		// kLakeLabelled cells over the scale.
		constexpr int	 kLakeNamed = 3;
		constexpr double kLakeReach = 0.95;
		constexpr double kLakeLabelled = 6;
		// Ranges: land cells where the range mask is past kRangeMask, inside kRangeReach of the radius; named from
		// kRangeNamed cells, mountains from a peak elevation of kMountainPeak, labelled from kRangeLabelled cells over
		// the scale, kRangeSpread spreads either side of the middle.
		constexpr double kRangeMask = 0.5;
		constexpr double kRangeReach = 0.95;
		constexpr int	 kRangeNamed = 30;
		constexpr double kMountainPeak = 0.55;
		constexpr double kRangeLabelled = 60;
		constexpr double kRangeSpread = 1.6;
		// Shields: kShieldSpacing of the radius apart along a number.
		constexpr double kShieldSpacing = 0.35;

		// Under 1, more for a bigger one of its kind.
		double share(double size, double largest) {
			return 0.99 * size / std::max(1.0, largest);
		}

		struct FoundRiver {
			int				   river{0};
			double			   area{0};
			std::vector<Point> course;
		};

		// Rivers big enough to name with course enough inside the reach, biggest first, ties by index.
		std::vector<FoundRiver> riversToName(const Water& water, int radius) {
			const double			reach = kRiverReach * radius;
			std::vector<FoundRiver> found;
			for (size_t index = 0; index < water.rivers().size(); ++index) {
				const River& river = water.rivers()[index];
				if (river.area < kRiverNamed * water.threshold()) {
					continue;
				}
				std::vector<Point> best;
				std::vector<Point> run;
				const auto		   finish = [&] {
					if (polylineLength(run) > polylineLength(best)) {
						best = run;
					}
					run.clear();
				};
				for (const RiverPoint& point : river.line) {
					if (point.x * point.x + point.y * point.y <= reach * reach) {
						run.push_back({.x = point.x, .y = point.y});
					} else {
						finish();
					}
				}
				finish();
				if (polylineLength(best) >= kRiverCourse) {
					found.push_back({.river = static_cast<int>(index), .area = river.area, .course = std::move(best)});
				}
			}
			std::ranges::stable_sort(found, [](const FoundRiver& a, const FoundRiver& b) { return a.area > b.area; });
			return found;
		}

		// Lakes big enough to name with their middle inside the reach, in the water's order, each at its cell nearest
		// that middle.
		std::vector<NamedLake> lakesToName(const Terrain& terrain, const Water& water, int radius) {
			const LandGrid&		grid = terrain.surface().grid;
			const auto&			lakes = water.lakes();
			std::vector<int>	nearest(lakes.size(), -1);
			std::vector<double> distance(lakes.size(), std::numeric_limits<double>::infinity());
			for (int cell = 0; cell < grid.cells(); ++cell) {
				const int lake = water.lakeOf()[static_cast<size_t>(cell)];
				if (lake < 0) {
					continue;
				}
				const double dx = cellCentre(grid, cell % grid.size) - lakes[static_cast<size_t>(lake)].x;
				const double dy = cellCentre(grid, cell / grid.size) - lakes[static_cast<size_t>(lake)].y;
				if (dx * dx + dy * dy < distance[static_cast<size_t>(lake)]) {
					distance[static_cast<size_t>(lake)] = dx * dx + dy * dy;
					nearest[static_cast<size_t>(lake)] = cell;
				}
			}
			const double		   reach = kLakeReach * radius;
			std::vector<NamedLake> found;
			for (size_t index = 0; index < lakes.size(); ++index) {
				const Lake& lake = lakes[index];
				const int	cell = nearest[index];
				if (lake.x * lake.x + lake.y * lake.y > reach * reach || lake.cells < kLakeNamed || cell < 0) {
					continue;
				}
				found.push_back({
					.lake = static_cast<int>(index),
					.name = {},
					.at = {.x = cellCentre(grid, cell % grid.size), .y = cellCentre(grid, cell / grid.size)},
				});
			}
			return found;
		}

		// The ranges, pieces of land cells side by side where the range mask is past half inside the reach, biggest
		// first, ties by their first cell; each one's long axis is its cells' principal axis, from their covariance.
		std::vector<NamedRange> rangesToName(const Terrain& terrain, int radius) {
			const LandSurface& land = terrain.surface();
			const int		   size = land.grid.size;
			const double	   reach = kRangeReach * radius;
			const auto		   inRange = [&](int cell) {
				if (land.mountains[static_cast<size_t>(cell)] < kRangeMask) {
					return false;
				}
				const double x = cellCentre(land.grid, cell % size);
				const double y = cellCentre(land.grid, cell / size);
				return x * x + y * y <= reach * reach;
			};
			std::vector<uint8_t>	seen(static_cast<size_t>(land.grid.cells()));
			std::vector<NamedRange> found;
			std::vector<int>		pending;
			const auto				visit = [&](int cell) {
				 if (seen[static_cast<size_t>(cell)] == 0 && inRange(cell)) {
					 seen[static_cast<size_t>(cell)] = 1;
					 pending.push_back(cell);
				 }
			};
			for (int first = 0; first < land.grid.cells(); ++first) {
				if (seen[static_cast<size_t>(first)] == 1 || !inRange(first)) {
					continue;
				}
				seen[static_cast<size_t>(first)] = 1;
				pending.push_back(first);
				int	   count = 0;
				double sumX = 0;
				double sumY = 0;
				double sumXX = 0;
				double sumXY = 0;
				double sumYY = 0;
				double peak = 0;
				while (!pending.empty()) {
					const int cell = pending.back();
					pending.pop_back();
					const int	 column = cell % size;
					const int	 row = cell / size;
					const double x = cellCentre(land.grid, column);
					const double y = cellCentre(land.grid, row);
					count += 1;
					sumX += x;
					sumY += y;
					sumXX += x * x;
					sumXY += x * y;
					sumYY += y * y;
					peak = std::max(peak, land.elevation[static_cast<size_t>(cell)]);
					if (column > 0) {
						visit(cell - 1);
					}
					if (column < size - 1) {
						visit(cell + 1);
					}
					if (row > 0) {
						visit(cell - size);
					}
					if (row < size - 1) {
						visit(cell + size);
					}
				}
				if (count < kRangeNamed) {
					continue;
				}
				const double x = sumX / count;
				const double y = sumY / count;
				const double xx = sumXX / count - x * x;
				const double xy = sumXY / count - x * y;
				const double yy = sumYY / count - y * y;
				// The covariance's larger eigenvalue and its eigenvector: the long axis.
				const double half = (xx - yy) / 2;
				const double major = (xx + yy) / 2 + std::sqrt(half * half + xy * xy);
				double		 ux = xy;
				double		 uy = major - xx;
				if (ux * ux + uy * uy < 1e-12) {
					ux = xx >= yy ? 1 : 0;
					uy = xx >= yy ? 0 : 1;
				}
				// Read west to east, or south to north when it runs north and south.
				const double norm = std::sqrt(ux * ux + uy * uy) * (ux < 0 || (ux == 0 && uy < 0) ? -1 : 1);
				found.push_back({
					.name = {},
					.cells = count,
					.mountains = peak >= kMountainPeak,
					.middle = {.x = x, .y = y},
					.axis = {.x = ux / norm, .y = uy / norm},
					.spread = std::sqrt(std::max(0.0, major)),
				});
			}
			std::ranges::stable_sort(found, [](const NamedRange& a, const NamedRange& b) { return a.cells > b.cells; });
			return found;
		}

		// A range's label path: its long axis kRangeSpread spreads either side of its middle, drawn in until both ends
		// are inside the reach.
		std::vector<Point> rangeAxis(const NamedRange& range, int radius) {
			const double reach = kRangeReach * radius;
			const auto	 end = [&](double along) {
				  return Point{.x = range.middle.x + range.axis.x * along, .y = range.middle.y + range.axis.y * along};
			};
			const auto inside = [&](double along) {
				const Point at = end(along);
				return at.x * at.x + at.y * at.y <= reach * reach;
			};
			double half = kRangeSpread * range.spread;
			while (half > 1 && !(inside(half) && inside(-half))) {
				half *= 0.9;
			}
			return {end(-half), end(half)};
		}

		struct Shield {
			Point  at;
			int	   highway{0};
			double rank{0};
		};

		// Each highway's stretches outside the metro, one a stretch at its middle, kShieldSpacing of the radius apart
		// along a number, the rim's first, ties by stretch.
		std::vector<Shield> shields(const RoadNetwork& network, int radius) {
			const double		spacing = kShieldSpacing * radius;
			std::vector<Shield> found;
			for (size_t highway = 0; highway < network.routeNumbers.size(); ++highway) {
				std::vector<std::pair<double, Point>> candidates;
				for (const RoadStretch& stretch : network.stretches) {
					if (stretch.highway == static_cast<int>(highway) && !stretch.street) {
						const Point at = pointAlong(stretch.points, stretch.length / 2);
						candidates.emplace_back(at.x * at.x + at.y * at.y, at);
					}
				}
				std::ranges::stable_sort(candidates, [](const auto& a, const auto& b) { return a.first > b.first; });
				std::vector<Point> kept;
				for (const auto& [out, at] : candidates) {
					const bool crowded = std::ranges::any_of(kept, [&](Point other) {
						return (other.x - at.x) * (other.x - at.x) + (other.y - at.y) * (other.y - at.y) < spacing * spacing;
					});
					if (!crowded) {
						kept.push_back(at);
					}
				}
				for (size_t rank = 0; rank < kept.size(); ++rank) {
					found.push_back({.at = kept[rank], .highway = static_cast<int>(highway), .rank = 0.99 / static_cast<double>(rank + 1)});
				}
			}
			return found;
		}

		std::string capitals(std::string text) {
			for (char& letter : text) {
				letter = static_cast<char>(std::toupper(static_cast<unsigned char>(letter)));
			}
			return text;
		}

	} // namespace

	MapNames nameMap(const MapNameArgs& args) {
		const int				 radius = args.terrain.radius();
		std::vector<std::string> taken;
		for (const Settlement& town : args.places.towns()) {
			taken.push_back(town.name);
		}
		for (const Settlement& village : args.places.villages()) {
			taken.push_back(village.name);
		}
		MapNames names{
			.metro = PlaceNamer(args.placeNames, args.stream.fork("metro"), taken).next(),
			.rivers = {},
			.lakes = {},
			.ranges = {},
			.passes = {}
		};
		FeatureNamer features(args.featureNames, args.stream.fork("features"));
		for (FoundRiver& river : riversToName(args.water, radius)) {
			const FeatureKind kind = river.area >= kBigRiver * args.water.threshold() ? FeatureKind::River : FeatureKind::Creek;
			names.rivers.push_back({.river = river.river, .name = features.next(kind), .course = std::move(river.course)});
		}
		names.lakes = lakesToName(args.terrain, args.water, radius);
		for (NamedLake& lake : names.lakes) {
			const bool reservoir = args.water.lakes()[static_cast<size_t>(lake.lake)].kind == LakeKind::Reservoir;
			lake.name = features.next(reservoir ? FeatureKind::Reservoir : FeatureKind::Lake);
		}
		names.ranges = rangesToName(args.terrain, radius);
		for (NamedRange& range : names.ranges) {
			range.name = features.next(range.mountains ? FeatureKind::Mountains : FeatureKind::Hills);
		}
		for (size_t pass = 0; pass < args.passes.size(); ++pass) {
			names.passes.push_back(features.next(FeatureKind::Pass));
		}
		return names;
	}

	std::vector<MapLabel> mapLabels(const MapLabelArgs& args) {
		const MapNames&		  names = args.names;
		std::vector<MapLabel> labels;
		const auto			  point = [&](LabelKind kind, std::string text, double size, Point at, int ref) {
			   labels.push_back({
						   .kind = kind,
						   .text = std::move(text),
						   .priority = kLabelPriority[static_cast<size_t>(kind)] + size,
						   .at = at,
						   .path = {},
						   .ref = ref,
			   });
		};
		point(LabelKind::Metro, capitals(names.metro), 0, {}, 0);
		for (size_t index = 0; index < args.pois.pois.size(); ++index) {
			const Poi& poi = args.pois.pois[index];
			point(
				poi.type == kStrongholdType ? LabelKind::Stronghold : LabelKind::Poi,
				args.poiNames[index],
				0,
				poi.site.at,
				static_cast<int>(index)
			);
		}
		double largestTown = 0;
		for (const Settlement& town : args.places.towns()) {
			largestTown = std::max(largestTown, town.radius);
		}
		for (const Settlement& town : args.places.towns()) {
			point(LabelKind::Town, town.name, share(town.radius, largestTown), {.x = town.x, .y = town.y}, town.id);
		}
		for (const Shield& shield : shields(args.network, args.radius)) {
			point(
				LabelKind::Shield,
				std::to_string(args.network.routeNumbers[static_cast<size_t>(shield.highway)]),
				shield.rank,
				shield.at,
				shield.highway
			);
		}
		if (args.scale > 0) {
			double largestRange = 0;
			for (const NamedRange& range : names.ranges) {
				largestRange = std::max(largestRange, static_cast<double>(range.cells));
			}
			for (size_t index = 0; index < names.ranges.size(); ++index) {
				const NamedRange& range = names.ranges[index];
				if (range.cells * args.scale >= kRangeLabelled) {
					labels.push_back({
						.kind = LabelKind::Range,
						.text = range.name,
						.priority = kLabelPriority[static_cast<size_t>(LabelKind::Range)] + share(range.cells, largestRange),
						.at = range.middle,
						.path = rangeAxis(range, args.radius),
						.ref = static_cast<int>(index),
					});
				}
			}
			double largestLake = 0;
			for (const NamedLake& lake : names.lakes) {
				largestLake = std::max(largestLake, static_cast<double>(args.water.lakes()[static_cast<size_t>(lake.lake)].cells));
			}
			for (const NamedLake& lake : names.lakes) {
				const Lake& water = args.water.lakes()[static_cast<size_t>(lake.lake)];
				if (water.cells * args.scale >= kLakeLabelled) {
					const LabelKind kind = water.kind == LakeKind::Reservoir ? LabelKind::Reservoir : LabelKind::Lake;
					point(kind, lake.name, share(water.cells, largestLake), lake.at, lake.lake);
				}
			}
			double largestRiver = 0;
			for (const NamedRiver& river : names.rivers) {
				largestRiver = std::max(largestRiver, args.water.rivers()[static_cast<size_t>(river.river)].area);
			}
			for (const NamedRiver& river : names.rivers) {
				const double area = args.water.rivers()[static_cast<size_t>(river.river)].area;
				if (area * args.scale < kRiverLabelled * args.water.threshold()) {
					continue;
				}
				const double length = polylineLength(river.course);
				const int	 count = std::max(1, static_cast<int>(length / kRiverEvery));
				for (int index = 0; index < count; ++index) {
					const double middle = length * (index + 0.5) / count;
					labels.push_back({
						.kind = LabelKind::River,
						.text = river.name,
						.priority = kLabelPriority[static_cast<size_t>(LabelKind::River)] + share(area, largestRiver),
						.at = pointAlong(river.course, middle),
						.path = sliceAlong(river.course, middle - kRiverHalf, middle + kRiverHalf),
						.ref = river.river,
					});
				}
			}
		}
		double largestVillage = 0;
		for (const Settlement& village : args.places.villages()) {
			largestVillage = std::max(largestVillage, village.radius);
		}
		for (const Settlement& village : args.places.villages()) {
			point(LabelKind::Village, village.name, share(village.radius, largestVillage), {.x = village.x, .y = village.y}, village.id);
		}
		if (args.scale > 0) {
			for (size_t pass = 0; pass < names.passes.size(); ++pass) {
				const RoadPass& at = args.network.passes[pass];
				point(LabelKind::Pass, names.passes[pass], 0, {.x = at.x, .y = at.y}, static_cast<int>(pass));
			}
		}
		std::ranges::stable_sort(labels, [](const MapLabel& a, const MapLabel& b) { return a.priority > b.priority; });
		return labels;
	}

} // namespace rules::map
