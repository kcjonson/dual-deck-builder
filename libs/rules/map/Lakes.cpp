#include "Lakes.h"

#include "Land.h"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <limits>
#include <optional>
#include <utility>

namespace rules::map {

	namespace {

		// Reservoirs: dams on river cells whose area is `areaMin` to `areaMax` times the stream threshold, rivers
		// worth damming short of the main stems, in a valley at least `valley` world units deep across the
		// river, `spacing` of the radius apart and inside `outer` of it. Each floods `cellsMin` to `cellsMax`
		// cells, to a size drawn between them, `depthMin` to `depthMax` world units deep at the dam, behind a
		// wall `wall` cells each side of the dam cell. Candidates are tried in a shuffled order, up to `tries`
		// floods' worth.
		struct Reservoirs {
			double areaMin = 3;
			double areaMax = 80;
			double valley = 0.8;
			double spacing = 0.25;
			double outer = 0.88;
			int	   cellsMin = 30;
			int	   cellsMax = 220;
			double depthMin = 0.5;
			double depthMax = 30;
			int	   wall = 3;
			int	   tries = 120;
		};

		// Natural lakes: the land's pits, cells whose water stands more than `wet` world units above them,
		// joined side by side, at least `cells` of them and `depth` deep somewhere, in country whose moisture
		// before the rivers averages `moisture` or more.
		struct NaturalLakes {
			double wet = 0.01;
			double depth = 0.25;
			int	   cells = 4;
			double moisture = 0.55;
		};

		constexpr Reservoirs   kReservoirs;
		constexpr NaturalLakes kNaturalLakes;

		struct Step {
			int column;
			int row;
		};

		constexpr std::array<Step, 8> kNeighbours{{{1, 0}, {1, 1}, {0, 1}, {-1, 1}, {-1, 0}, {-1, -1}, {0, -1}, {1, -1}}};
		constexpr std::array<Step, 4> kSides{{{1, 0}, {0, 1}, {-1, 0}, {0, -1}}};

		template <size_t Count, typename Visit>
		void forEachStep(const std::array<Step, Count>& steps, int size, int cell, Visit&& visit) {
			const int row = cell / size;
			const int column = cell - row * size;
			for (const Step step : steps) {
				const int nextColumn = column + step.column;
				const int nextRow = row + step.row;
				if (nextColumn >= 0 && nextRow >= 0 && nextColumn < size && nextRow < size) {
					visit(nextRow * size + nextColumn);
				}
			}
		}

		// Marks the cells round a lake blocked, so the lakes made after it keep a cell of land from it.
		void blockAround(int size, const std::vector<int>& members, std::vector<uint8_t>& blocked) {
			for (const int cell : members) {
				forEachStep(kNeighbours, size, cell, [&](int next) { blocked[static_cast<size_t>(next)] = 1; });
			}
		}

		void addLake(
			const LandGrid&			grid,
			const std::vector<int>& members,
			LakeKind				kind,
			double					level,
			std::span<const double> levels,
			std::optional<Dam>		dam,
			LakeCells&				lakes
		) {
			const auto id = static_cast<int>(lakes.lakes.size());
			double	   sumX = 0;
			double	   sumY = 0;
			for (const int cell : members) {
				sumX += cellCentre(grid, cell % grid.size);
				sumY += cellCentre(grid, cell / grid.size);
				lakes.lakeOf[static_cast<size_t>(cell)] = id;
				lakes.level[static_cast<size_t>(cell)] = levels.empty() ? level : levels[static_cast<size_t>(cell)];
			}
			const auto count = static_cast<double>(members.size());
			lakes.lakes.push_back({
				.kind = kind,
				.level = level,
				.cells = static_cast<int>(members.size()),
				.x = sumX / count,
				.y = sumY / count,
				.dam = dam,
			});
		}

		// Each cell's donors, the cells that drain to it, packed end to end.
		struct Donors {
			std::vector<int> starts;
			std::vector<int> cells;
		};

		Donors donorsOf(std::span<const int> receivers) {
			const size_t cells = receivers.size();
			Donors		 donors{.starts = std::vector<int>(cells + 1), .cells = {}};
			for (const int receiver : receivers) {
				if (receiver >= 0) {
					donors.starts[static_cast<size_t>(receiver) + 1] += 1;
				}
			}
			for (size_t cell = 0; cell < cells; ++cell) {
				donors.starts[cell + 1] += donors.starts[cell];
			}
			donors.cells.resize(static_cast<size_t>(donors.starts[cells]));
			std::vector<int> cursor(donors.starts.begin(), donors.starts.end() - 1);
			for (size_t cell = 0; cell < cells; ++cell) {
				const int receiver = receivers[cell];
				if (receiver >= 0) {
					donors.cells[static_cast<size_t>(cursor[static_cast<size_t>(receiver)]++)] = static_cast<int>(cell);
				}
			}
			return donors;
		}

		// Floods a dam's valley, reusing its buffers. The dam is a wall across the river through the dam cell,
		// kReservoirs.wall cells each side, square to the outflow: water on its line or above it stays, and the
		// ground below it stays dry. The lake at a level is the cells of the dam's catchment lower than it,
		// joined to the dam side by side, or corner to corner where the four cells round the corner average
		// under the level, so the drawn shore joins them too. It's too big when a cell joined to it that way is
		// lower than the level, outside it, and not held back by the wall, since the water would run over the
		// saddle there, or when one of its cells drains to the dam other than through it.
		class Flood {
		  public:
			Flood(
				int							size,
				std::span<const double>		elevation,
				std::span<const int>		receivers,
				const Donors&				donors,
				const std::vector<uint8_t>& blocked,
				const std::vector<int>&		lakeOf
			)
				: size(size),
				  elevation(elevation),
				  receivers(receivers),
				  donors(donors),
				  blocked(blocked),
				  lakeOf(lakeOf),
				  catchment(elevation.size()),
				  flooded(elevation.size()) {}

			// The highest level, up to `top`, whose lake stays within `target` cells, clear of blocked cells and
			// other lakes, and below every saddle round it, to a hundred-thousandth of elevation, by halving; the
			// dam's own height when even the least water is too much.
			double highestLevel(int newDam, double top, int target) {
				takeDam(newDam, top);
				double low = elevation[static_cast<size_t>(dam)];
				double high = top;
				if (count(high, static_cast<size_t>(target))) {
					return high;
				}
				for (int step = 0; step < 24 && high - low > 1e-5; ++step) {
					const double middle = 0.5 * (low + high);
					if (count(middle, static_cast<size_t>(target))) {
						low = middle;
					} else {
						high = middle;
					}
				}
				return low;
			}

			// The lake's cells at `level`, dam first, or nothing when it's too big, for the dam highestLevel took.
			std::optional<std::vector<int>> cellsAt(double level) {
				if (!count(level, std::numeric_limits<size_t>::max())) {
					return std::nullopt;
				}
				return found;
			}

		  private:
			int							size;
			std::span<const double>		elevation;
			std::span<const int>		receivers;
			const Donors&				donors;
			const std::vector<uint8_t>& blocked;
			const std::vector<int>&		lakeOf;
			// The dam whose catchment, below the highest level tried, a cell is in, plus one.
			std::vector<int> catchment;
			// The round a cell was last flooded in.
			std::vector<int> flooded;
			int				 round = 0;
			std::vector<int> pending;
			std::vector<int> found;
			int				 dam = -1;
			int				 damColumn = 0;
			int				 damRow = 0;
			int				 towardColumn = 0;
			int				 towardRow = 0;
			int				 wallReach = 0;

			[[nodiscard]] double height(int cell) const { return elevation[static_cast<size_t>(cell)]; }

			// Sets the buffers up for `newDam`: its wall, and every cell that drains to it through cells lower than `top`.
			void takeDam(int newDam, double top) {
				dam = newDam;
				damRow = dam / size;
				damColumn = dam - damRow * size;
				const int outflow = receivers[static_cast<size_t>(dam)];
				towardColumn = outflow % size - damColumn;
				towardRow = outflow / size - damRow;
				// Along a diagonal wall the cells step two apart across.
				wallReach = towardColumn != 0 && towardRow != 0 ? 2 * kReservoirs.wall : kReservoirs.wall;
				const int mark = dam + 1;
				pending.assign(1, dam);
				catchment[static_cast<size_t>(dam)] = mark;
				while (!pending.empty()) {
					const int cell = pending.back();
					pending.pop_back();
					for (int at = donors.starts[static_cast<size_t>(cell)]; at < donors.starts[static_cast<size_t>(cell) + 1]; ++at) {
						const int donor = donors.cells[static_cast<size_t>(at)];
						if (height(donor) < top && catchment[static_cast<size_t>(donor)] != mark) {
							catchment[static_cast<size_t>(donor)] = mark;
							pending.push_back(donor);
						}
					}
				}
			}

			// Steps downstream of the wall's line; less than 0 upstream of it.
			[[nodiscard]] int ahead(int column, int row) const { return (column - damColumn) * towardColumn + (row - damRow) * towardRow; }

			// Whether the cell lies within the wall's reach along its line, either side of the dam.
			[[nodiscard]] bool alongWall(int column, int row) const {
				return std::abs((row - damRow) * towardColumn - (column - damColumn) * towardRow) <= wallReach;
			}

			// Whether water at `level` runs between neighbours: always side by side, and corner to corner where
			// the corner is under it.
			[[nodiscard]] bool joined(int column, int row, int nextColumn, int nextRow, double level) const {
				if (column == nextColumn || row == nextRow) {
					return true;
				}
				const double corner = height(row * size + column) + height(nextRow * size + nextColumn) + height(row * size + nextColumn) +
									  height(nextRow * size + column);
				return 0.25 * corner < level - kLakeShore;
			}

			// Whether the lake at `level` holds and covers `limit` cells or fewer, leaving its cells in `found`.
			bool count(double level, size_t limit) {
				found.clear();
				if (!(height(dam) < level)) {
					return true;
				}
				round += 1;
				const int mark = dam + 1;
				pending.assign(1, dam);
				flooded[static_cast<size_t>(dam)] = round;
				while (!pending.empty()) {
					const int cell = pending.back();
					pending.pop_back();
					if (blocked[static_cast<size_t>(cell)] != 0 || lakeOf[static_cast<size_t>(cell)] >= 0) {
						return false;
					}
					found.push_back(cell);
					if (found.size() > limit) {
						return false;
					}
					const int row = cell / size;
					const int column = cell - row * size;
					for (const Step step : kNeighbours) {
						const int nextColumn = column + step.column;
						const int nextRow = row + step.row;
						if (nextColumn < 0 || nextRow < 0 || nextColumn >= size || nextRow >= size) {
							continue;
						}
						const int next = nextRow * size + nextColumn;
						if (flooded[static_cast<size_t>(next)] == round || catchment[static_cast<size_t>(next)] != mark ||
							!(height(next) < level) || !joined(column, row, nextColumn, nextRow, level) ||
							(ahead(nextColumn, nextRow) > 0 && alongWall(nextColumn, nextRow))) {
							continue;
						}
						flooded[static_cast<size_t>(next)] = round;
						pending.push_back(next);
					}
				}
				for (const int cell : found) {
					const int receiver = receivers[static_cast<size_t>(cell)];
					if (cell != dam && (receiver < 0 || flooded[static_cast<size_t>(receiver)] != round)) {
						return false;
					}
					const int row = cell / size;
					const int column = cell - row * size;
					// From the wall's line or above it, within its reach, the wall holds back what's on its line or
					// below it; round its end it doesn't.
					const bool behindWall = ahead(column, row) <= 0 && alongWall(column, row);
					for (const Step step : kNeighbours) {
						const int nextColumn = column + step.column;
						const int nextRow = row + step.row;
						if (nextColumn < 0 || nextRow < 0 || nextColumn >= size || nextRow >= size) {
							continue;
						}
						const int next = nextRow * size + nextColumn;
						if (flooded[static_cast<size_t>(next)] == round || !(height(next) < level) ||
							!joined(column, row, nextColumn, nextRow, level)) {
							continue;
						}
						if (behindWall && ahead(nextColumn, nextRow) >= 0 && alongWall(nextColumn, nextRow)) {
							continue;
						}
						return false;
					}
				}
				return true;
			}
		};

	} // namespace

	LakeCells emptyLakeCells(size_t cells) {
		return {.lakeOf = std::vector<int>(cells, -1), .level = std::vector<double>(cells), .lakes = {}};
	}

	void naturalLakes(const NaturalLakeArgs& args, std::vector<uint8_t>& blocked, LakeCells& lakes) {
		const int	 size = args.grid.size;
		const int	 cells = args.grid.cells();
		const double wet = kNaturalLakes.wet / kRelief;
		const double deep = kNaturalLakes.depth / kRelief;
		const auto	 standing = [&](int cell) {
			  return args.levels[static_cast<size_t>(cell)] - args.elevation[static_cast<size_t>(cell)];
		};
		std::vector<uint8_t> seen(static_cast<size_t>(cells));
		std::vector<int>	 members;
		for (int first = 0; first < cells; ++first) {
			if (seen[static_cast<size_t>(first)] != 0 || !(standing(first) > wet)) {
				continue;
			}
			members.assign(1, first);
			seen[static_cast<size_t>(first)] = 1;
			bool   touchesBlocked = false;
			double deepest = 0;
			double moisture = 0;
			for (size_t at = 0; at < members.size(); ++at) {
				const int cell = members[at];
				touchesBlocked = touchesBlocked || blocked[static_cast<size_t>(cell)] != 0;
				deepest = std::max(deepest, standing(cell));
				moisture += args.moisture[static_cast<size_t>(cell)];
				forEachStep(kSides, size, cell, [&](int next) {
					if (seen[static_cast<size_t>(next)] == 0 && standing(next) > wet) {
						seen[static_cast<size_t>(next)] = 1;
						members.push_back(next);
					}
				});
			}
			const auto count = static_cast<double>(members.size());
			if (touchesBlocked || members.size() < static_cast<size_t>(kNaturalLakes.cells) || deepest < deep ||
				moisture < kNaturalLakes.moisture * count) {
				continue;
			}
			double level = 0;
			for (const int cell : members) {
				level = std::max(level, args.levels[static_cast<size_t>(cell)]);
			}
			addLake(args.grid, members, LakeKind::Natural, level, args.levels, std::nullopt, lakes);
			blockAround(size, members, blocked);
		}
	}

	void placeReservoirs(const ReservoirArgs& args, foundation::Rng& rng, std::vector<uint8_t>& blocked, LakeCells& lakes) {
		if (args.count <= 0) {
			return;
		}
		const LandGrid&	 grid = args.grid;
		const int		 size = grid.size;
		const double	 innerSquared = args.inner * args.inner;
		const double	 outer = kReservoirs.outer * args.radius;
		const double	 valley = kReservoirs.valley / kRelief;
		std::vector<int> candidates;
		for (int row = 1; row < size - 1; ++row) {
			const double y = cellCentre(grid, row);
			for (int column = 1; column < size - 1; ++column) {
				const int	 cell = row * size + column;
				const auto	 at = static_cast<size_t>(cell);
				const double area = args.area[at];
				if (area < kReservoirs.areaMin * args.threshold || area > kReservoirs.areaMax * args.threshold) {
					continue;
				}
				if (blocked[at] != 0 || lakes.lakeOf[at] >= 0 || args.receivers[at] < 0) {
					continue;
				}
				const double x = cellCentre(grid, column);
				const double distanceSquared = x * x + y * y;
				if (distanceSquared >= innerSquared && distanceSquared <= outer * outer &&
					valleyDepth(args.elevation, size, cell) >= valley) {
					candidates.push_back(cell);
				}
			}
		}
		if (candidates.empty()) {
			return;
		}
		rng.shuffle(candidates);
		const double						   spacingSquared = kReservoirs.spacing * args.radius * kReservoirs.spacing * args.radius;
		const Donors						   donors = donorsOf(args.receivers);
		Flood								   flood(size, args.elevation, args.receivers, donors, blocked, lakes.lakeOf);
		std::vector<std::pair<double, double>> dams;
		int									   tries = 0;
		for (const int dam : candidates) {
			if (static_cast<int>(dams.size()) >= args.count || tries >= kReservoirs.tries) {
				break;
			}
			const double x = cellCentre(grid, dam % size);
			const double y = cellCentre(grid, dam / size);
			const bool	 crowded = std::ranges::any_of(dams, [&](const auto& other) {
				  return (other.first - x) * (other.first - x) + (other.second - y) * (other.second - y) < spacingSquared;
			  });
			if (crowded) {
				continue;
			}
			tries += 1;
			const auto target =
				static_cast<int>(std::lround(kReservoirs.cellsMin + (kReservoirs.cellsMax - kReservoirs.cellsMin) * rng.nextDouble()));
			const double floor = args.elevation[static_cast<size_t>(dam)];
			const double level = flood.highestLevel(dam, floor + kReservoirs.depthMax / kRelief, target);
			if (level - floor < kReservoirs.depthMin / kRelief) {
				continue;
			}
			const std::optional<std::vector<int>> members = flood.cellsAt(level);
			if (!members || members->size() < static_cast<size_t>(kReservoirs.cellsMin)) {
				continue;
			}
			const int	 outflow = args.receivers[static_cast<size_t>(dam)];
			const double towardX = cellCentre(grid, outflow % size) - x;
			const double towardY = cellCentre(grid, outflow / size) - y;
			const double length = std::sqrt(towardX * towardX + towardY * towardY);
			addLake(
				grid,
				*members,
				LakeKind::Reservoir,
				level,
				{},
				Dam{.x = x, .y = y, .towardX = towardX / length, .towardY = towardY / length},
				lakes
			);
			blockAround(size, *members, blocked);
			dams.emplace_back(x, y);
		}
	}

	double valleyDepth(std::span<const double> elevation, int size, int cell, int reach) {
		const int row = cell / size;
		const int column = cell - row * size;
		if (row < reach || column < reach || row >= size - reach || column >= size - reach) {
			return 0;
		}
		double					 deepest = 0;
		const std::array<int, 4> steps{reach, reach * size, reach * (size + 1), reach * (size - 1)};
		const double			 here = elevation[static_cast<size_t>(cell)];
		for (const int step : steps) {
			const double ahead = elevation[static_cast<size_t>(cell + step)];
			const double behind = elevation[static_cast<size_t>(cell - step)];
			deepest = std::max(deepest, std::min(ahead, behind) - here);
		}
		return deepest;
	}

	std::vector<double> lakeDepthField(const LandGrid& grid, std::span<const double> elevation, const LakeCells& lakes) {
		const int			size = grid.size;
		std::vector<double> depth(elevation.size(), -1);
		for (size_t cell = 0; cell < depth.size(); ++cell) {
			if (lakes.lakeOf[cell] >= 0) {
				depth[cell] = std::max(lakes.level[cell] - elevation[cell], kLakeShore);
			}
		}
		for (int cell = 0; cell < grid.cells(); ++cell) {
			if (lakes.lakeOf[static_cast<size_t>(cell)] < 0) {
				continue;
			}
			const double surface = lakes.level[static_cast<size_t>(cell)];
			forEachStep(kNeighbours, size, cell, [&](int next) {
				const auto at = static_cast<size_t>(next);
				if (lakes.lakeOf[at] < 0) {
					depth[at] = std::max(depth[at], std::min(surface - elevation[at], -kLakeShore));
				}
			});
		}
		return depth;
	}

} // namespace rules::map
