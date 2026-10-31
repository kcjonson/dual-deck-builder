#include "RoadLinks.h"

#include "RoadSearch.h"

#include <math/DeterministicMath.h>

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <initializer_list>
#include <numbers>
#include <optional>
#include <utility>

namespace rules::map {

	namespace {

		// Searches stay inside an ellipse round a link's two places, its straight span times `bound` plus
		// `slack` cells, and try once more `widen` times wider where that finds nothing.
		struct SearchRules {
			double bound = 1.7;
			double slack = 3;
			double widen = 2.5;
		};

		// Back roads: Gabriel pairs of places under `longest` of the radius apart, the test's circle `gabriel` of
		// the diametral circle's area so a place right on its edge doesn't knock a link out, exits never with
		// exits, taken shortest first give or take `order` of their span. One between places already connected
		// goes in past a detour of `detourNone` at loops 0 to `detourAll` at 1.
		struct LinkRules {
			double longest = 0.45;
			double gabriel = 0.92;
			double order = 0.1;
			double detourNone = 1.9;
			double detourAll = 1.1;
		};

		// A highway runs through the first town in the list within 24 degrees of its exit's bearing, `cosine` the
		// cosine of that, between `inner` and `outer` of the radius out.
		struct HighwayTowns {
			double cosine = 0.9135454576426009;
			double inner = 0.25;
			double outer = 0.9;
		};

		// A back road's run through rough country `trailNone` world units long or more at trailShare 0, to
		// `trailAll` at 1, is a trail.
		struct TrailRules {
			double trailNone = 150;
			double trailAll = 15;
		};

		// A village takes a spur trail with chance `chance`, toward the highest open cell `near` to `far` world
		// units off at `bearings` bearings and `rings` distances, `rise` of elevation above it or more, if a trail
		// there runs `longest` or less.
		struct SpurRules {
			double chance = 0.55;
			double near = 60;
			double far = 140;
			int	   bearings = 16;
			int	   rings = 3;
			double rise = 0.12;
			double longest = 200;
		};

		// A path's highest cell is a pass where the ranges' mask is `ranges` or more and it stands `rise` above
		// both ends, `spacing` world units from any other.
		struct PassRules {
			double ranges = 0.5;
			double rise = 0.05;
			double spacing = 30;
		};

		constexpr SearchRules  kSearch;
		constexpr LinkRules	   kLinks;
		constexpr HighwayTowns kHighwayTowns;
		constexpr TrailRules   kTrails;
		constexpr SpurRules	   kSpurs;
		constexpr PassRules	   kPasses;

		size_t at(int index) {
			return static_cast<size_t>(index);
		}

		int8_t rankOf(RoadClass road) {
			return static_cast<int8_t>(road);
		}

		// Where a search may start or end for a place: its cells, its point, and how far they lie from it.
		struct Ends {
			std::vector<int> cells;
			double			 x{0};
			double			 y{0};
			double			 reach{0};
		};

		struct Candidate {
			int	   a{0};
			int	   b{0};
			double span{0};
			// What the links are taken in order of: the span, nudged by the stream.
			double order{0};
		};

		class Builder {
		  public:
			explicit Builder(const RoadLinkArgs& args)
				: field(args.field),
				  places(args.places),
				  stream(args.stream),
				  size(args.field.size()),
				  cellSize(args.field.grid().cellSize),
				  detour(kLinks.detourNone + (kLinks.detourAll - kLinks.detourNone) * args.loops),
				  trailRun(kTrails.trailNone + (kTrails.trailAll - kTrails.trailNone) * args.trailShare),
				  laid(args.field.grid().cells(), args.field.edges()),
				  search(args.field, laid),
				  placeAt(at(args.field.grid().cells()), -1),
				  parent(args.places.size()),
				  roughCells(at(args.field.grid().cells()), -1) {
				assert(!places.empty() && places.front().kind == PlaceKind::Metro && "layRoadLinks: place 0 is the metro");
				for (size_t id = 0; id < parent.size(); ++id) {
					parent[id] = static_cast<int>(id);
				}
				result.placeCells.assign(places.size(), -1);
				for (const Place& place : places) {
					ends.push_back(attach(place));
				}
			}

			RoadLinks build() {
				layHighways();
				layBackRoads();
				joinStragglers();
				laySpurs();
				for (const Place& place : places) {
					if (find(place.id) != find(0)) {
						result.stats.unreached.push_back(place.id);
					}
				}
				finish();
				result.stats.searches = search.searches();
				result.stats.expanded = search.expanded();
				return std::move(result);
			}

		  private:
			EdgeCostField&					 field;
			std::span<const Place>			 places;
			const foundation::Rng&			 stream;
			int								 size;
			double							 cellSize;
			double							 detour;
			double							 trailRun;
			LaidRoads						 laid;
			RoadSearch						 search;
			std::vector<int>				 placeAt;
			std::vector<std::optional<Ends>> ends;
			std::vector<int>				 parent;
			// Per cell, 1 rough, 0 not, -1 not looked at yet.
			std::vector<int8_t> roughCells;
			RoadLinks			result;

			// Where a place stands on the grid: the compound on the four cells round the origin, any other on the
			// open cell nearest its point, its own or a neighbour, that no other place stands on.
			std::optional<Ends> attach(const Place& place) {
				if (place.id == 0) {
					const std::array<int, 4> compound = compoundCells(field.grid());
					for (const int cell : compound) {
						placeAt[at(cell)] = 0;
					}
					result.placeCells[0] = compound[0];
					return Ends{
						.cells = std::vector<int>(compound.begin(), compound.end()), .x = 0, .y = 0, .reach = std::sqrt(0.5) * cellSize
					};
				}
				const int home = cellAt(field.grid(), place.x, place.y);
				if (home < 0) {
					return std::nullopt;
				}
				std::vector<std::pair<double, int>> candidates;
				for (int rows = -1; rows <= 1; ++rows) {
					for (int columns = -1; columns <= 1; ++columns) {
						const int	 cell = home + rows * size + columns;
						const double offsetX = field.x(cell) - place.x;
						const double offsetY = field.y(cell) - place.y;
						candidates.emplace_back(offsetX * offsetX + offsetY * offsetY, cell);
					}
				}
				std::ranges::sort(candidates);
				for (const auto& [distance, cell] : candidates) {
					if (field.open(cell) && placeAt[at(cell)] < 0) {
						placeAt[at(cell)] = place.id;
						result.placeCells[at(place.id)] = cell;
						return Ends{.cells = {cell}, .x = place.x, .y = place.y, .reach = std::sqrt(distance)};
					}
				}
				return std::nullopt;
			}

			// From each highway exit to the compound through the first town within 24 degrees of its bearing, the
			// list coming best ground first, or straight in where there's none. Existing highway is cheaper to a
			// highway, so the later ones merge into the earlier near the city. Each move keeps the first highway
			// laid along it.
			void layHighways() {
				const double radius = field.ground().terrain().radius();
				int			 highway = -1;
				for (const Place& exit : places) {
					if (exit.kind != PlaceKind::Exit || !exit.highway) {
						continue;
					}
					highway += 1;
					if (!ends[at(exit.id)]) {
						continue;
					}
					const double exitDistance = std::sqrt(exit.x * exit.x + exit.y * exit.y);
					int			 town = -1;
					for (const Place& place : places) {
						if (place.kind != PlaceKind::Town || !ends[at(place.id)]) {
							continue;
						}
						const double distance = std::sqrt(place.x * place.x + place.y * place.y);
						if (distance < kHighwayTowns.inner * radius || distance > kHighwayTowns.outer * radius) {
							continue;
						}
						if ((place.x * exit.x + place.y * exit.y) / (distance * exitDistance) >= kHighwayTowns.cosine) {
							town = place.id;
							break;
						}
					}
					bool laidHighway = town >= 0
										   ? link(exit.id, town, RoadClass::Highway, highway) && link(town, 0, RoadClass::Highway, highway)
										   : link(exit.id, 0, RoadClass::Highway, highway);
					if (!laidHighway && town >= 0) {
						laidHighway = link(exit.id, 0, RoadClass::Highway, highway);
					}
					if (laidHighway) {
						result.stats.highways += 1;
					}
				}
			}

			// The Gabriel graph's links in order: one joining places not yet connected always goes in, one between
			// connected places only past the detour.
			void layBackRoads() {
				const std::vector<Candidate> links = candidateLinks();
				result.stats.candidates = static_cast<int>(links.size());
				for (const Candidate& candidate : links) {
					const int a = candidate.a;
					const int b = candidate.b;
					if (find(a) != find(b)) {
						if (link(a, b, RoadClass::BackRoad, -1) || link(a, b, RoadClass::Trail, -1)) {
							result.stats.joined += 1;
						} else {
							result.stats.failed += 1;
						}
						continue;
					}
					// A path can't be shorter than the straight span, so roads within the detour of that need no search.
					const double limit = detour * (kSearch.bound * candidate.span + 2 * kSearch.slack * cellSize);
					const double around = search.roadDistance(ends[at(a)]->cells, ends[at(b)]->cells, limit);
					if (around <= detour * candidate.span) {
						result.stats.skipped += 1;
						continue;
					}
					const std::vector<int> cells = pathBetween(*ends[at(a)], *ends[at(b)], RoadClass::BackRoad, kSearch.bound);
					if (cells.empty()) {
						result.stats.failed += 1;
						continue;
					}
					if (around <= detour * pathLength(cells)) {
						result.stats.skipped += 1;
						continue;
					}
					lay(cells, RoadClass::BackRoad, -1);
					result.stats.looped += 1;
				}
			}

			// Places still cut off join the nearest road the compound reaches, by Dijkstra.
			void joinStragglers() {
				for (const Place& place : places) {
					if (find(place.id) == find(0) || !ends[at(place.id)]) {
						continue;
					}
					const std::vector<int> reached = reachedRoadCells();
					for (const RoadClass road : {RoadClass::BackRoad, RoadClass::Trail}) {
						const std::vector<int> cells = search.find(ends[at(place.id)]->cells, reached, road, std::nullopt);
						if (cells.empty()) {
							continue;
						}
						lay(cells, road, -1);
						unite(place.id, 0);
						result.stats.stragglers += 1;
						break;
					}
				}
			}

			// Spur trails into the high country from villages near it, to passes, mines, and lookouts: each village
			// draws on its own fork whether it takes one, and the bearings it looks along.
			void laySpurs() {
				for (const Place& village : places) {
					if (village.kind != PlaceKind::Village || !ends[at(village.id)]) {
						continue;
					}
					foundation::Rng draws = stream.fork("spur", village.id);
					if (draws.nextDouble() >= kSpurs.chance) {
						continue;
					}
					const double turn = draws.nextDouble() * 360 / kSpurs.bearings;
					int			 target = -1;
					double		 highest = field.elevation(result.placeCells[at(village.id)]) + kSpurs.rise;
					for (int bearing = 0; bearing < kSpurs.bearings; ++bearing) {
						const double angle = (turn + bearing * 360.0 / kSpurs.bearings) * std::numbers::pi / 180;
						const double towardX = foundation::det_math::cos(angle);
						const double towardY = foundation::det_math::sin(angle);
						for (int ring = 0; ring < kSpurs.rings; ++ring) {
							const double distance = kSpurs.near + (kSpurs.far - kSpurs.near) * ring / (kSpurs.rings - 1);
							const int	 cell = cellAt(field.grid(), village.x + towardX * distance, village.y + towardY * distance);
							if (cell < 0 || !field.open(cell) || laid.near[at(cell)] != 0 || placeAt[at(cell)] >= 0) {
								continue;
							}
							const double height = field.elevation(cell);
							if (height > highest || (height == highest && target >= 0 && cell < target)) {
								highest = height;
								target = cell;
							}
						}
					}
					if (target < 0) {
						continue;
					}
					const Ends			   from{.cells = {target}, .x = field.x(target), .y = field.y(target), .reach = 0};
					const std::vector<int> cells = pathBetween(from, *ends[at(village.id)], RoadClass::Trail, kSearch.bound);
					if (cells.empty() || pathLength(cells) > kSpurs.longest) {
						continue;
					}
					lay(cells, RoadClass::Trail, -1);
					result.spurEnds.push_back(target);
					result.stats.spurs += 1;
				}
			}

			// Lays a link between two places, if a path exists, and joins them; false where none does.
			bool link(int a, int b, RoadClass road, int highway) {
				if (!ends[at(a)] || !ends[at(b)]) {
					return false;
				}
				std::vector<int> cells = pathBetween(*ends[at(a)], *ends[at(b)], road, kSearch.bound);
				if (cells.empty()) {
					cells = pathBetween(*ends[at(a)], *ends[at(b)], road, kSearch.bound * kSearch.widen);
				}
				if (cells.empty()) {
					return false;
				}
				lay(cells, road, highway);
				unite(a, b);
				return true;
			}

			std::vector<int> pathBetween(const Ends& from, const Ends& to, RoadClass road, double bound) {
				const double	dx = to.x - from.x;
				const double	dy = to.y - from.y;
				const SearchAim aim{
					.fromX = from.x,
					.fromY = from.y,
					.x = to.x,
					.y = to.y,
					.reach = to.reach,
					.limit = bound * std::sqrt(dx * dx + dy * dy) + kSearch.slack * cellSize + from.reach + to.reach,
				};
				return search.find(from.cells, to.cells, road, aim);
			}

			// Gabriel pairs of places under kLinks.longest of the radius apart, exits never with exits, in order of
			// their span nudged up to kLinks.order either way by the `links` fork, ties by the places' ids.
			std::vector<Candidate> candidateLinks() {
				const double radius = field.ground().terrain().radius();
				const double longest = kLinks.longest * radius;
				const double bucket = longest / 2;
				const int	 columns = static_cast<int>(std::ceil(2 * radius / bucket)) + 1;
				const auto	 bucketOf = [&](double value) {
					  return std::clamp(static_cast<int>(std::floor((value + radius) / bucket)), 0, columns - 1);
				};
				std::vector<std::vector<int>> buckets(at(columns * columns));
				for (const Place& place : places) {
					if (ends[at(place.id)]) {
						buckets[at(bucketOf(place.y) * columns + bucketOf(place.x))].push_back(place.id);
					}
				}
				foundation::Rng		   draws = stream.fork("links");
				std::vector<Candidate> links;
				for (const Place& first : places) {
					if (!ends[at(first.id)]) {
						continue;
					}
					for (const Place& second : places.subspan(at(first.id + 1))) {
						if (!ends[at(second.id)] || (first.kind == PlaceKind::Exit && second.kind == PlaceKind::Exit)) {
							continue;
						}
						const double dx = second.x - first.x;
						const double dy = second.y - first.y;
						const double squared = dx * dx + dy * dy;
						if (squared > longest * longest) {
							continue;
						}
						const double middleX = first.x + 0.5 * dx;
						const double middleY = first.y + 0.5 * dy;
						const double inside = 0.25 * squared * kLinks.gabriel;
						const double reach = std::sqrt(0.25 * squared);
						bool		 gabriel = true;
						for (int row = bucketOf(middleY - reach); row <= bucketOf(middleY + reach) && gabriel; ++row) {
							for (int column = bucketOf(middleX - reach); column <= bucketOf(middleX + reach) && gabriel; ++column) {
								for (const int other : buckets[at(row * columns + column)]) {
									if (other == first.id || other == second.id) {
										continue;
									}
									const double ox = places[at(other)].x - middleX;
									const double oy = places[at(other)].y - middleY;
									if (ox * ox + oy * oy < inside) {
										gabriel = false;
										break;
									}
								}
							}
						}
						if (gabriel) {
							const double span = std::sqrt(squared);
							links.push_back(
								{.a = first.id,
								 .b = second.id,
								 .span = span,
								 .order = span * (1 + kLinks.order * (2 * draws.nextDouble() - 1))}
							);
						}
					}
				}
				std::ranges::sort(links, [](const Candidate& left, const Candidate& right) {
					if (left.order != right.order) {
						return left.order < right.order;
					}
					return left.a != right.a ? left.a < right.a : left.b < right.b;
				});
				return links;
			}

			// The cells on a road the compound reaches.
			std::vector<int> reachedRoadCells() const {
				std::vector<uint8_t> reached(at(field.grid().cells()));
				std::vector<int>	 cells;
				std::vector<int>	 pending;
				for (const int cell : compoundCells(field.grid())) {
					reached[at(cell)] = 1;
					cells.push_back(cell);
					pending.push_back(cell);
				}
				while (!pending.empty()) {
					const int cell = pending.back();
					pending.pop_back();
					const uint16_t mask = laid.mask[at(cell)];
					for (int direction = 0; direction < kMoves; ++direction) {
						if ((mask & (1U << direction)) == 0) {
							continue;
						}
						const int next = field.step(cell, direction);
						if (reached[at(next)] == 0) {
							reached[at(next)] = 1;
							cells.push_back(next);
							pending.push_back(next);
						}
					}
				}
				return cells;
			}

			// Lays a path as road of a class. A back road gives out to a trail along a run through rough country
			// trailRun long or more. Each move keeps the best class laid along it, and the first highway; a road's
			// highest cell over a range is a pass.
			void lay(std::span<const int> cells, RoadClass road, int highway) {
				std::vector<RoadClass> classes(cells.size() - 1, road);
				if (road == RoadClass::BackRoad) {
					trailRuns(cells, classes);
				}
				for (size_t move = 0; move + 1 < cells.size(); ++move) {
					const int	 cell = cells[move];
					const int	 next = cells[move + 1];
					const int	 direction = directionOf(cell, next);
					const auto	 edge = at(field.edge(cell, direction));
					const int8_t rank = rankOf(classes[move]);
					if (laid.classes[edge] < 0 || rank < laid.classes[edge]) {
						laid.classes[edge] = rank;
					}
					if (highway >= 0 && laid.highways[edge] < 0) {
						laid.highways[edge] = static_cast<int8_t>(highway);
					}
					laid.mask[at(cell)] = static_cast<uint16_t>(laid.mask[at(cell)] | (1U << direction));
					laid.mask[at(next)] = static_cast<uint16_t>(laid.mask[at(next)] | (1U << kOpposite[at(direction)]));
					if (direction >= kNeighbours) {
						laid.leaps[at((cell + next) / 2)] |= direction % 2 == 0 ? 1 : 2;
					}
					markNear(cell);
					markNear(next);
				}
				if (road != RoadClass::Trail) {
					findPass(cells);
				}
			}

			void trailRuns(std::span<const int> cells, std::vector<RoadClass>& classes) {
				std::optional<size_t> start;
				double				  length = 0;
				const auto			  close = [&](size_t end) {
					   if (start && length >= trailRun) {
						   std::fill(
							   classes.begin() + static_cast<std::ptrdiff_t>(*start),
							   classes.begin() + static_cast<std::ptrdiff_t>(end),
							   RoadClass::Trail
						   );
					   }
					   start.reset();
					   length = 0;
				};
				for (size_t move = 0; move < classes.size(); ++move) {
					const int cell = cells[move];
					const int next = cells[move + 1];
					if (rough(cell) || rough(next)) {
						if (!start) {
							start = move;
						}
						length += field.length(field.edge(cell, directionOf(cell, next)));
					} else {
						close(move);
					}
				}
				close(classes.size());
			}

			void findPass(std::span<const int> cells) {
				int highest = cells.front();
				for (const int cell : cells) {
					if (field.elevation(cell) > field.elevation(highest)) {
						highest = cell;
					}
				}
				const double endHeight = std::max(field.elevation(cells.front()), field.elevation(cells.back()));
				if (!(field.elevation(highest) >= endHeight + kPasses.rise)) {
					return;
				}
				const double x = field.x(highest);
				const double y = field.y(highest);
				if (field.ground().terrain().mountains(x, y) < kPasses.ranges) {
					return;
				}
				const bool crowded = std::ranges::any_of(result.passes, [&](const RoadPass& pass) {
					return (pass.x - x) * (pass.x - x) + (pass.y - y) * (pass.y - y) < kPasses.spacing * kPasses.spacing;
				});
				if (!crowded) {
					result.passes.push_back({.x = x, .y = y});
				}
			}

			// Drops each diagonal that closes a triangle with two orthogonal road moves round its square, handing
			// its class and highway on to them, so two roads meeting at a corner share a cell rather than make a
			// loop a cell across; leaves each cell beside the compound one move into it, its best class, so each
			// of the compound's roads leaves it once; drops moves between the compound's own cells; and files
			// what's left.
			void finish() {
				for (int cell = 0; cell < field.grid().cells(); ++cell) {
					for (const int direction : {1, 3}) {
						const auto	 diagonal = at(field.edge(cell, direction));
						const int8_t rank = laid.classes[diagonal];
						if (rank < 0) {
							continue;
						}
						const int								   next = field.step(cell, direction);
						const int								   side = cell + kMoveX[at(direction)];
						const int								   above = cell + kMoveY[at(direction)] * size;
						const std::array<std::array<size_t, 2>, 2> rounds{{
							{at(edgeBetween(cell, side)), at(edgeBetween(side, next))},
							{at(edgeBetween(cell, above)), at(edgeBetween(above, next))},
						}};
						for (const auto& round : rounds) {
							if (laid.classes[round[0]] < 0 || laid.classes[round[1]] < 0) {
								continue;
							}
							laid.classes[diagonal] = -1;
							for (const size_t edge : round) {
								laid.classes[edge] = std::min(laid.classes[edge], rank);
								if (laid.highways[edge] < 0) {
									laid.highways[edge] = laid.highways[diagonal];
								}
							}
							result.stats.triangles += 1;
							break;
						}
					}
				}
				const std::array<int, 4> compound = compoundCells(field.grid());
				std::vector<int>		 beside;
				for (const int inner : compound) {
					for (int direction = 0; direction < kNeighbours; ++direction) {
						const int cell = field.step(inner, direction);
						if (placeAt[at(cell)] == 0 || std::ranges::find(beside, cell) != beside.end()) {
							continue;
						}
						beside.push_back(cell);
						std::vector<size_t> ins;
						for (int toward = 0; toward < kNeighbours; ++toward) {
							const auto edge = at(field.edge(cell, toward));
							if (placeAt[at(field.step(cell, toward))] == 0 && laid.classes[edge] >= 0) {
								ins.push_back(edge);
							}
						}
						if (ins.size() < 2) {
							continue;
						}
						int8_t best = laid.classes[ins.front()];
						int8_t highway = -1;
						for (const size_t edge : ins) {
							best = std::min(best, laid.classes[edge]);
							if (highway < 0) {
								highway = laid.highways[edge];
							}
							laid.classes[edge] = -1;
						}
						laid.classes[ins.front()] = best;
						if (laid.highways[ins.front()] < 0) {
							laid.highways[ins.front()] = highway;
						}
					}
				}
				for (int edge = 0; edge < field.edges(); ++edge) {
					const int8_t rank = laid.classes[at(edge)];
					if (rank < 0) {
						continue;
					}
					const int from = edge / detail::kSlots;
					const int direction = detail::kSlotMove[at(edge % detail::kSlots)];
					const int to = field.step(from, direction);
					if (placeAt[at(from)] == 0 && placeAt[at(to)] == 0) {
						continue;
					}
					result.moves.push_back({
						.from = from,
						.to = to,
						.direction = direction,
						.roadClass = static_cast<RoadClass>(rank),
						.highway = laid.highways[at(edge)],
						.length = field.length(edge),
						.bridged = field.bridged(edge),
					});
				}
			}

			[[nodiscard]] int directionOf(int cell, int next) const {
				const int direction = moveBetween(next % size - cell % size, next / size - cell / size);
				assert(direction >= 0 && "RoadLinks: a path steps a move at a time");
				return direction;
			}

			[[nodiscard]] int edgeBetween(int cell, int next) const { return field.edge(cell, directionOf(cell, next)); }

			double pathLength(std::span<const int> cells) {
				double length = 0;
				for (size_t move = 0; move + 1 < cells.size(); ++move) {
					length += field.length(edgeBetween(cells[move], cells[move + 1]));
				}
				return length;
			}

			bool rough(int cell) {
				int8_t& known = roughCells[at(cell)];
				if (known < 0) {
					known = field.ground().terrain().fields().rough(field.x(cell), field.y(cell)) ? 1 : 0;
				}
				return known == 1;
			}

			void markNear(int cell) {
				laid.near[at(cell)] = 1;
				for (int direction = 0; direction < kNeighbours; ++direction) {
					laid.near[at(field.step(cell, direction))] = 1;
				}
			}

			int find(int id) {
				int root = id;
				while (parent[at(root)] != root) {
					root = parent[at(root)];
				}
				while (parent[at(id)] != root) {
					const int next = parent[at(id)];
					parent[at(id)] = root;
					id = next;
				}
				return root;
			}

			// The lower id keeps the root, so the compound's piece is always rooted at 0.
			void unite(int a, int b) {
				const int rootA = find(a);
				const int rootB = find(b);
				if (rootA < rootB) {
					parent[at(rootB)] = rootA;
				} else if (rootB < rootA) {
					parent[at(rootA)] = rootB;
				}
			}
		};

	} // namespace

	RoadLinks layRoadLinks(const RoadLinkArgs& args) {
		return Builder(args).build();
	}

	std::array<int, 4> compoundCells(const LandGrid& grid) {
		const int middle = grid.size / 2;
		const int size = grid.size;
		return {(middle - 1) * size + middle - 1, (middle - 1) * size + middle, middle * size + middle - 1, middle * size + middle};
	}

} // namespace rules::map
