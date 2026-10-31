#include "Erosion.h"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <numbers>

namespace rules::map {

	void erode(const ErosionArgs& args, DrainageRouter& router) {
		const int	size = router.size();
		const auto	cells = static_cast<size_t>(size) * static_cast<size_t>(size);
		const auto& heights = args.heights;
		assert(heights.size() == cells && args.upliftRate.size() == cells && "erode: one height and one uplift per cell");
		assert(args.diffusion >= 0 && args.diffusion <= 0.25 && "erode: diffusion from 0 to 0.25 is stable");

		std::vector<double> lift(cells);
		for (size_t cell = 0; cell < cells; ++cell) {
			lift[cell] = args.timeStep * args.upliftRate[cell];
		}
		std::vector<uint8_t> isOutlet(cells);
		for (const int outlet : args.outlets) {
			isOutlet[static_cast<size_t>(outlet)] = 1;
		}
		std::vector<double> before(cells);
		const double		straight = args.timeStep * args.erodibility;
		const double		diagonal = straight / std::numbers::sqrt2;

		for (int iteration = 0; iteration < args.iterations; ++iteration) {
			// Diffusion first, so each iteration ends on stream power: smoothing a channel's banks into it
			// would leave pits along it, and after the last iteration nothing drains them. The edge has no
			// Laplacian and keeps its heights.
			if (args.diffusion > 0 && size > 2) {
				std::ranges::copy(heights, before.begin());
				for (int row = 1; row < size - 1; ++row) {
					for (int column = 1; column < size - 1; ++column) {
						const auto cell = static_cast<size_t>(row * size + column);
						if (isOutlet[cell] != 0) {
							continue;
						}
						const double height = before[cell];
						const double laplacian =
							before[cell - 1] + before[cell + 1] + before[cell - size] + before[cell + size] - 4 * height;
						heights[cell] = height + args.diffusion * laplacian;
					}
				}
			}
			router.route(heights, args.outlets);
			router.accumulate();
			const std::span<const int>	  receivers = router.receivers();
			const std::span<const double> area = router.area();
			for (const int cell : router.order()) {
				const int receiver = receivers[cell];
				if (receiver < 0) {
					continue;
				}
				const int	 step = cell - receiver;
				const bool	 square = step == 1 || step == -1 || step == size || step == -size;
				const double flow = (square ? straight : diagonal) * std::sqrt(area[cell]);
				heights[cell] = (heights[cell] + lift[cell] + flow * heights[receiver]) / (1 + flow);
			}
		}
	}

	std::vector<double> downsample(std::span<const double> values, int size) {
		assert(size % 2 == 0 && values.size() == static_cast<size_t>(size) * static_cast<size_t>(size) && "downsample: an even grid");
		const int			half = size / 2;
		std::vector<double> coarse(static_cast<size_t>(half) * static_cast<size_t>(half));
		for (int row = 0; row < half; ++row) {
			for (int column = 0; column < half; ++column) {
				const auto at = static_cast<size_t>(2 * row * size + 2 * column);
				const auto north = at + static_cast<size_t>(size);
				coarse[static_cast<size_t>(row * half + column)] = (values[at] + values[at + 1] + values[north] + values[north + 1]) / 4;
			}
		}
		return coarse;
	}

	std::vector<double> upsample(std::span<const double> values, int coarseSize) {
		assert(values.size() == static_cast<size_t>(coarseSize) * static_cast<size_t>(coarseSize) && "upsample: one value per coarse cell");
		const int size = 2 * coarseSize;
		const int last = coarseSize - 1;
		// A fine centre sits a quarter of a coarse cell off a coarse one: the coarse centres either side of
		// it, and how far between them, held at the edges.
		struct Between {
			int	   low;
			int	   high;
			double t;
		};
		const auto between = [last](int index) {
			const double along = index / 2.0 - 0.25;
			if (along <= 0) {
				return Between{.low = 0, .high = 0, .t = 0};
			}
			if (along >= last) {
				return Between{.low = last, .high = last, .t = 0};
			}
			const auto low = static_cast<int>(along);
			return Between{.low = low, .high = low + 1, .t = along - low};
		};
		std::vector<double> fine(static_cast<size_t>(size) * static_cast<size_t>(size));
		for (int row = 0; row < size; ++row) {
			const Between up = between(row);
			for (int column = 0; column < size; ++column) {
				const Between across = between(column);
				const auto	  value = [&](int coarseRow, int coarseColumn) {
					   return values[static_cast<size_t>(coarseRow * coarseSize + coarseColumn)];
				};
				const double south = value(up.low, across.low) + (value(up.low, across.high) - value(up.low, across.low)) * across.t;
				const double north = value(up.high, across.low) + (value(up.high, across.high) - value(up.high, across.low)) * across.t;
				fine[static_cast<size_t>(row * size + column)] = south + (north - south) * up.t;
			}
		}
		return fine;
	}

} // namespace rules::map
