#include "Places.h"

#include "Land.h"
#include "LandFields.h"
#include "MapMath.h"

#include <math/DeterministicMath.h>

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <limits>
#include <numbers>
#include <utility>

namespace rules::map {

	namespace {

		constexpr double kInfinity = std::numeric_limits<double>::infinity();

		// Towns a quarter of the radius apart and villages a tenth, villages that far from towns too; their
		// ruins a share of the metro's radius, at least `floor` units.
		struct SettlementRules {
			double spacing;
			double ruinMin;
			double ruinMax;
			double ruinFloor;
		};

		constexpr SettlementRules kTowns{.spacing = 0.25, .ruinMin = 0.25, .ruinMax = 0.4, .ruinFloor = 20};
		constexpr SettlementRules kVillages{.spacing = 0.1, .ruinMin = 0.08, .ruinMax = 0.14, .ruinFloor = 8};

		// Settlements sit past the metro's edge by `metroGap` of their spacing and inside `outer` of the radius.
		struct Settled {
			double metroGap = 0.8;
			double outer = 0.92;
		};

		// A cell's score: `flat` for level ground, gone at `flatGrade`; `valley` of the low ground; `river`
		// beside a river or lake, gone `riverReach` units off, half for a creek and full `riverSize` steps of the
		// square root of the area's multiple of the threshold up, `lake` for a lake; `confluence` near one, gone
		// `confluenceReach` off; less `height` of elevation and `ranges` of the range mask, none where the mask
		// reaches `heart`; plus `noise` of an even draw.
		struct Suitability {
			double flat = 1.2;
			double flatGrade = 0.25;
			double valley = 0.6;
			double river = 1.1;
			double riverReach = 60;
			double riverSize = 4;
			double lake = 0.75;
			double confluence = 0.6;
			double confluenceReach = 90;
			double height = 0.8;
			double ranges = 1.2;
			double heart = 0.5;
			double noise = 0.4;
		};

		// Crossroads `sparse` units apart at roadDensity 0 to `dense` at 1, `others` of that from towns,
		// villages and exits, past the metro by `metro` of it, no steeper than `grade`, inside `outer` of the
		// radius.
		struct CrossroadsRules {
			double sparse = 140;
			double dense = 70;
			double others = 0.75;
			double metro = 0.5;
			double grade = 0.6;
			double outer = 0.93;
		};

		// Exits sit `inset` cells in from the rim, or up to `depth` cells further in at `inward` of grade a cell;
		// slide up to `slide` degrees a `step` at a time to the least grade, plus `penalty` a degree slid; and a
		// back road's goes in each gap of `backGap` degrees or more, `backClearance` off the highway exits.
		struct ExitRules {
			double inset = 1.5;
			int	   depth = 6;
			double inward = 0.02;
			double slide = 8;
			double step = 1;
			double penalty = 0.0175;
			double backGap = 30;
			double backClearance = 12;
			// Draws of the jitter before it's squeezed to fit the separation.
			int bearingDraws = 16;
		};

		constexpr Settled		  kSettled;
		constexpr Suitability	  kSuitability;
		constexpr CrossroadsRules kCrossroads;
		constexpr ExitRules		  kExits;
		// World units every place keeps off a river's water.
		constexpr double kRiverClearance = 4;
		// World units of clear ground between a crater's edge and a place's ruins.
		constexpr double kCraterGap = 20;

		struct Point {
			double x;
			double y;
		};

		double centreX(const LandGrid& grid, int cell) {
			return cellCentre(grid, cell % grid.size);
		}

		double centreY(const LandGrid& grid, int cell) {
			return cellCentre(grid, cell / grid.size);
		}

		bool farFrom(double x, double y, const std::vector<Point>& points, double squared) {
			return std::ranges::all_of(points, [&](const Point& point) {
				return (x - point.x) * (x - point.x) + (y - point.y) * (y - point.y) >= squared;
			});
		}

		bool clearOfCraters(const std::vector<Hotspot>& hotspots, double x, double y, double radius) {
			return std::ranges::all_of(hotspots, [&](const Hotspot& site) {
				const double clearance = site.craterRadius + radius + kCraterGap;
				return (x - site.x) * (x - site.x) + (y - site.y) * (y - site.y) >= clearance * clearance;
			});
		}

		// The square holding (x, y), or -1 off the squares.
		int squareAt(const LandGrid& grid, double x, double y) {
			const double column = std::floor((x + grid.halfExtent) / grid.cellSize - 0.5);
			const double row = std::floor((y + grid.halfExtent) / grid.cellSize - 0.5);
			const int	 squares = grid.size - 1;
			if (column < 0 || row < 0 || column >= squares || row >= squares) {
				return -1;
			}
			return static_cast<int>(row) * squares + static_cast<int>(column);
		}

		double normalised(double bearing) {
			const double turned = std::fmod(bearing, 360);
			return turned < 0 ? turned + 360 : turned;
		}

		double arc(double from, double to) {
			return normalised(to - from);
		}

		// Each cell's chamfer distance to the nearest source, a cell across or a diagonal at a step, and the
		// value that source carries; sources are cells of 0 or more.
		struct Distance {
			std::vector<double> distance;
			std::vector<double> value;
		};

		Distance distanceField(const LandGrid& grid, const std::vector<double>& sources) {
			const int	 size = grid.size;
			const double across = grid.cellSize;
			const double diagonal = grid.cellSize * std::numbers::sqrt2;
			Distance field{.distance = std::vector<double>(sources.size(), kInfinity), .value = std::vector<double>(sources.size(), -1)};
			for (size_t cell = 0; cell < sources.size(); ++cell) {
				if (sources[cell] >= 0) {
					field.distance[cell] = 0;
					field.value[cell] = sources[cell];
				}
			}
			const auto relax = [&](int cell, int from, double step) {
				const double through = field.distance[static_cast<size_t>(from)] + step;
				if (through < field.distance[static_cast<size_t>(cell)]) {
					field.distance[static_cast<size_t>(cell)] = through;
					field.value[static_cast<size_t>(cell)] = field.value[static_cast<size_t>(from)];
				}
			};
			for (int row = 0; row < size; ++row) {
				for (int column = 0; column < size; ++column) {
					const int cell = row * size + column;
					if (column > 0) {
						relax(cell, cell - 1, across);
					}
					if (row > 0) {
						relax(cell, cell - size, across);
						if (column > 0) {
							relax(cell, cell - size - 1, diagonal);
						}
						if (column < size - 1) {
							relax(cell, cell - size + 1, diagonal);
						}
					}
				}
			}
			for (int row = size - 1; row >= 0; --row) {
				for (int column = size - 1; column >= 0; --column) {
					const int cell = row * size + column;
					if (column < size - 1) {
						relax(cell, cell + 1, across);
					}
					if (row < size - 1) {
						relax(cell, cell + size, across);
						if (column < size - 1) {
							relax(cell, cell + size + 1, diagonal);
						}
						if (column > 0) {
							relax(cell, cell + size - 1, diagonal);
						}
					}
				}
			}
			return field;
		}

		// Every cell's score and whether a place may stand on it, and the scored cells best first.
		struct Sites {
			std::vector<double>	 grade;
			std::vector<uint8_t> usable;
			std::vector<double>	 suitability;
			std::vector<double>	 lakeDistance;
			std::vector<int>	 ranked;
		};

		Sites siteField(
			const MapParams&			params,
			const Terrain&				terrain,
			const Water&				water,
			const std::vector<uint8_t>& reached,
			foundation::Rng&&			rng
		) {
			const LandSurface& land = terrain.surface();
			const LandGrid&	   grid = land.grid;
			const int		   size = grid.size;
			const auto		   cells = land.elevation.size();
			const Drainage&	   routing = water.drainage();
			const double	   threshold = water.threshold();
			const auto		   lakeOf = water.lakeOf();
			const auto		   isRiver = [&](int cell) {
				return routing.area[static_cast<size_t>(cell)] >= threshold && lakeOf[static_cast<size_t>(cell)] < 0;
			};
			std::vector<double>	 riverSources(cells, -1);
			std::vector<double>	 lakeSources(cells, -1);
			std::vector<uint8_t> joins(cells);
			for (int cell = 0; cell < static_cast<int>(cells); ++cell) {
				const auto at = static_cast<size_t>(cell);
				if (lakeOf[at] >= 0) {
					riverSources[at] = kSuitability.lake;
					lakeSources[at] = 1;
				} else if (isRiver(cell)) {
					const double steps = (std::sqrt(routing.area[at] / threshold) - 1) / kSuitability.riverSize;
					riverSources[at] = 0.5 + 0.5 * std::min(steps, 1.0);
					const int receiver = routing.receivers[at];
					if (receiver >= 0 && isRiver(receiver) && joins[static_cast<size_t>(receiver)] < 2) {
						joins[static_cast<size_t>(receiver)] += 1;
					}
				}
			}
			std::vector<double> confluenceSources(cells, -1);
			for (size_t cell = 0; cell < cells; ++cell) {
				if (joins[cell] >= 2) {
					confluenceSources[cell] = 1;
				}
			}
			const Distance river = distanceField(grid, riverSources);
			const Distance confluence = distanceField(grid, confluenceSources);
			Sites		   sites{
						 .grade = cellGrades(land),
						 .usable = std::vector<uint8_t>(cells),
						 .suitability = std::vector<double>(cells, -kInfinity),
						 .lakeDistance = distanceField(grid, lakeSources).distance,
						 .ranked = {},
			 };
			// Drawn for every cell in order, so one cell's noise never depends on another's.
			std::vector<double> noise(cells);
			for (double& draw : noise) {
				draw = rng.nextDouble();
			}
			const int squares = size - 1;
			// Past this, no river's water comes within the clearance: a line strays under three cells from its
			// cells, and the widest is 9 across.
			const double riverNear = 5 * grid.cellSize + 10;
			const double radiusSquared = static_cast<double>(params.radius) * params.radius;
			for (int row = 1; row < size - 1; ++row) {
				const double y = cellCentre(grid, row);
				for (int column = 1; column < size - 1; ++column) {
					const double x = cellCentre(grid, column);
					if (x * x + y * y > radiusSquared) {
						continue;
					}
					const auto square = static_cast<size_t>((row - 1) * squares + column - 1);
					const auto north = square + static_cast<size_t>(squares);
					if (reached[square] == 0 || reached[square + 1] == 0 || reached[north] == 0 || reached[north + 1] == 0) {
						continue;
					}
					const auto cell = static_cast<size_t>(row * size + column);
					if (river.distance[cell] <= riverNear && water.riverIndex().near(x, y, kRiverClearance)) {
						continue;
					}
					if (land.mountains[cell] >= kSuitability.heart || terrain.fields().rough(x, y)) {
						continue;
					}
					sites.usable[cell] = 1;
					double score = kSuitability.flat * (1 - smooth01(sites.grade[cell] / kSuitability.flatGrade)) +
								   kSuitability.valley * water.lowland()[cell] - kSuitability.height * land.elevation[cell] -
								   kSuitability.ranges * land.mountains[cell] + kSuitability.noise * noise[cell];
					if (river.value[cell] > 0) {
						score += kSuitability.river * river.value[cell] * (1 - smooth01(river.distance[cell] / kSuitability.riverReach));
					}
					if (confluence.value[cell] > 0) {
						score += kSuitability.confluence * (1 - smooth01(confluence.distance[cell] / kSuitability.confluenceReach));
					}
					sites.suitability[cell] = score;
				}
			}
			for (int cell = 0; cell < static_cast<int>(cells); ++cell) {
				if (sites.suitability[static_cast<size_t>(cell)] > -kInfinity) {
					sites.ranked.push_back(cell);
				}
			}
			std::ranges::sort(sites.ranked, [&](int a, int b) {
				const double scoreA = sites.suitability[static_cast<size_t>(a)];
				const double scoreB = sites.suitability[static_cast<size_t>(b)];
				return scoreA > scoreB || (scoreA == scoreB && a < b);
			});
			return sites;
		}

		struct Spot {
			double x;
			double y;
			double radius;
			double suitability;
		};

		// Best ground first, each kept when it's its kind's spacing from the others of its kind and from those
		// placed before, past the metro, with its ruins outside the blend radius, inside the radius, clear of
		// craters and lakes. The checks use the largest ruins a kind can draw, so one pass settles them; each
		// one's ruins are drawn once it's placed.
		std::vector<Spot> settle(
			const Sites&				sites,
			const MapParams&			params,
			const Terrain&				terrain,
			const std::vector<Hotspot>& hotspots,
			const SettlementRules&		rules,
			int							count,
			const std::vector<Point>&	others,
			foundation::Rng&&			rng
		) {
			const LandGrid&	   grid = terrain.surface().grid;
			const StartRadii&  radii = terrain.start();
			const double	   spacing = rules.spacing * params.radius;
			const double	   largest = std::max(rules.ruinFloor, radii.metro * rules.ruinMax);
			const double	   inner = std::max(radii.blend + largest, radii.metro + kSettled.metroGap * spacing);
			const double	   outer = kSettled.outer * params.radius - largest;
			std::vector<Spot>  spots;
			std::vector<Point> placed;
			for (const int cell : sites.ranked) {
				if (static_cast<int>(spots.size()) >= count) {
					break;
				}
				const double x = centreX(grid, cell);
				const double y = centreY(grid, cell);
				const double away = x * x + y * y;
				if (away < inner * inner || away > outer * outer ||
					sites.lakeDistance[static_cast<size_t>(cell)] < largest + grid.cellSize) {
					continue;
				}
				if (!clearOfCraters(hotspots, x, y, largest) || !farFrom(x, y, placed, spacing * spacing) ||
					!farFrom(x, y, others, spacing * spacing)) {
					continue;
				}
				spots.push_back({.x = x, .y = y, .radius = 0, .suitability = sites.suitability[static_cast<size_t>(cell)]});
				placed.push_back({.x = x, .y = y});
			}
			for (Spot& spot : spots) {
				spot.radius = std::max(rules.ruinFloor, radii.metro * lerp(rules.ruinMin, rules.ruinMax, rng.nextDouble()));
			}
			return spots;
		}

		// Usable cells no steeper than kCrossroads.grade, in a shuffled order, each kept when it's the spacing
		// from every crossroads before it and three quarters of it from every other place: dart throwing to a
		// jam, over buckets a spacing wide.
		std::vector<Point> placeCrossroads(
			const Sites&				sites,
			const MapParams&			params,
			const Terrain&				terrain,
			const std::vector<Hotspot>& hotspots,
			const std::vector<Point>&	others,
			foundation::Rng&&			rng
		) {
			const LandGrid&	 grid = terrain.surface().grid;
			const double	 spacing = lerp(kCrossroads.sparse, kCrossroads.dense, params.roadDensity);
			const double	 inner = terrain.start().metro + kCrossroads.metro * spacing;
			const double	 outer = kCrossroads.outer * params.radius;
			std::vector<int> candidates;
			for (int cell = 0; cell < static_cast<int>(sites.usable.size()); ++cell) {
				const auto at = static_cast<size_t>(cell);
				if (sites.usable[at] == 0 || sites.grade[at] > kCrossroads.grade) {
					continue;
				}
				const double x = centreX(grid, cell);
				const double y = centreY(grid, cell);
				const double away = x * x + y * y;
				if (away >= inner * inner && away <= outer * outer && clearOfCraters(hotspots, x, y, 0)) {
					candidates.push_back(cell);
				}
			}
			rng.shuffle(candidates);
			const int						columns = static_cast<int>(std::ceil(2 * grid.halfExtent / spacing)) + 1;
			std::vector<std::vector<Point>> buckets(static_cast<size_t>(columns) * static_cast<size_t>(columns));
			const auto						bucketOf = [&](double value) {
				 return std::clamp(static_cast<int>(std::floor((value + grid.halfExtent) / spacing)), 0, columns - 1);
			};
			const double	   othersSquared = kCrossroads.others * spacing * kCrossroads.others * spacing;
			std::vector<Point> kept;
			for (const int cell : candidates) {
				const double x = centreX(grid, cell);
				const double y = centreY(grid, cell);
				const int	 column = bucketOf(x);
				const int	 row = bucketOf(y);
				bool		 clear = farFrom(x, y, others, othersSquared);
				for (int dy = -1; dy <= 1 && clear; ++dy) {
					for (int dx = -1; dx <= 1 && clear; ++dx) {
						const int nextRow = row + dy;
						const int nextColumn = column + dx;
						if (nextRow >= 0 && nextColumn >= 0 && nextRow < columns && nextColumn < columns) {
							clear = farFrom(x, y, buckets[static_cast<size_t>(nextRow * columns + nextColumn)], spacing * spacing);
						}
					}
				}
				if (clear) {
					buckets[static_cast<size_t>(row * columns + column)].push_back({.x = x, .y = y});
					kept.push_back({.x = x, .y = y});
				}
			}
			return kept;
		}

		// The highways' bearings: evenly spread, turned, and each jittered up to a third of the gap, redrawn
		// until every neighbour keeps the separation, and squeezed to fit after kExits.bearingDraws.
		std::vector<double> exitBearings(int count, double separation, foundation::Rng& rng) {
			const double		gap = 360.0 / count;
			const double		reach = gap / 3;
			const double		slack = std::max(0.0, gap - separation);
			const double		rotation = rng.nextDouble() * gap;
			std::vector<double> jitter(static_cast<size_t>(count));
			const auto			worstSqueeze = [&] {
				 double worst = -kInfinity;
				 for (size_t index = 0; index < jitter.size(); ++index) {
					 worst = std::max(worst, jitter[index] - jitter[(index + 1) % jitter.size()]);
				 }
				 return worst;
			};
			double squeeze = kInfinity;
			for (int draw = 0; draw < kExits.bearingDraws && squeeze > slack; ++draw) {
				for (double& offset : jitter) {
					offset = (rng.nextDouble() * 2 - 1) * reach;
				}
				squeeze = worstSqueeze();
			}
			if (squeeze > slack) {
				for (double& offset : jitter) {
					offset *= slack / squeeze;
				}
			}
			std::vector<double> bearings;
			for (int index = 0; index < count; ++index) {
				bearings.push_back(normalised(rotation + index * gap + jitter[static_cast<size_t>(index)]));
			}
			return bearings;
		}

		// The ground at the rim, where exits go: a point counts when the square under it is reached and no
		// river's water lies within kRiverClearance of it.
		class RimGround {
		  public:
			RimGround(const Terrain& terrain, const Water& water, const std::vector<uint8_t>& reached, int radius)
				: terrain(&terrain),
				  water(&water),
				  reached(&reached),
				  grid(terrain.surface().grid),
				  rim(radius - kExits.inset * grid.cellSize) {}

			[[nodiscard]] Point at(double bearing) const {
				const Point	 direction = unit(bearing);
				const double distance = rim - std::max(0, depth(bearing)) * grid.cellSize;
				return {.x = direction.x * distance, .y = direction.y * distance};
			}

			// The bearing from `back` degrees behind `bearing` to `ahead` ahead with the least grade, plus the
			// slide's penalty; infinity when none counts.
			[[nodiscard]] std::pair<double, double> gentlest(double bearing, double back, double ahead) const {
				double best = bearing;
				double bestCost = kInfinity;
				for (auto step = static_cast<int>(-std::floor(back / kExits.step));
					 step <= static_cast<int>(std::floor(ahead / kExits.step));
					 ++step) {
					const double offset = step * kExits.step;
					const double candidate = normalised(bearing + offset);
					const double cost = grade(candidate) + kExits.penalty * std::abs(offset);
					if (cost < bestCost) {
						bestCost = cost;
						best = candidate;
					}
				}
				return {best, bestCost};
			}

		  private:
			const Terrain*				terrain;
			const Water*				water;
			const std::vector<uint8_t>* reached;
			LandGrid					grid;
			double						rim;

			static Point unit(double bearing) {
				const double angle = bearing * std::numbers::pi / 180;
				return {.x = foundation::det_math::cos(angle), .y = foundation::det_math::sin(angle)};
			}

			[[nodiscard]] double gradeAt(double x, double y) const {
				const LandSample sample = terrain->sample(x, y);
				return std::sqrt(sample.slopeX * sample.slopeX + sample.slopeY * sample.slopeY) * kRelief;
			}

			[[nodiscard]] double grade(double bearing) const {
				const int found = depth(bearing);
				if (found < 0) {
					return kInfinity;
				}
				const Point	 direction = unit(bearing);
				const double distance = rim - found * grid.cellSize;
				const double inner = distance - grid.cellSize;
				return 0.5 * (gradeAt(direction.x * distance, direction.y * distance) + gradeAt(direction.x * inner, direction.y * inner)) +
					   kExits.inward * found;
			}

			// Cells in from the rim to the first point that counts on the bearing, or -1 within kExits.depth.
			[[nodiscard]] int depth(double bearing) const {
				const Point direction = unit(bearing);
				for (int found = 0; found <= kExits.depth; ++found) {
					const double distance = rim - found * grid.cellSize;
					const double x = direction.x * distance;
					const double y = direction.y * distance;
					const int	 square = squareAt(grid, x, y);
					if (square >= 0 && (*reached)[static_cast<size_t>(square)] != 0 && !water->riverIndex().near(x, y, kRiverClearance)) {
						return found;
					}
				}
				return -1;
			}
		};

		struct ExitSite {
			Point  point;
			double bearing;
			bool   highway;
		};

		// The highways' exits slid to gentle ground, the set turned a degree at a time either way up to half a
		// gap when some exit finds none; then a back road's in each wide gap.
		std::vector<ExitSite> placeExits(const MapParams& params, const RimGround& ground, const foundation::Rng& stream) {
			foundation::Rng			  bearingStream = stream.fork("bearings");
			const auto				  separation = static_cast<double>(params.highwaySeparation);
			const std::vector<double> bearings = exitBearings(params.highways, separation, bearingStream);
			const auto				  count = bearings.size();
			// Each slides at most half its slack toward a neighbour, so two sliding toward each other still keep
			// the separation. Turning the whole set keeps its gaps.
			std::vector<double> backs(count);
			std::vector<double> aheads(count);
			for (size_t index = 0; index < count; ++index) {
				backs[index] = count > 1 ? std::min(
											   kExits.slide,
											   std::max(0.0, (arc(bearings[(index + count - 1) % count], bearings[index]) - separation) / 2)
										   )
										 : kExits.slide;
				aheads[index] =
					count > 1
						? std::min(kExits.slide, std::max(0.0, (arc(bearings[index], bearings[(index + 1) % count]) - separation) / 2))
						: kExits.slide;
			}
			const auto			turns = static_cast<int>(std::floor(180.0 / static_cast<double>(count) / kExits.step));
			std::vector<double> highways;
			for (int turn = 0; turn <= 2 * turns && highways.empty(); ++turn) {
				// 0, then a step counterclockwise, a step clockwise, two counterclockwise, and so on.
				const double		offset = (turn % 2 == 1 ? (turn + 1) / 2 : -turn / 2) * kExits.step;
				std::vector<double> slid;
				for (size_t index = 0; index < count; ++index) {
					const auto [bearing, cost] = ground.gentlest(normalised(bearings[index] + offset), backs[index], aheads[index]);
					if (cost == kInfinity) {
						break;
					}
					slid.push_back(bearing);
				}
				if (slid.size() == count) {
					highways = std::move(slid);
				}
			}
			if (highways.empty()) {
				highways = bearings;
			}
			std::vector<ExitSite> exits;
			for (const double bearing : highways) {
				exits.push_back({.point = ground.at(bearing), .bearing = bearing, .highway = true});
			}
			if (count > 1) {
				for (size_t index = 0; index < count; ++index) {
					const double from = highways[index];
					const double gap = arc(from, highways[(index + 1) % count]);
					if (gap < kExits.backGap) {
						continue;
					}
					const double	room = gap / 2 - kExits.backClearance;
					foundation::Rng draw = stream.fork("back", index);
					const double	target = from + gap / 2 + (draw.nextDouble() * 2 - 1) * 0.5 * room;
					const double	back = std::min(kExits.slide, target - (from + kExits.backClearance));
					const double	ahead = std::min(kExits.slide, from + gap - kExits.backClearance - target);
					const auto [bearing, cost] = ground.gentlest(normalised(target), back, ahead);
					if (cost < kInfinity) {
						exits.push_back({.point = ground.at(bearing), .bearing = bearing, .highway = false});
					}
				}
			}
			return exits;
		}

	} // namespace

	std::vector<uint8_t> reachedSquares(const Terrain& terrain, const Water& water, const Hazards& hazards) {
		const LandGrid&		 grid = terrain.surface().grid;
		const int			 size = grid.size;
		const int			 squares = size - 1;
		const auto			 open = terrain.fields().openSquares();
		const auto			 lakeOf = water.lakeOf();
		std::vector<uint8_t> passable(open.begin(), open.end());
		for (int row = 0; row < squares; ++row) {
			const double bottom = cellCentre(grid, row);
			const double top = cellCentre(grid, row + 1);
			for (int column = 0; column < squares; ++column) {
				const auto square = static_cast<size_t>(row * squares + column);
				if (passable[square] == 0) {
					continue;
				}
				const auto corner = static_cast<size_t>(row * size + column);
				const auto north = corner + static_cast<size_t>(size);
				if (lakeOf[corner] >= 0 || lakeOf[corner + 1] >= 0 || lakeOf[north] >= 0 || lakeOf[north + 1] >= 0) {
					passable[square] = 0;
					continue;
				}
				const double left = cellCentre(grid, column);
				const double right = cellCentre(grid, column + 1);
				for (const Hotspot& site : hazards.hotspots()) {
					const double nearX = std::clamp(site.x, left, right);
					const double nearY = std::clamp(site.y, bottom, top);
					if ((nearX - site.x) * (nearX - site.x) + (nearY - site.y) * (nearY - site.y) < site.craterRadius * site.craterRadius) {
						passable[square] = 0;
						break;
					}
				}
			}
		}
		std::vector<uint8_t> reached(passable.size());
		const auto			 middle = static_cast<int>(std::floor(grid.halfExtent / grid.cellSize - 0.5));
		const int			 start = middle * squares + middle;
		if (passable[static_cast<size_t>(start)] == 0) {
			return reached;
		}
		std::vector<int> pending{start};
		reached[static_cast<size_t>(start)] = 1;
		while (!pending.empty()) {
			const int square = pending.back();
			pending.pop_back();
			const int column = square % squares;
			for (const int next :
				 {column > 0 ? square - 1 : -1, column < squares - 1 ? square + 1 : -1, square - squares, square + squares}) {
				if (next >= 0 && next < static_cast<int>(passable.size()) && passable[static_cast<size_t>(next)] != 0 &&
					reached[static_cast<size_t>(next)] == 0) {
					reached[static_cast<size_t>(next)] = 1;
					pending.push_back(next);
				}
			}
		}
		return reached;
	}

	Places::Places(
		const MapParams&	   params,
		const Terrain&		   terrain,
		const Water&		   water,
		const Hazards&		   hazards,
		const PlaceNamePool&   names,
		const foundation::Rng& stream
	)
		: metro(terrain.start().metro) {
		const std::vector<uint8_t> reached = reachedSquares(terrain, water, hazards);
		const Sites				   sites = siteField(params, terrain, water, reached, stream.fork("suitability"));
		const auto&				   hotspots = hazards.hotspots();
		const std::vector<Spot>	   towns = settle(sites, params, terrain, hotspots, kTowns, params.towns, {}, stream.fork("towns"));
		std::vector<Point>		   placed;
		for (const Spot& town : towns) {
			placed.push_back({.x = town.x, .y = town.y});
		}
		const std::vector<Spot> villages =
			settle(sites, params, terrain, hotspots, kVillages, params.villages, placed, stream.fork("villages"));
		for (const Spot& village : villages) {
			placed.push_back({.x = village.x, .y = village.y});
		}
		const std::vector<ExitSite> exits = placeExits(params, RimGround(terrain, water, reached, params.radius), stream.fork("exits"));
		for (const ExitSite& exit : exits) {
			placed.push_back(exit.point);
		}
		const std::vector<Point> crossroads = placeCrossroads(sites, params, terrain, hotspots, placed, stream.fork("crossroads"));

		PlaceNamer namer(names, stream.fork("names"));
		int		   id = 1;
		for (const Spot& town : towns) {
			townList.push_back(
				{.id = id++,
				 .kind = SettlementKind::Town,
				 .x = town.x,
				 .y = town.y,
				 .radius = town.radius,
				 .name = namer.next(),
				 .suitability = town.suitability}
			);
		}
		for (const Spot& village : villages) {
			villageList.push_back(
				{.id = id++,
				 .kind = SettlementKind::Village,
				 .x = village.x,
				 .y = village.y,
				 .radius = village.radius,
				 .name = namer.next(),
				 .suitability = village.suitability}
			);
		}
		for (const Point& point : crossroads) {
			crossroadList.push_back({.id = id++, .x = point.x, .y = point.y});
		}
		for (const ExitSite& exit : exits) {
			exitList.push_back({.id = id++, .x = exit.point.x, .y = exit.point.y, .bearing = exit.bearing, .highway = exit.highway});
		}
	}

	std::vector<Place> placeList(const Places& places) {
		std::vector<Place> list{{.id = 0, .kind = PlaceKind::Metro, .x = 0, .y = 0, .highway = false}};
		for (const Settlement& town : places.towns()) {
			list.push_back({.id = town.id, .kind = PlaceKind::Town, .x = town.x, .y = town.y, .highway = false});
		}
		for (const Settlement& village : places.villages()) {
			list.push_back({.id = village.id, .kind = PlaceKind::Village, .x = village.x, .y = village.y, .highway = false});
		}
		for (const Crossroads& crossroads : places.crossroads()) {
			list.push_back({.id = crossroads.id, .kind = PlaceKind::Crossroads, .x = crossroads.x, .y = crossroads.y, .highway = false});
		}
		for (const Exit& exit : places.exits()) {
			list.push_back({.id = exit.id, .kind = PlaceKind::Exit, .x = exit.x, .y = exit.y, .highway = exit.highway});
		}
		for ([[maybe_unused]] size_t index = 0; index < list.size(); ++index) {
			assert(list[index].id == static_cast<int>(index) && "placeList: the places are numbered in list order");
		}
		return list;
	}

	Problems checkPlaces(const Places& places, const Terrain& terrain, const Water& water, const Hazards& hazards) {
		const LandGrid&			   grid = terrain.surface().grid;
		const std::vector<uint8_t> reached = reachedSquares(terrain, water, hazards);
		Problems				   problems;
		const auto				   check = [&](std::string_view kind, int id, double x, double y) {
			const int		  square = squareAt(grid, x, y);
			const std::string where = std::string(kind) + " " + std::to_string(id);
			if (square < 0 || reached[static_cast<size_t>(square)] == 0) {
				problems.push_back("reach: " + where + " stands where no road from the metro surely reaches");
			} else if (water.riverIndex().near(x, y, 0)) {
				problems.push_back("water: " + where + " stands in a river");
			}
		};
		for (const Settlement& town : places.towns()) {
			check("town", town.id, town.x, town.y);
		}
		for (const Settlement& village : places.villages()) {
			check("village", village.id, village.x, village.y);
		}
		for (const Crossroads& crossroads : places.crossroads()) {
			check("crossroads", crossroads.id, crossroads.x, crossroads.y);
		}
		for (const Exit& exit : places.exits()) {
			check("exit", exit.id, exit.x, exit.y);
		}
		return problems;
	}

} // namespace rules::map
