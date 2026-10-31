#include "Rivers.h"

#include "Land.h"
#include "MapMath.h"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <numeric>
#include <utility>

namespace rules::map {

	namespace {

		struct Point {
			double x;
			double y;
		};

		// Rain-weighted area, in cells of average rain, at riverDensity 0 and 1.
		constexpr double kSparseThreshold = 700;
		constexpr double kDenseThreshold = 110;

		// `min` at the threshold, growing with the square root of the area past it, up to `max`; a river
		// rising at a source widens from `min` over its first `rise` world units, since one rising where many
		// small flows meet on flat ground would otherwise start broad.
		struct Widths {
			double min = 1.2;
			double gain = 0.75;
			double max = 9;
			double rise = 40;
		};

		// Douglas-Peucker at `simplify` cells, which takes out the eight-direction staircase, down to `steep`
		// of it past grade `steepGrade`, so a river in a steep valley keeps to its floor rather than cutting
		// over a spur; `smoothing` passes of Chaikin; then points evenly `spacing` cells apart, so a long
		// straight run has somewhere to bend.
		struct Shape {
			double simplify = 0.6;
			double steep = 0.35;
			double steepGrade = 0.15;
			int	   smoothing = 3;
			double spacing = 1;
		};

		// A sideways offset from noise along the river, `wavelength` world units long: `least` cells anywhere,
		// so no river runs ruler-straight, plus up to `amplitude` cells at riverMeander 1, full on ground
		// flatter than grade `flat` and none past `steep`. It tapers to nothing over `taper` world units at
		// each end, so confluences and lakes stay joined, and never moves a point further than `bend` of the
		// line's radius of curvature, so a bend can't fold over itself.
		struct Meander {
			double least = 0.4;
			double amplitude = 1.4;
			double wavelength = 90;
			double flat = 0.015;
			double steep = 0.06;
			double taper = 30;
			double bend = 0.6;
			// Each river reads its own row of the noise, this far across from the last.
			double row = 13.7;
		};

		constexpr Widths  kWidths;
		constexpr Shape	  kShape;
		constexpr Meander kMeander;

		double gradeAt(const GridSampler& land, Point point) {
			const GridSample sample = land.bicubic(point.x, point.y);
			return std::sqrt(sample.gradientX * sample.gradientX + sample.gradientY * sample.gradientY) * kRelief;
		}

		std::vector<double> lengthsAlong(const std::vector<Point>& line) {
			std::vector<double> along(line.size());
			for (size_t index = 1; index < line.size(); ++index) {
				const double dx = line[index].x - line[index - 1].x;
				const double dy = line[index].y - line[index - 1].y;
				along[index] = along[index - 1] + std::sqrt(dx * dx + dy * dy);
			}
			return along;
		}

		// Chaikin's corner cutting on an open line: each segment's inner quarter points replace its corners,
		// and the ends stay put.
		std::vector<Point> chaikin(const std::vector<Point>& line) {
			if (line.size() < 3) {
				return line;
			}
			std::vector<Point> smoothed{line.front()};
			for (size_t index = 0; index + 1 < line.size(); ++index) {
				const Point a = line[index];
				const Point b = line[index + 1];
				if (index > 0) {
					smoothed.push_back({.x = 0.75 * a.x + 0.25 * b.x, .y = 0.75 * a.y + 0.25 * b.y});
				}
				if (index + 2 < line.size()) {
					smoothed.push_back({.x = 0.25 * a.x + 0.75 * b.x, .y = 0.25 * a.y + 0.75 * b.y});
				}
			}
			smoothed.push_back(line.back());
			return smoothed;
		}

		// Douglas-Peucker keeping both ends: every point whose removal would move the line more than its own
		// tolerance stays.
		std::vector<Point> simplify(const std::vector<Point>& line, const std::vector<double>& tolerances) {
			if (line.size() < 3) {
				return line;
			}
			std::vector<uint8_t>				   keep(line.size());
			std::vector<std::pair<size_t, size_t>> pending;
			pending.emplace_back(0, line.size() - 1);
			keep.front() = 1;
			keep.back() = 1;
			while (!pending.empty()) {
				const auto [first, last] = pending.back();
				pending.pop_back();
				const Point	 a = line[first];
				const double dx = line[last].x - a.x;
				const double dy = line[last].y - a.y;
				const double lengthSquared = dx * dx + dy * dy;
				// Each point's squared distance from the chord over its squared tolerance, times the chord's
				// squared length, so no square root is taken.
				double most = lengthSquared > 0 ? lengthSquared : 1;
				size_t farthest = 0;
				for (size_t index = first + 1; index < last; ++index) {
					const double px = line[index].x - a.x;
					const double py = line[index].y - a.y;
					const double cross = dx * py - dy * px;
					const double away = (lengthSquared > 0 ? cross * cross : px * px + py * py) / (tolerances[index] * tolerances[index]);
					if (away > most) {
						most = away;
						farthest = index;
					}
				}
				if (farthest > 0) {
					keep[farthest] = 1;
					pending.emplace_back(first, farthest);
					pending.emplace_back(farthest, last);
				}
			}
			std::vector<Point> simplified;
			for (size_t index = 0; index < line.size(); ++index) {
				if (keep[index] != 0) {
					simplified.push_back(line[index]);
				}
			}
			return simplified;
		}

		// The line's points evenly along it, `spacing` apart or a little less, its ends kept, so every point's
		// neighbours are the same distance away for the meander's normals and its room to bend.
		std::vector<Point> resampled(const std::vector<Point>& line, double spacing) {
			if (line.size() < 2) {
				return line;
			}
			const std::vector<double> along = lengthsAlong(line);
			const double			  length = along.back();
			const double			  steps = std::ceil(length / spacing);
			if (!(steps > 1)) {
				return {line.front(), line.back()};
			}
			std::vector<Point> out{line.front()};
			size_t			   segment = 1;
			for (double step = 1; step < steps; ++step) {
				const double target = length * (step / steps);
				while (along[segment] < target) {
					++segment;
				}
				const double start = along[segment - 1];
				const double run = along[segment] - start;
				const double t = run > 0 ? (target - start) / run : 0;
				const Point	 a = line[segment - 1];
				const Point	 b = line[segment];
				out.push_back({.x = a.x + (b.x - a.x) * t, .y = a.y + (b.y - a.y) * t});
			}
			out.push_back(line.back());
			return out;
		}

		// The line moved sideways by noise along its length: `least` world units anywhere, plus up to `amount`
		// where the land is flat, tapering to nothing at both ends and held within kMeander.bend of the line's
		// radius of curvature.
		std::vector<Point> meandered(
			const std::vector<Point>& line,
			double					  least,
			double					  amount,
			const NoiseLayer&		  noise,
			double					  row,
			const GridSampler&		  land
		) {
			const size_t count = line.size();
			if (count < 3) {
				return line;
			}
			const std::vector<double> along = lengthsAlong(line);
			const double			  length = along.back();
			// Room to move at each point: the least, over the line, of a point's radius of curvature plus how far
			// along the line it is, so the room shrinks steadily toward a tight bend rather than only at it, and
			// neighbours can't cross there.
			std::vector<double> room(count, std::numeric_limits<double>::infinity());
			for (size_t index = 1; index + 1 < count; ++index) {
				const double inX = line[index].x - line[index - 1].x;
				const double inY = line[index].y - line[index - 1].y;
				const double outX = line[index + 1].x - line[index].x;
				const double outY = line[index + 1].y - line[index].y;
				const double turn = inX * outY - inY * outX;
				const double product = std::sqrt((inX * inX + inY * inY) * (outX * outX + outY * outY));
				const double sine = product > 0 ? std::abs(turn) / product : 0;
				if (sine > 0) {
					room[index] = 0.5 * (along[index + 1] - along[index - 1]) / sine;
				}
			}
			for (size_t index = 1; index < count; ++index) {
				room[index] = std::min(room[index], room[index - 1] + (along[index] - along[index - 1]));
			}
			for (size_t index = count - 1; index-- > 0;) {
				room[index] = std::min(room[index], room[index + 1] + (along[index + 1] - along[index]));
			}
			std::vector<Point> out = line;
			const double	   span = kMeander.steep - kMeander.flat;
			for (size_t index = 1; index + 1 < count; ++index) {
				const double taper = smooth01(std::min(along[index], length - along[index]) / kMeander.taper);
				if (taper <= 0) {
					continue;
				}
				double reach = least;
				if (amount > 0) {
					reach += amount * (1 - smooth01((gradeAt(land, line[index]) - kMeander.flat) / span));
				}
				const double cap = kMeander.bend * room[index];
				const double shift = std::clamp(reach * taper * noise.fractal(along[index] / kMeander.wavelength, row, 2, 0.5F), -cap, cap);
				// Square to the chord across the point, from its neighbour behind to its neighbour ahead.
				const double tx = line[index + 1].x - line[index - 1].x;
				const double ty = line[index + 1].y - line[index - 1].y;
				const double norm = std::sqrt(tx * tx + ty * ty);
				if (!(norm > 0)) {
					continue;
				}
				out[index] = {.x = line[index].x - ty / norm * shift, .y = line[index].y + tx / norm * shift};
			}
			return out;
		}

		// Moves the line's last point onto the nearest point of `target`.
		void snapEnd(std::vector<Point>& line, const std::vector<RiverPoint>& target) {
			assert(target.size() >= 2 && "snapEnd: a river is drawn before the tributaries that join it");
			const Point end = line.back();
			Point		nearest{.x = target.front().x, .y = target.front().y};
			double		best = std::numeric_limits<double>::infinity();
			for (size_t index = 0; index + 1 < target.size(); ++index) {
				const double ax = target[index].x;
				const double ay = target[index].y;
				const double dx = target[index + 1].x - ax;
				const double dy = target[index + 1].y - ay;
				const double lengthSquared = dx * dx + dy * dy;
				const double t = lengthSquared > 0 ? std::clamp(((end.x - ax) * dx + (end.y - ay) * dy) / lengthSquared, 0.0, 1.0) : 0;
				const Point	 point{.x = ax + dx * t, .y = ay + dy * t};
				const double squared = (point.x - end.x) * (point.x - end.x) + (point.y - end.y) * (point.y - end.y);
				if (squared < best) {
					best = squared;
					nearest = point;
				}
			}
			line.back() = nearest;
		}

		// A width per point, from the drainage area of the chain's cell the same share of the way along, by
		// length along each. A river that joins another or a lake ends on a cell of that, so it takes its own
		// last cell's area there instead.
		std::vector<double> widthsAlong(
			const std::vector<Point>& line,
			const std::vector<Point>& raw,
			const RiverChain&		  chain,
			std::span<const double>	  area,
			double					  threshold
		) {
			const bool				  joined = chain.end == RiverEnd::Confluence || chain.end == RiverEnd::Lake;
			const size_t			  last = joined && chain.cells.size() > 1 ? chain.cells.size() - 2 : chain.cells.size() - 1;
			const std::vector<double> lineAlong = lengthsAlong(line);
			const std::vector<double> rawAlong = lengthsAlong(raw);
			const double			  lineLength = lineAlong.back();
			const double			  rawLength = rawAlong.back();
			std::vector<double>		  widths;
			widths.reserve(line.size());
			size_t at = 0;
			for (const double distance : lineAlong) {
				const double target = lineLength > 0 ? distance / lineLength * rawLength : 0;
				// The cell whose stretch of the raw chain holds the same share: walk on while the next centre is nearer.
				while (at < last && rawAlong[at + 1] - target < target - rawAlong[at]) {
					++at;
				}
				const double width = riverWidth(area[static_cast<size_t>(chain.cells[at])], threshold);
				const double rise = chain.start == RiverStart::Source ? smooth01(distance / kWidths.rise) : 1;
				widths.push_back(kWidths.min + (width - kWidths.min) * rise);
			}
			return widths;
		}

		// Each river before the tributaries that join it, otherwise by index.
		std::vector<size_t> drawingOrder(const std::vector<RiverChain>& chains) {
			std::vector<int> depth(chains.size(), -1);
			for (size_t id = 0; id < chains.size(); ++id) {
				std::vector<size_t> path;
				size_t				at = id;
				while (depth[at] < 0 && chains[at].end == RiverEnd::Confluence) {
					path.push_back(at);
					at = static_cast<size_t>(chains[at].into);
				}
				int value = std::max(depth[at], 0);
				depth[at] = value;
				for (size_t index = path.size(); index-- > 0;) {
					depth[path[index]] = ++value;
				}
			}
			std::vector<size_t> order(chains.size());
			std::iota(order.begin(), order.end(), size_t{0});
			std::ranges::stable_sort(order, [&](size_t a, size_t b) { return depth[a] < depth[b]; });
			return order;
		}

	} // namespace

	double riverThreshold(double riverDensity) {
		return kSparseThreshold + (kDenseThreshold - kSparseThreshold) * riverDensity;
	}

	double riverWidth(double area, double threshold) {
		return std::clamp(kWidths.min + kWidths.gain * (std::sqrt(area / threshold) - 1), kWidths.min, kWidths.max);
	}

	std::vector<RiverChain> traceRivers(const TraceArgs& args) {
		const auto cells = static_cast<int>(args.receivers.size());
		const auto isRiver = [&](int cell) {
			return args.area[static_cast<size_t>(cell)] >= args.threshold;
		};
		const auto lakeOf = [&](int cell) {
			return args.lakeOf[static_cast<size_t>(cell)];
		};
		// Each cell's biggest river-sized donor, lake cells included.
		std::vector<int> mainDonor(static_cast<size_t>(cells), -1);
		for (int cell = 0; cell < cells; ++cell) {
			const int receiver = args.receivers[static_cast<size_t>(cell)];
			if (!isRiver(cell) || receiver < 0) {
				continue;
			}
			int& best = mainDonor[static_cast<size_t>(receiver)];
			if (best < 0 || args.area[static_cast<size_t>(cell)] > args.area[static_cast<size_t>(best)]) {
				best = cell;
			}
		}
		std::vector<int>		chainOf(static_cast<size_t>(cells), -1);
		std::vector<RiverChain> chains;
		for (int head = 0; head < cells; ++head) {
			if (!isRiver(head) || lakeOf(head) >= 0) {
				continue;
			}
			const int donor = mainDonor[static_cast<size_t>(head)];
			// Carried on from upstream: another chain runs through it.
			if (donor >= 0 && lakeOf(donor) < 0) {
				continue;
			}
			RiverChain chain{
				.cells = {},
				.start = donor >= 0 ? RiverStart::Lake : RiverStart::Source,
				.end = args.closedBasin ? RiverEnd::Sink : RiverEnd::Edge,
				.into = -1,
			};
			if (donor >= 0) {
				chain.cells.push_back(donor);
			}
			const auto id = static_cast<int>(chains.size());
			for (int cell = head;;) {
				chain.cells.push_back(cell);
				chainOf[static_cast<size_t>(cell)] = id;
				const int receiver = args.receivers[static_cast<size_t>(cell)];
				if (receiver < 0) {
					break;
				}
				if (lakeOf(receiver) >= 0) {
					chain.cells.push_back(receiver);
					chain.end = RiverEnd::Lake;
					chain.into = lakeOf(receiver);
					break;
				}
				if (mainDonor[static_cast<size_t>(receiver)] != cell) {
					chain.cells.push_back(receiver);
					chain.end = RiverEnd::Confluence;
					break;
				}
				cell = receiver;
			}
			// An outlet no river flows into is a single cell, not a river: nothing joins it, since any river
			// donor would carry on through it.
			if (chain.cells.size() < 2) {
				chainOf[static_cast<size_t>(head)] = -1;
				continue;
			}
			chains.push_back(std::move(chain));
		}
		for (RiverChain& chain : chains) {
			if (chain.end == RiverEnd::Confluence) {
				chain.into = chainOf[static_cast<size_t>(chain.cells.back())];
			}
		}
		return chains;
	}

	std::vector<River> drawRivers(std::vector<RiverChain> chains, const RiverLineArgs& args, const NoiseLayer& meander) {
		const LandGrid&	   grid = args.grid;
		const GridSampler  land(grid, args.elevation);
		const double	   tolerance = kShape.simplify * grid.cellSize;
		const double	   least = kMeander.least * grid.cellSize;
		const double	   amount = args.meander * kMeander.amplitude * grid.cellSize;
		std::vector<River> rivers(chains.size());
		for (const size_t id : drawingOrder(chains)) {
			RiverChain&			chain = chains[id];
			std::vector<Point>	raw;
			std::vector<double> tolerances;
			for (const int cell : chain.cells) {
				const Point centre{.x = cellCentre(grid, cell % grid.size), .y = cellCentre(grid, cell / grid.size)};
				raw.push_back(centre);
				tolerances.push_back(tolerance * (1 - (1 - kShape.steep) * smooth01(gradeAt(land, centre) / kShape.steepGrade)));
			}
			std::vector<Point> line = simplify(raw, tolerances);
			for (int pass = 0; pass < kShape.smoothing; ++pass) {
				line = chaikin(line);
			}
			line = chaikin(meandered(
				resampled(line, kShape.spacing * grid.cellSize), least, amount, meander, kMeander.row * static_cast<double>(id), land
			));
			if (chain.end == RiverEnd::Confluence) {
				snapEnd(line, rivers[static_cast<size_t>(chain.into)].line);
			}
			const std::vector<double> widths = widthsAlong(line, raw, chain, args.area, args.threshold);
			River&					  river = rivers[id];
			river.line.reserve(line.size());
			for (size_t index = 0; index < line.size(); ++index) {
				river.line.push_back({.x = line[index].x, .y = line[index].y, .width = widths[index]});
			}
			const bool joined = chain.end == RiverEnd::Confluence || chain.end == RiverEnd::Lake;
			river.area = args.area[static_cast<size_t>(chain.cells[joined ? chain.cells.size() - 2 : chain.cells.size() - 1])];
			river.chain = std::move(chain);
		}
		return rivers;
	}

} // namespace rules::map
