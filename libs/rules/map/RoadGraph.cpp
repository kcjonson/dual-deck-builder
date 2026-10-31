#include "RoadGraph.h"

#include "EdgeCostField.h"
#include "RoadChecks.h"

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <set>
#include <utility>

namespace rules::map {

	namespace {

		// Douglas-Peucker's tolerance on a stretch's cells, as a share of a cell; Chaikin passes after it; and
		// passes of a quarter, half, quarter average before it, which take out steps back and forth between two
		// rows that no simplifying would.
		struct Shape {
			double simplify = 0.6;
			int	   smoothing = 2;
			int	   relaxing = 2;
		};

		constexpr Shape kShape;

		size_t at(int index) {
			return static_cast<size_t>(index);
		}

		struct Trace {
			int		  from{0};
			int		  to{0};
			RoadClass roadClass{RoadClass::Highway};
			// A highway's number, -1 on any other class.
			int highway{-1};
			// Its cells, end to end.
			std::vector<int> cells;
		};

		// A trace's run from one hold to the next, by the index of each among its cells, with its line at each
		// detail level, best first.
		struct Run {
			size_t							first{0};
			size_t							last{0};
			std::vector<std::vector<Point>> levels;
		};

		// One pass of a quarter, half, quarter average over a line's inner points, its ends held.
		std::vector<Point> relaxed(const std::vector<Point>& points) {
			std::vector<Point> out = points;
			for (size_t index = 1; index + 1 < points.size(); ++index) {
				out[index] = {
					.x = 0.25 * points[index - 1].x + 0.5 * points[index].x + 0.25 * points[index + 1].x,
					.y = 0.25 * points[index - 1].y + 0.5 * points[index].y + 0.25 * points[index + 1].y,
				};
			}
			return out;
		}

		std::vector<Point> smoothed(std::vector<Point> line) {
			for (int pass = 0; pass < kShape.smoothing; ++pass) {
				line = chaikin(line);
			}
			return line;
		}

		// The point on the segment from `segment` to the next `offset` world units along it from its first, moved
		// onto one of its samples, a whole number of kPassableSpacing from its lower-left end: back along the line
		// where `toward` is -1, on where it's 1, and to the nearest where it's 0. Never either end.
		Point latticePoint(std::span<const Point> points, size_t segment, double offset, int toward) {
			const Point	 a = points[segment];
			const Point	 b = points[segment + 1];
			const bool	 forward = a.x < b.x || (a.x == b.x && a.y <= b.y);
			const Point	 start = forward ? a : b;
			const Point	 end = forward ? b : a;
			const double length = std::sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
			const double steps = (forward ? offset : length - offset) / kPassableSpacing;
			const int	 way = forward ? toward : -toward;
			const double rounded = way < 0 ? std::floor(steps) : (way > 0 ? std::ceil(steps) : std::round(steps));
			const double last = std::ceil(length / kPassableSpacing) - 1;
			const double step = rounded < 1 ? 1 : (rounded > last ? last : rounded);
			const double share = step * kPassableSpacing / length;
			return {.x = start.x + (end.x - start.x) * share, .y = start.y + (end.y - start.y) * share};
		}

		RoadNodeKind kindOf(PlaceKind kind) {
			switch (kind) {
				case PlaceKind::Metro:
					return RoadNodeKind::Compound;
				case PlaceKind::Town:
					return RoadNodeKind::Town;
				case PlaceKind::Village:
					return RoadNodeKind::Village;
				case PlaceKind::Crossroads:
					return RoadNodeKind::Crossroads;
				case PlaceKind::Exit:
					return RoadNodeKind::Exit;
			}
			return RoadNodeKind::Compound;
		}

		class GraphBuilder {
		  public:
			explicit GraphBuilder(const RoadGraphArgs& args)
				: links(args.links),
				  places(args.places),
				  ground(args.ground),
				  grid(args.ground.terrain().surface().grid),
				  size(grid.size),
				  metroSquared(args.ground.terrain().start().metro * args.ground.terrain().start().metro),
				  moveAt(at(grid.cells() * detail::kSlots), -1),
				  mask(at(grid.cells())),
				  placeAt(at(grid.cells()), -1),
				  nodeAt(at(grid.cells()), -1) {
				for (size_t index = 0; index < links.moves.size(); ++index) {
					const RoadMove& move = links.moves[index];
					moveAt[at(edgeId(size, move.from, move.direction))] = static_cast<int>(index);
					mask[at(move.from)] = static_cast<uint16_t>(mask[at(move.from)] | (1U << move.direction));
					mask[at(move.to)] = static_cast<uint16_t>(mask[at(move.to)] | (1U << kOpposite[at(move.direction)]));
				}
				for (size_t id = 0; id < links.placeCells.size(); ++id) {
					if (links.placeCells[id] >= 0) {
						placeAt[at(links.placeCells[id])] = static_cast<int>(id);
					}
				}
				for (const int cell : compoundCells(grid)) {
					placeAt[at(cell)] = 0;
				}
			}

			RoadGraph build() {
				placeNodes();
				walk();
				splitLoops();
				for (size_t id = 0; id < traces.size(); ++id) {
					raws.push_back(rawLine(traces[id]));
					std::vector<Run>		  list;
					const std::vector<size_t> held = holdsOf(traces[id]);
					for (size_t hold = 0; hold + 1 < held.size(); ++hold) {
						list.push_back(makeRun(id, held[hold], held[hold + 1]));
					}
					levels.emplace_back(list.size(), 0);
					runs.push_back(std::move(list));
				}
				for (size_t id = 0; id < runs.size(); ++id) {
					for (size_t index = runs[id].size(); index-- > 0;) {
						settle(id, index);
					}
				}
				resolveClashes();
				count();
				cutStretches();
				return std::move(graph);
			}

		  private:
			const RoadLinks&				 links;
			std::span<const Place>			 places;
			const Ground&					 ground;
			LandGrid						 grid;
			int								 size;
			double							 metroSquared;
			std::vector<int>				 moveAt;
			std::vector<uint16_t>			 mask;
			std::vector<int>				 placeAt;
			std::vector<int>				 nodeAt;
			std::vector<Trace>				 traces;
			std::vector<std::vector<Point>>	 raws;
			std::vector<std::vector<Run>>	 runs;
			std::vector<std::vector<size_t>> levels;
			RoadGraph						 graph;

			[[nodiscard]] Point centre(int cell) const { return {.x = cellCentre(grid, cell % size), .y = cellCentre(grid, cell / size)}; }

			[[nodiscard]] bool insideMetro(int cell) const {
				const Point point = centre(cell);
				return point.x * point.x + point.y * point.y <= metroSquared;
			}

			[[nodiscard]] const RoadMove& roadMove(int cell, int direction) const {
				return links.moves[at(moveAt[at(edgeId(size, cell, direction))])];
			}

			[[nodiscard]] int stepTo(int cell, int direction) const { return cell + kMoveY[at(direction)] * size + kMoveX[at(direction)]; }

			[[nodiscard]] int directionOf(int cell, int next) const {
				return moveBetween(next % size - cell % size, next / size - cell / size);
			}

			// What a cell is as a node, or nothing for a road running on through it.
			[[nodiscard]] std::optional<RoadNodeKind> kindAt(int cell) const {
				const int place = placeAt[at(cell)];
				if (place >= 0) {
					return kindOf(places[at(place)].kind);
				}
				const int roads = std::popcount(mask[at(cell)]);
				if (roads == 0) {
					return std::nullopt;
				}
				if (roads >= 3) {
					return RoadNodeKind::Junction;
				}
				if (roads == 1) {
					return RoadNodeKind::End;
				}
				std::array<int, 2>		 next{};
				std::array<RoadClass, 2> classes{};
				size_t					 found = 0;
				for (int direction = 0; direction < kMoves; ++direction) {
					if ((mask[at(cell)] & (1U << direction)) != 0) {
						next[found] = stepTo(cell, direction);
						classes[found] = roadMove(cell, direction).roadClass;
						found += 1;
					}
				}
				if (insideMetro(cell) && (!insideMetro(next[0]) || !insideMetro(next[1]))) {
					return RoadNodeKind::MetroEdge;
				}
				if (classes[0] != classes[1]) {
					return RoadNodeKind::ClassChange;
				}
				return std::nullopt;
			}

			void placeNodes() {
				graph.nodes.push_back({.kind = RoadNodeKind::Compound, .x = 0, .y = 0, .place = 0});
				for (int cell = 0; cell < grid.cells(); ++cell) {
					if (placeAt[at(cell)] == 0) {
						nodeAt[at(cell)] = 0;
						continue;
					}
					if (mask[at(cell)] == 0) {
						continue;
					}
					const std::optional<RoadNodeKind> kind = kindAt(cell);
					if (!kind) {
						continue;
					}
					nodeAt[at(cell)] = static_cast<int>(graph.nodes.size());
					const Point point = centre(cell);
					graph.nodes.push_back({.kind = *kind, .x = point.x, .y = point.y, .place = placeAt[at(cell)]});
				}
			}

			// Each road from each node to the next, every move once.
			void walk() {
				std::vector<uint8_t> walked(links.moves.size());
				std::vector<int>	 starts;
				for (int cell = 0; cell < grid.cells(); ++cell) {
					if (nodeAt[at(cell)] >= 0) {
						starts.push_back(cell);
					}
				}
				std::ranges::sort(starts, [&](int a, int b) {
					return nodeAt[at(a)] != nodeAt[at(b)] ? nodeAt[at(a)] < nodeAt[at(b)] : a < b;
				});
				for (const int start : starts) {
					for (int direction = 0; direction < kMoves; ++direction) {
						if ((mask[at(start)] & (1U << direction)) == 0) {
							continue;
						}
						const int first = moveAt[at(edgeId(size, start, direction))];
						if (walked[at(first)] != 0) {
							continue;
						}
						walked[at(first)] = 1;
						std::vector<int> cells{start, stepTo(start, direction)};
						int				 previous = start;
						int				 here = cells.back();
						while (nodeAt[at(here)] < 0) {
							std::optional<int> onward;
							for (int toward = 0; toward < kMoves && !onward; ++toward) {
								if ((mask[at(here)] & (1U << toward)) == 0) {
									continue;
								}
								const int candidate = stepTo(here, toward);
								const int move = moveAt[at(edgeId(size, here, toward))];
								if (candidate != previous && walked[at(move)] == 0) {
									walked[at(move)] = 1;
									onward = candidate;
								}
							}
							if (!onward) {
								break;
							}
							previous = here;
							here = *onward;
							cells.push_back(here);
						}
						if (nodeAt[at(here)] < 0) {
							continue;
						}
						const RoadClass roadClass = links.moves[at(first)].roadClass;
						int				highway = -1;
						for (size_t step = 0; roadClass == RoadClass::Highway && highway < 0 && step + 1 < cells.size(); ++step) {
							highway = roadMove(cells[step], directionOf(cells[step], cells[step + 1])).highway;
						}
						traces.push_back(
							{.from = nodeAt[at(start)],
							 .to = nodeAt[at(here)],
							 .roadClass = roadClass,
							 .highway = highway,
							 .cells = std::move(cells)}
						);
					}
				}
			}

			// A loop back to its own node is split at its middle, so every stretch joins two nodes.
			void splitLoops() {
				std::vector<Trace> split;
				for (Trace& trace : traces) {
					if (trace.from != trace.to) {
						split.push_back(std::move(trace));
						continue;
					}
					if (trace.cells.size() < 3) {
						continue;
					}
					const size_t middle = trace.cells.size() / 2;
					const int	 cell = trace.cells[middle];
					const auto	 node = static_cast<int>(graph.nodes.size());
					const Point	 point = centre(cell);
					graph.nodes.push_back({.kind = RoadNodeKind::Roadside, .x = point.x, .y = point.y, .place = -1});
					nodeAt[at(cell)] = node;
					Trace out = trace;
					out.to = node;
					out.cells.assign(trace.cells.begin(), trace.cells.begin() + static_cast<std::ptrdiff_t>(middle) + 1);
					Trace back = std::move(trace);
					back.from = node;
					back.cells.erase(back.cells.begin(), back.cells.begin() + static_cast<std::ptrdiff_t>(middle));
					split.push_back(std::move(out));
					split.push_back(std::move(back));
				}
				traces = std::move(split);
			}

			// A trace's cells as a line, its first and last at its nodes, the compound's cell giving way to the origin.
			[[nodiscard]] std::vector<Point> rawLine(const Trace& trace) const {
				std::vector<Point> raw;
				for (size_t index = 0; index < trace.cells.size(); ++index) {
					if (index == 0 || index + 1 == trace.cells.size()) {
						const RoadNode& node = graph.nodes[at(index == 0 ? trace.from : trace.to)];
						raw.push_back({.x = node.x, .y = node.y});
					} else {
						raw.push_back(centre(trace.cells[index]));
					}
				}
				return raw;
			}

			// Where a trace is held: its ends and both ends of every bridge move, which so stays straight.
			[[nodiscard]] std::vector<size_t> holdsOf(const Trace& trace) const {
				std::set<size_t> holds{0, trace.cells.size() - 1};
				for (size_t step = 0; step + 1 < trace.cells.size(); ++step) {
					if (roadMove(trace.cells[step], directionOf(trace.cells[step], trace.cells[step + 1])).bridged) {
						holds.insert(step);
						holds.insert(step + 1);
					}
				}
				return {holds.begin(), holds.end()};
			}

			// A run from one hold to the next at every detail level: relaxed, simplified, and smoothed; simplified
			// and smoothed; simplified; and its cells. One out of the compound gets a last level through the centre
			// of the cell it leaves by, since the line from the origin to the next cell is no move the field proved.
			[[nodiscard]] Run makeRun(size_t id, size_t first, size_t last) const {
				const Trace&			  trace = traces[id];
				const std::vector<Point>& raw = raws[id];
				const double			  tolerance = kShape.simplify * grid.cellSize;
				const std::vector<Point>  run(
					 raw.begin() + static_cast<std::ptrdiff_t>(first), raw.begin() + static_cast<std::ptrdiff_t>(last) + 1
				 );
				std::vector<Point> relaxedRun = run;
				for (int pass = 0; pass < kShape.relaxing; ++pass) {
					relaxedRun = relaxed(relaxedRun);
				}
				std::vector<Point> simple = simplify(run, tolerance);
				Run				   made{.first = first, .last = last, .levels = {}};
				made.levels.push_back(smoothed(simplify(relaxedRun, tolerance)));
				made.levels.push_back(smoothed(simple));
				made.levels.push_back(std::move(simple));
				made.levels.push_back(run);
				if (first == 0 && trace.from == 0) {
					std::vector<Point> through = run;
					through.insert(through.begin() + 1, centre(trace.cells.front()));
					made.levels.push_back(std::move(through));
				} else if (last + 1 == trace.cells.size() && trace.to == 0) {
					std::vector<Point> through = run;
					through.insert(through.end() - 1, centre(trace.cells[last]));
					made.levels.push_back(std::move(through));
				}
				return made;
			}

			// A trace's line from its runs at their levels, each joint once.
			[[nodiscard]] std::vector<Point> assemble(size_t id) const {
				std::vector<Point> line;
				for (size_t index = 0; index < runs[id].size(); ++index) {
					const std::vector<Point>& points = runs[id][index].levels[levels[id][index]];
					line.insert(line.end(), points.begin() + (index == 0 ? 0 : 1), points.end());
				}
				return line;
			}

			// The run a segment of a trace's assembled line belongs to.
			[[nodiscard]] size_t runAt(size_t id, size_t segment) const {
				size_t passed = 0;
				for (size_t index = 0; index < runs[id].size(); ++index) {
					passed += runs[id][index].levels[levels[id][index]].size() - 1;
					if (segment < passed) {
						return index;
					}
				}
				return runs[id].size() - 1;
			}

			// A run settled: smoothed if that's passable; where a smoothed run clips something, held at the cell
			// nearest the trouble and both halves settled again; and otherwise down a level until it passes. The
			// cells always do, since the field sampled every move that could cross anything.
			void settle(size_t id, size_t index) {
				for (;;) {
					const Run&					run = runs[id][index];
					const size_t				level = levels[id][index];
					const std::vector<Point>&	points = run.levels[level];
					const std::optional<double> clipped = impassableAlong(ground, points, polylineBridges(ground, points));
					if (!clipped) {
						return;
					}
					if (level == 0 && run.last - run.first >= 2) {
						const Point				  trouble = pointAlong(points, *clipped);
						const std::vector<Point>& raw = raws[id];
						const size_t			  first = run.first;
						const size_t			  last = run.last;
						size_t					  hold = first + 1;
						double					  nearest = std::numeric_limits<double>::infinity();
						for (size_t cell = first + 1; cell < last; ++cell) {
							const double dx = raw[cell].x - trouble.x;
							const double dy = raw[cell].y - trouble.y;
							if (dx * dx + dy * dy < nearest) {
								nearest = dx * dx + dy * dy;
								hold = cell;
							}
						}
						Run before = makeRun(id, first, hold);
						Run after = makeRun(id, hold, last);
						runs[id][index] = std::move(before);
						runs[id].insert(runs[id].begin() + static_cast<std::ptrdiff_t>(index) + 1, std::move(after));
						levels[id][index] = 0;
						levels[id].insert(levels[id].begin() + static_cast<std::ptrdiff_t>(index) + 1, 0);
						graph.stats.splits += 1;
						settle(id, index + 1);
						continue;
					}
					if (level + 1 >= run.levels.size()) {
						return;
					}
					levels[id][index] += 1;
				}
			}

			// Runs that clash with another fall back a level and settle again, until nothing clashes.
			void resolveClashes() {
				for (bool changed = true; changed;) {
					changed = false;
					std::vector<std::vector<Point>> lines;
					std::vector<RoadLine>			roadLines;
					for (size_t id = 0; id < traces.size(); ++id) {
						lines.push_back(assemble(id));
					}
					for (size_t id = 0; id < traces.size(); ++id) {
						roadLines.push_back({.from = traces[id].from, .to = traces[id].to, .points = lines[id]});
					}
					std::set<std::pair<size_t, size_t>> degrade;
					for (const RoadClash& clash : roadClashes(graph.nodes, roadLines, true)) {
						degrade.insert({clash.a, runAt(clash.a, clash.segmentA)});
						degrade.insert({clash.b, runAt(clash.b, clash.segmentB)});
					}
					for (const auto& [id, index] : degrade) {
						if (levels[id][index] + 1 >= runs[id][index].levels.size()) {
							continue;
						}
						levels[id][index] += 1;
						settle(id, index);
						changed = true;
					}
				}
			}

			void count() {
				RoadGraphStats& stats = graph.stats;
				for (size_t id = 0; id < runs.size(); ++id) {
					for (size_t index = 0; index < runs[id].size(); ++index) {
						const size_t level = levels[id][index];
						stats.smoothed += level == 0 ? 1 : 0;
						stats.unaveraged += level == 1 ? 1 : 0;
						stats.simplified += level == 2 ? 1 : 0;
						stats.cells += level >= 3 ? 1 : 0;
						stats.stairs += level >= 3 && runs[id][index].last - runs[id][index].first >= 3 ? 1 : 0;
					}
				}
			}

			void cutStretches() {
				for (size_t id = 0; id < traces.size(); ++id) {
					const Trace&						  trace = traces[id];
					const std::vector<Point>			  line = assemble(id);
					const std::vector<std::vector<Point>> pieces = splitLong(line, polylineBridges(ground, line));
					for (size_t piece = 0; piece < pieces.size(); ++piece) {
						const int from = piece == 0 ? trace.from : static_cast<int>(graph.nodes.size()) - 1;
						int		  to = trace.to;
						if (piece + 1 < pieces.size()) {
							to = static_cast<int>(graph.nodes.size());
							const Point end = pieces[piece].back();
							graph.nodes.push_back({.kind = RoadNodeKind::Roadside, .x = end.x, .y = end.y, .place = -1});
						}
						const std::vector<Point>& points = pieces[piece];
						const bool				  street = std::ranges::all_of(points, [&](const Point& point) {
							   return point.x * point.x + point.y * point.y <= metroSquared;
						   });
						graph.stretches.push_back({
							.roadClass = trace.roadClass,
							.from = from,
							.to = to,
							.length = polylineLength(points),
							.points = points,
							.bridges = polylineBridges(ground, points),
							.street = street,
							.highway = trace.roadClass == RoadClass::Highway ? trace.highway : -1,
						});
					}
				}
			}
		};

	} // namespace

	RoadGraph buildRoadGraph(const RoadGraphArgs& args) {
		return GraphBuilder(args).build();
	}

	std::vector<std::vector<Point>> splitLong(std::span<const Point> points, std::span<const RoadBridge> bridges) {
		const double length = polylineLength(points);
		const double parts = std::ceil(length / kLongestStretch);
		if (parts <= 1) {
			return {{points.begin(), points.end()}};
		}
		const std::vector<double> along = lengthsAlong(points);
		std::vector<double>		  cuts;
		// Per cut, which way it rounds onto a sample: back off the start of a deck, on off its end, or to the nearest.
		std::vector<int> towards;
		for (double part = 1; part < parts; ++part) {
			double	   target = length * part / parts;
			int		   toward = 0;
			const auto deck =
				std::ranges::find_if(bridges, [&](const RoadBridge& bridge) { return target >= bridge.start && target <= bridge.end; });
			if (deck != bridges.end()) {
				toward = target - deck->start < deck->end - target ? -1 : 1;
				target = toward < 0 ? deck->start : deck->end;
			}
			const double previous = cuts.empty() ? 0 : cuts.back();
			if (target - previous >= 1 && length - target >= 1) {
				cuts.push_back(target);
				towards.push_back(toward);
			}
		}
		std::vector<std::vector<Point>> pieces;
		std::vector<Point>				piece{points.front()};
		size_t							cut = 0;
		for (size_t point = 1; point < points.size(); ++point) {
			while (cut < cuts.size() && cuts[cut] < along[point] - 1) {
				// Within a unit of the point before, the cut moves onto it.
				if (cuts[cut] - along[point - 1] < 1 && piece.size() > 1) {
					pieces.push_back(piece);
					piece = {piece.back()};
				} else {
					const Point lattice = latticePoint(points, point - 1, cuts[cut] - along[point - 1], towards[cut]);
					piece.push_back(lattice);
					pieces.push_back(piece);
					piece = {lattice};
				}
				cut += 1;
			}
			piece.push_back(points[point]);
			if (cut < cuts.size() && cuts[cut] <= along[point] && point + 1 < points.size()) {
				pieces.push_back(piece);
				piece = {points[point]};
				cut += 1;
			}
		}
		pieces.push_back(std::move(piece));
		return pieces;
	}

} // namespace rules::map
