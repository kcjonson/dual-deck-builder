#include "StreetGrids.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <numeric>
#include <utility>

namespace rules::map {

	namespace {

		// World units between streets, from kWideSpacing at streetGrids 0 to kNarrowSpacing at 1.
		constexpr double kWideSpacing = 14;
		constexpr double kNarrowSpacing = 8;
		// A block's odds of standing at its ruin's middle, kLeastSurvival at streetGrids 0 to kMostSurvival at 1, less
		// kSurvivalFall times the square of its share of the way to the edge.
		constexpr double kLeastSurvival = 0.3;
		constexpr double kMostSurvival = 0.9;
		constexpr double kSurvivalFall = 0.6;
		// The edge, drawn per block from 1 - kEdge / 2 to 1 + kEdge / 2 of the ruin's radius.
		constexpr double kEdge = 0.3;
		// The metro's districts: kBaseDistricts and one per kRadiusPerDistrict world units of the radius its grids
		// cover, at most kMostDistricts. The first within kCentre of the radius of the middle, the rest kInner to
		// kOuter out, evenly round, and both their bearings and their angles jittered by up to kJitter of a step.
		constexpr int	 kBaseDistricts = 2;
		constexpr double kRadiusPerDistrict = 50;
		constexpr int	 kMostDistricts = 7;
		constexpr double kCentre = 0.15;
		constexpr double kInner = 0.45;
		constexpr double kOuter = 0.8;
		constexpr double kJitter = 0.25;
		// World units a block keeps off the line between two districts.
		constexpr double kDistrictLine = 2;

		// Where a district is laid from, and its angle, degrees from 0 up to 90: a grid looks the same turned a quarter.
		struct DistrictSeed {
			Point  at;
			double angle{0};
		};

		std::vector<DistrictSeed> metroSeeds(const Ruin& ruin, foundation::Rng& rng) {
			const int				  count = std::min(kMostDistricts, kBaseDistricts + static_cast<int>(ruin.radius / kRadiusPerDistrict));
			const double			  spin = rng.nextDouble() * 360;
			const double			  gap = 360.0 / (count - 1);
			const double			  turn = rng.nextDouble() * 90;
			const double			  turnStep = 90.0 / count;
			std::vector<int>		  turns(static_cast<size_t>(count));
			std::vector<DistrictSeed> seeds;
			std::iota(turns.begin(), turns.end(), 0);
			rng.shuffle(turns);
			for (int index = 0; index < count; ++index) {
				Point  towards;
				double out = 0;
				if (index == 0) {
					towards = unitVector(rng.nextDouble() * 360);
					out = rng.nextDouble() * kCentre * ruin.radius;
				} else {
					towards = unitVector(spin + gap * (index - 1 + (rng.nextDouble() - 0.5) * 2 * kJitter));
					out = (kInner + (kOuter - kInner) * rng.nextDouble()) * ruin.radius;
				}
				const double angle = turn + turnStep * (turns[static_cast<size_t>(index)] + (rng.nextDouble() - 0.5) * 2 * kJitter);
				const double wrapped = angle - 90 * std::floor(angle / 90);
				seeds.push_back({.at = {.x = ruin.at.x + towards.x * out, .y = ruin.at.y + towards.y * out}, .angle = wrapped});
			}
			return seeds;
		}

		double distance(Point a, Point b) {
			return std::sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
		}

		// Whether `point` is nearer district `index`'s seed than any other's by kDistrictLine or more.
		bool ownedBy(std::span<const DistrictSeed> seeds, size_t index, Point point) {
			if (seeds.size() == 1) {
				return true;
			}
			const double own = distance(seeds[index].at, point) + kDistrictLine;
			for (size_t other = 0; other < seeds.size(); ++other) {
				if (other != index && distance(seeds[other].at, point) < own) {
					return false;
				}
			}
			return true;
		}

		// The district's blocks, row by row from its south-west, as the grid sees them: 1 where a line runs through.
		struct Streets {
			int					 side{0};
			std::vector<uint8_t> marked;

			// Every block the segment runs through, walked block by block (Amanatides and Woo), so a line that clips a
			// block's corner still makes it street. In block units, the grid's corner at 0; anything off it is left alone.
			void mark(double fromColumn, double fromRow, double toColumn, double toRow) {
				constexpr double kNever = std::numeric_limits<double>::infinity();
				auto			 column = static_cast<int>(std::floor(fromColumn));
				auto			 row = static_cast<int>(std::floor(fromRow));
				const auto		 lastColumn = static_cast<int>(std::floor(toColumn));
				const auto		 lastRow = static_cast<int>(std::floor(toRow));
				const double	 across = toColumn - fromColumn;
				const double	 rise = toRow - fromRow;
				const int		 stepColumn = across > 0 ? 1 : -1;
				const int		 stepRow = rise > 0 ? 1 : -1;
				// How far along the segment, 0 to 1, each block crossing takes, and where the next one is.
				const double perColumn = across == 0 ? kNever : stepColumn / across;
				const double perRow = rise == 0 ? kNever : stepRow / rise;
				double		 nextColumn = across == 0 ? kNever : (across > 0 ? column + 1 - fromColumn : fromColumn - column) * perColumn;
				double		 nextRow = rise == 0 ? kNever : (rise > 0 ? row + 1 - fromRow : fromRow - row) * perRow;
				const int	 crossings = std::abs(lastColumn - column) + std::abs(lastRow - row);
				for (int crossing = 0;; ++crossing) {
					if (column >= 0 && row >= 0 && column < side && row < side) {
						marked[static_cast<size_t>(row * side + column)] = 1;
					}
					if (crossing == crossings) {
						break;
					}
					if (nextColumn < nextRow) {
						column += stepColumn;
						nextColumn += perColumn;
					} else {
						row += stepRow;
						nextRow += perRow;
					}
				}
			}
		};

		// Whether a line's box comes within reach of any block the ruin could keep: its farthest edge, and a block's
		// half diagonal past that.
		bool reaches(std::span<const Point> line, const Ruin& ruin, double spacing) {
			if (line.empty()) {
				return false;
			}
			const double reach = ruin.radius * (1 + kEdge / 2) + spacing;
			const auto [left, right] = std::ranges::minmax(line, {}, &Point::x);
			const auto [bottom, top] = std::ranges::minmax(line, {}, &Point::y);
			return right.x > ruin.at.x - reach && left.x < ruin.at.x + reach && top.y > ruin.at.y - reach && bottom.y < ruin.at.y + reach;
		}

		struct DistrictArgs {
			const Ruin&								ruin;
			std::span<const DistrictSeed>			seeds;
			size_t									index{0};
			double									spacing{0};
			double									survival{0};
			std::span<const std::span<const Point>> near;
			const Ground&							ground;
			foundation::Rng							rng;
		};

		bool clear(const Ground& ground, Point point) {
			return ground.obstacle(point.x, point.y) == Obstacle::None && ground.waterAt(point.x, point.y) == WaterKind::None;
		}

		StreetDistrict layDistrict(DistrictArgs args) {
			const Ruin&			ruin = args.ruin;
			const DistrictSeed& seed = args.seeds[args.index];
			const double		spacing = args.spacing;
			const Point			along = unitVector(seed.angle);
			// The cross streets run along (vx, vy).
			const double vx = -along.y;
			const double vy = along.x;
			const double reach = ruin.radius * (1 + kEdge / 2);
			const int	 span = static_cast<int>(std::floor(reach / spacing)) + 2;
			Streets		 streets{.side = 2 * span, .marked = std::vector<uint8_t>(static_cast<size_t>(4 * span * span))};
			const auto	 column = [&](Point point) {
				  return ((point.x - seed.at.x) * along.x + (point.y - seed.at.y) * along.y) / spacing + span;
			};
			const auto row = [&](Point point) {
				return ((point.x - seed.at.x) * vx + (point.y - seed.at.y) * vy) / spacing + span;
			};
			for (const std::span<const Point> line : args.near) {
				for (size_t point = 1; point < line.size(); ++point) {
					streets.mark(column(line[point - 1]), row(line[point - 1]), column(line[point]), row(line[point]));
				}
			}
			const double								   half = spacing / 2;
			constexpr std::array<std::array<double, 2>, 4> kCorners{{{-1, -1}, {1, -1}, {1, 1}, {-1, 1}}};
			StreetDistrict								   district{
												.place = ruin.place,
												.kind = ruin.kind,
												.corner = seed.at,
												.ux = along.x,
												.uy = along.y,
												.spacing = spacing,
												.blocks = {},
												.rubble = {},
			};
			for (int blockRow = 0; blockRow < streets.side; ++blockRow) {
				for (int blockColumn = 0; blockColumn < streets.side; ++blockColumn) {
					// Every block takes its two draws, so one block's fate never moves another's.
					const double edgeDraw = args.rng.nextDouble();
					const double standDraw = args.rng.nextDouble();
					if (streets.marked[static_cast<size_t>(blockRow * streets.side + blockColumn)] == 1) {
						continue;
					}
					const double acrossGrid = (blockColumn - span + 0.5) * spacing;
					const double upGrid = (blockRow - span + 0.5) * spacing;
					const Point	 centre{
						 .x = seed.at.x + along.x * acrossGrid + vx * upGrid,
						 .y = seed.at.y + along.y * acrossGrid + vy * upGrid,
					 };
					const double out = distance(centre, ruin.at) / ruin.radius;
					if (out > 1 + kEdge * (edgeDraw - 0.5)) {
						continue;
					}
					bool whole = clear(args.ground, centre) && !args.ground.rivers().near(centre.x, centre.y, half);
					for (const auto& [a, b] : kCorners) {
						const Point corner{
							.x = centre.x + (along.x * a + vx * b) * half,
							.y = centre.y + (along.y * a + vy * b) * half,
						};
						whole = whole && clear(args.ground, corner) && ownedBy(args.seeds, args.index, corner);
					}
					if (!whole) {
						continue;
					}
					const double odds = args.survival * (1 - kSurvivalFall * out * out);
					(standDraw < odds ? district.blocks : district.rubble).push_back(centre);
				}
			}
			return district;
		}

	} // namespace

	std::vector<Ruin> ruinsOf(const Places& places) {
		std::vector<Ruin> ruins{{.place = 0, .kind = DistrictKind::Metro, .at = {}, .radius = places.metroRadius()}};
		for (const Settlement& town : places.towns()) {
			ruins.push_back({.place = town.id, .kind = DistrictKind::Town, .at = {.x = town.x, .y = town.y}, .radius = town.radius});
		}
		for (const Settlement& village : places.villages()) {
			ruins.push_back(
				{.place = village.id, .kind = DistrictKind::Village, .at = {.x = village.x, .y = village.y}, .radius = village.radius}
			);
		}
		return ruins;
	}

	std::vector<StreetDistrict> streetGrids(const StreetGridArgs& args) {
		std::vector<StreetDistrict> districts;
		if (!(args.cover > 0)) {
			return districts;
		}
		const double spacing = kWideSpacing + (kNarrowSpacing - kWideSpacing) * args.built;
		const double survival = kLeastSurvival + (kMostSurvival - kLeastSurvival) * args.built;
		for (const Ruin& placed : args.ruins) {
			const Ruin		ruin{.place = placed.place, .kind = placed.kind, .at = placed.at, .radius = placed.radius * args.cover};
			foundation::Rng own = args.stream.fork("ruin", static_cast<uint32_t>(ruin.place));
			std::vector<DistrictSeed> seeds;
			if (ruin.kind == DistrictKind::Metro) {
				seeds = metroSeeds(ruin, own);
			} else {
				seeds.push_back({.at = ruin.at, .angle = own.nextDouble() * 90});
			}
			std::vector<std::span<const Point>> near;
			for (const std::span<const Point> line : args.lines) {
				if (reaches(line, ruin, spacing)) {
					near.push_back(line);
				}
			}
			for (size_t index = 0; index < seeds.size(); ++index) {
				StreetDistrict district = layDistrict({
					.ruin = ruin,
					.seeds = seeds,
					.index = index,
					.spacing = spacing,
					.survival = survival,
					.near = near,
					.ground = args.ground,
					.rng = own.fork("district", static_cast<uint32_t>(index)),
				});
				if (!district.blocks.empty() || !district.rubble.empty()) {
					districts.push_back(std::move(district));
				}
			}
		}
		return districts;
	}

} // namespace rules::map
