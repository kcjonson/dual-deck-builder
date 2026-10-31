#include "RailLines.h"

#include "Land.h"
#include "LandGrid.h"
#include "NodeHeap.h"
#include "RoadChecks.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <numbers>
#include <optional>
#include <span>
#include <utility>

namespace rules::map {

	namespace {

		// Search cells inside the rim a line's cells keep.
		constexpr int kInset = 1;
		// A move's cost: its length times one plus kGradeWeight times its grade squared, times one plus kValleyWeight
		// times how far it stands above the low ground, plus kRangeWeight times the range mask times its length, plus
		// kRiverCell for each end on a river cell.
		constexpr double kGradeWeight = 400;
		constexpr double kValleyWeight = 1.5;
		constexpr double kRangeWeight = 4;
		constexpr double kRiverCell = 40;
		// Within kApart search cells of an earlier line a move costs kApartCost times as much, and past kRimBand of the
		// radius kRimCost times.
		constexpr int	 kApart = 6;
		constexpr double kApartCost = 6;
		constexpr double kRimBand = 0.88;
		constexpr double kRimCost = 4;
		// A line doubles back where its heading, read every kHairpinStep world units, turns to a cosine under
		// kHairpinCosine, about 150 degrees, within kHairpinWindow; it runs beside an earlier one where it's within
		// kBesideReach of it, read every kBesideStep, for more than kBesideMost.
		constexpr double kHairpinWindow = 200;
		constexpr double kHairpinCosine = -0.85;
		constexpr double kHairpinStep = 20;
		constexpr double kBesideReach = 30;
		constexpr double kBesideMost = 300;
		constexpr double kBesideStep = 10;
		// Tries a line gets; after the first its first end turns up to kTurn degrees either way. The second end is
		// kLeastAcross to kMostAcross degrees round from the first, and the search runs from any open cell within
		// kSpread degrees of each, read every kSpreadStep.
		constexpr int	 kTries = 6;
		constexpr double kTurn = 25;
		constexpr double kLeastAcross = 140;
		constexpr double kMostAcross = 220;
		constexpr int	 kSpread = 25;
		constexpr double kSpreadStep = 2.5;
		// Douglas-Peucker tolerances in search cells, each tried with kPasses of Chaikin in turn.
		constexpr std::array<double, 3> kTolerances{2, 1, 0.5};
		constexpr int					kPasses = 4;
		// World units: decks merge across gaps up to kDeckGap, and none is longer than kLongestDeck.
		constexpr double kDeckGap = 2;
		constexpr double kLongestDeck = 30;

		constexpr std::array<std::array<int, 2>, 8> kNeighbours{{{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {-1, 1}, {1, -1}, {-1, -1}}};

		bool railCrosses(Obstacle obstacle) {
			return obstacle == Obstacle::None || obstacle == Obstacle::River;
		}

		// A cell a line can start or end on, just inside the rim, and the rim point beyond it.
		struct RimEnd {
			int	  cell{0};
			Point rim;
		};

		double length(Point a, Point b) {
			return std::sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
		}

		// Whether (x, y) lies within `reach` of the line.
		bool nearLine(std::span<const Point> line, Point at, double reach) {
			for (size_t point = 1; point < line.size(); ++point) {
				const Point a = line[point - 1];
				const Point b = line[point];
				if (std::min(a.x, b.x) > at.x + reach || std::max(a.x, b.x) < at.x - reach || std::min(a.y, b.y) > at.y + reach ||
					std::max(a.y, b.y) < at.y - reach) {
					continue;
				}
				if (pointSegmentDistanceSquared(at, a, b) <= reach * reach) {
					return true;
				}
			}
			return false;
		}

		// Whether the line's heading, read every kHairpinStep, turns past kHairpinCosine within kHairpinWindow.
		bool doublesBack(std::span<const Point> points) {
			const double	   total = polylineLength(points);
			std::vector<Point> headings;
			Point			   last = points.front();
			for (double along = kHairpinStep; along <= total; along += kHairpinStep) {
				const Point	 at = pointAlong(points, along);
				const double norm = length(last, at);
				headings.push_back(norm > 0 ? Point{.x = (at.x - last.x) / norm, .y = (at.y - last.y) / norm} : Point{});
				last = at;
			}
			const auto reach = static_cast<size_t>(kHairpinWindow / kHairpinStep);
			for (size_t index = 0; index < headings.size(); ++index) {
				for (size_t ahead = 1; ahead <= reach && index + ahead < headings.size(); ++ahead) {
					const Point a = headings[index];
					const Point b = headings[index + ahead];
					if (a.x * b.x + a.y * b.y < kHairpinCosine) {
						return true;
					}
				}
			}
			return false;
		}

		// The coarse grid the rails are searched on, and the lines laid on it so far.
		class RailField {
		  public:
			explicit RailField(const Ground& ground)
				: ground(&ground),
				  grid(coarseGrid(ground.terrain().surface().grid)),
				  radius(ground.terrain().radius()) {
				const LandGrid&				  land = ground.terrain().surface().grid;
				const Water&				  water = ground.water();
				const auto					  cells = static_cast<size_t>(grid.cells());
				const double				  band = kRimBand * radius;
				const double				  reach = radius - kInset * grid.cellSize;
				const std::span<const double> mountains = ground.terrain().surface().mountains;
				const std::span<const double> area = water.drainage().area;
				const std::span<const double> lowland = water.lowland();
				height.assign(cells, 0);
				mask.assign(cells, 0);
				above.assign(cells, 0);
				river.assign(cells, 0);
				open.assign(cells, 0);
				crowded.assign(cells, 0);
				outer.assign(cells, 0);
				for (int row = 0; row < grid.size; ++row) {
					const double y = cellCentre(grid, row);
					for (int column = 0; column < grid.size; ++column) {
						const double x = cellCentre(grid, column);
						const auto	 cell = static_cast<size_t>(row * grid.size + column);
						// Past the reach a cell stays closed, so nothing else about it is needed.
						if (x * x + y * y > reach * reach) {
							continue;
						}
						const int under = cellAt(land, x, y);
						height[cell] = ground.terrain().elevation(x, y) * kRelief;
						mask[cell] = under < 0 ? 0 : mountains[static_cast<size_t>(under)];
						above[cell] = under < 0 ? 1 : 1 - lowland[static_cast<size_t>(under)];
						bool clear = railCrosses(ground.obstacle(x, y));
						for (int down = 0; down < 2; ++down) {
							for (int across = 0; across < 2; ++across) {
								const int landColumn = 2 * column + across;
								const int landRow = 2 * row + down;
								if (area[static_cast<size_t>(landRow * land.size + landColumn)] >= water.threshold()) {
									river[cell] = 1;
								}
								clear = clear && railCrosses(ground.obstacle(cellCentre(land, landColumn), cellCentre(land, landRow)));
							}
						}
						open[cell] = clear ? 1 : 0;
						outer[cell] = x * x + y * y > band * band ? 1 : 0;
					}
				}
			}

			// A line from the rim at bearing `from` to the rim at bearing `to`, kept off the rim between them when `rim`;
			// none where nothing fits.
			std::optional<RailLine> lay(double from, double to, bool rim) {
				rimCost = rim ? kRimCost : 1;
				const std::vector<RimEnd> starts = endsAt(from);
				const std::vector<RimEnd> ends = endsAt(to);
				const bool				  shared = std::ranges::any_of(starts, [&](const RimEnd& start) {
					   return std::ranges::any_of(ends, [&](const RimEnd& end) { return end.cell == start.cell; });
				   });
				if (starts.empty() || ends.empty() || shared) {
					return std::nullopt;
				}
				const std::vector<int> cells = search(starts, ends);
				if (cells.empty()) {
					return std::nullopt;
				}
				const auto endOn = [](std::span<const RimEnd> list, int cell) {
					return std::ranges::find(list, cell, &RimEnd::cell)->rim;
				};
				std::vector<Point> path{endOn(starts, cells.front())};
				for (const int cell : cells) {
					path.push_back({.x = cellCentre(grid, cell % grid.size), .y = cellCentre(grid, cell / grid.size)});
				}
				path.push_back(endOn(ends, cells.back()));
				std::optional<std::vector<Point>> points = smooth(path);
				if (!points || doublesBack(*points) || besideEarlier(*points)) {
					return std::nullopt;
				}
				mark(cells);
				laid.push_back(*points);
				const double			alongLine = polylineLength(*points);
				std::vector<RoadBridge> bridges = decksOf(*points);
				return RailLine{.points = std::move(*points), .length = alongLine, .bridges = std::move(bridges)};
			}

		  private:
			const Ground* ground;
			LandGrid	  grid;
			double		  radius;
			// Per search cell: its centre's height in world units, the range mask, how far above the low ground, whether
			// any land cell under it is river, whether it's open, within kApart of a laid line, and past the rim band.
			std::vector<double>	 height;
			std::vector<double>	 mask;
			std::vector<double>	 above;
			std::vector<uint8_t> river;
			std::vector<uint8_t> open;
			std::vector<uint8_t> crowded;
			std::vector<uint8_t> outer;
			// What a move past the rim band costs times, for the line being laid.
			double							rimCost{1};
			std::vector<std::vector<Point>> laid;

			// The open cells just inside the rim within kSpread degrees of a bearing, off the rivers, each once.
			[[nodiscard]] std::vector<RimEnd> endsAt(double bearing) const {
				const double		inside = radius - (kInset + 0.75) * grid.cellSize;
				std::vector<RimEnd> ends;
				const auto			steps = static_cast<int>(2 * kSpread / kSpreadStep);
				for (int step = 0; step <= steps; ++step) {
					const Point towards = unitVector(bearing - kSpread + step * kSpreadStep);
					const int	cell = cellAt(grid, towards.x * inside, towards.y * inside);
					if (cell < 0 || open[static_cast<size_t>(cell)] == 0 || river[static_cast<size_t>(cell)] == 1 ||
						std::ranges::find(ends, cell, &RimEnd::cell) != ends.end()) {
						continue;
					}
					ends.push_back({.cell = cell, .rim = {.x = towards.x * radius, .y = towards.y * radius}});
				}
				return ends;
			}

			// A* from any start to any goal over open cells, its heuristic the straight distance to the nearest goal,
			// which no move undercuts, ties to the lower cell: the cells in order, or none where nothing joins them.
			[[nodiscard]] std::vector<int> search(std::span<const RimEnd> starts, std::span<const RimEnd> goals) const {
				const int			 size = grid.size;
				const auto			 cells = static_cast<size_t>(grid.cells());
				std::vector<double>	 cost(cells, std::numeric_limits<double>::infinity());
				std::vector<double>	 guesses(cells, -1);
				std::vector<int>	 came(cells, -1);
				std::vector<uint8_t> done(cells);
				std::vector<uint8_t> goal(cells);
				for (const RimEnd& end : goals) {
					goal[static_cast<size_t>(end.cell)] = 1;
				}
				const auto heuristic = [&](int cell) {
					double& guess = guesses[static_cast<size_t>(cell)];
					if (guess < 0) {
						double nearest = std::numeric_limits<double>::infinity();
						for (const RimEnd& end : goals) {
							const double dx = cell % size - end.cell % size;
							const double dy = cell / size - end.cell / size;
							nearest = std::min(nearest, dx * dx + dy * dy);
						}
						guess = std::sqrt(nearest) * grid.cellSize;
					}
					return guess;
				};
				NodeHeap heap;
				for (const RimEnd& start : starts) {
					cost[static_cast<size_t>(start.cell)] = 0;
					heap.push(heuristic(start.cell), start.cell);
				}
				int reached = -1;
				while (!heap.empty() && reached < 0) {
					const int cell = heap.pop().second;
					if (done[static_cast<size_t>(cell)] == 1) {
						continue;
					}
					done[static_cast<size_t>(cell)] = 1;
					if (goal[static_cast<size_t>(cell)] == 1) {
						reached = cell;
						continue;
					}
					const int column = cell % size;
					const int row = cell / size;
					for (const auto& [dx, dy] : kNeighbours) {
						const int nextColumn = column + dx;
						const int nextRow = row + dy;
						if (nextColumn < 0 || nextRow < 0 || nextColumn >= size || nextRow >= size) {
							continue;
						}
						const int  next = nextRow * size + nextColumn;
						const bool diagonal = dx != 0 && dy != 0;
						if (done[static_cast<size_t>(next)] == 1 || open[static_cast<size_t>(next)] == 0) {
							continue;
						}
						if (diagonal && (open[static_cast<size_t>(row * size + nextColumn)] == 0 ||
										 open[static_cast<size_t>(nextRow * size + column)] == 0)) {
							continue;
						}
						const double through = cost[static_cast<size_t>(cell)] + moveCost(cell, next, diagonal);
						if (through < cost[static_cast<size_t>(next)]) {
							cost[static_cast<size_t>(next)] = through;
							came[static_cast<size_t>(next)] = cell;
							heap.push(through + heuristic(next), next);
						}
					}
				}
				std::vector<int> path;
				for (int cell = reached; cell >= 0; cell = came[static_cast<size_t>(cell)]) {
					path.push_back(cell);
				}
				std::ranges::reverse(path);
				return path;
			}

			[[nodiscard]] double moveCost(int from, int to, bool diagonal) const {
				const auto	 a = static_cast<size_t>(from);
				const auto	 b = static_cast<size_t>(to);
				const double step = (diagonal ? std::numbers::sqrt2 : 1) * grid.cellSize;
				const double grade = (height[b] - height[a]) / step;
				const double standing = (above[a] + above[b]) / 2;
				const double ranges = (mask[a] + mask[b]) / 2;
				double cost = step * (1 + kGradeWeight * grade * grade) * (1 + kValleyWeight * standing) + kRangeWeight * ranges * step;
				cost += kRiverCell * (river[a] + river[b]);
				if (crowded[a] == 1 || crowded[b] == 1) {
					cost *= kApartCost;
				}
				if (outer[a] == 1 || outer[b] == 1) {
					cost *= rimCost;
				}
				return cost;
			}

			// Where the line bridges rivers, as a road would, merged across short gaps.
			[[nodiscard]] std::vector<RoadBridge> decksOf(std::span<const Point> points) const {
				std::vector<RoadBridge> decks;
				for (const RoadBridge& deck : polylineBridges(*ground, points)) {
					if (!decks.empty() && deck.start - decks.back().end <= kDeckGap) {
						decks.back().end = std::max(decks.back().end, deck.end);
					} else {
						decks.push_back(deck);
					}
				}
				return decks;
			}

			// Whether a rail runs there: inside the disc, over ground no road is kept off, and on no deck past
			// kLongestDeck.
			[[nodiscard]] bool passes(std::span<const Point> points) const {
				const double reach = radius + 1e-9;
				if (std::ranges::any_of(points, [&](Point at) { return at.x * at.x + at.y * at.y > reach * reach; })) {
					return false;
				}
				const std::vector<RoadBridge> decks = decksOf(points);
				if (std::ranges::any_of(decks, [](const RoadBridge& deck) { return deck.end - deck.start > kLongestDeck; })) {
					return false;
				}
				return !impassableAlong(*ground, points, decks).has_value();
			}

			// The path as a gentle curve: the smoothest that passes, or the cells themselves, or none.
			[[nodiscard]] std::optional<std::vector<Point>> smooth(const std::vector<Point>& path) const {
				for (const double tolerance : kTolerances) {
					std::vector<Point> points = simplify(path, tolerance * grid.cellSize);
					for (int pass = 0; pass < kPasses; ++pass) {
						points = chaikin(points);
					}
					if (passes(points)) {
						return points;
					}
				}
				if (passes(path)) {
					return path;
				}
				return std::nullopt;
			}

			[[nodiscard]] bool besideEarlier(std::span<const Point> points) const {
				if (laid.empty()) {
					return false;
				}
				const double total = polylineLength(points);
				double		 near = 0;
				for (double along = 0; along <= total; along += kBesideStep) {
					const Point at = pointAlong(points, along);
					if (std::ranges::any_of(laid, [&](const std::vector<Point>& line) { return nearLine(line, at, kBesideReach); })) {
						near += kBesideStep;
					}
					if (near > kBesideMost) {
						return true;
					}
				}
				return false;
			}

			// The cells within kApart of a laid line, so the next keeps its distance.
			void mark(std::span<const int> cells) {
				const int size = grid.size;
				for (const int cell : cells) {
					const int column = cell % size;
					const int row = cell / size;
					for (int dy = -kApart; dy <= kApart; ++dy) {
						for (int dx = -kApart; dx <= kApart; ++dx) {
							const int x = column + dx;
							const int y = row + dy;
							if (x >= 0 && y >= 0 && x < size && y < size && dx * dx + dy * dy <= kApart * kApart) {
								crowded[static_cast<size_t>(y * size + x)] = 1;
							}
						}
					}
				}
			}
		};

	} // namespace

	std::vector<RailLine> railLines(const RailArgs& args) {
		std::vector<RailLine> lines;
		if (args.count <= 0) {
			return lines;
		}
		RailField		field(args.ground);
		foundation::Rng stream(args.stream.seed());
		const double	spin = stream.nextDouble() * 360;
		for (int index = 0; index < args.count; ++index) {
			foundation::Rng own = stream.fork("rail", static_cast<uint32_t>(index));
			const double	first = spin + 180.0 * index / args.count;
			for (int attempt = 0; attempt < kTries; ++attempt) {
				// A try's draws depend only on which try it is.
				const double			turned = first + (attempt == 0 ? 0 : (own.nextDouble() * 2 - 1) * kTurn);
				const double			second = first + kLeastAcross + (kMostAcross - kLeastAcross) * own.nextDouble();
				std::optional<RailLine> line = field.lay(turned, second, attempt < kTries - 1);
				if (line) {
					lines.push_back(std::move(*line));
					break;
				}
			}
		}
		return lines;
	}

} // namespace rules::map
