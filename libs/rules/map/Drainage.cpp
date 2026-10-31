#include "Drainage.h"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <utility>

namespace rules::map {

	namespace {

		// 1 / sqrt(2), correctly rounded.
		constexpr double kInverseRootTwo = 0.70710678118654752440;

		bool before(double level, int cell, double otherLevel, int otherCell) {
			return level < otherLevel || (level == otherLevel && cell < otherCell);
		}

	} // namespace

	DrainageRouter::DrainageRouter(int size)
		: gridSize(size) {
		assert(size >= 1 && "DrainageRouter: a grid has at least one cell");
		const auto cells = static_cast<size_t>(size) * static_cast<size_t>(size);
		receiverOf.resize(cells);
		levelOf.resize(cells);
		areaOf.resize(cells);
		downstreamFirst.resize(cells);
		reached.resize(cells);
		isOutlet.resize(cells);
		fifo.resize(cells);
		heap.reserve(cells);
	}

	void DrainageRouter::push(double level, int cell) {
		heap.push_back({.level = level, .cell = cell});
		size_t at = heap.size() - 1;
		while (at > 0) {
			const size_t parent = (at - 1) / 2;
			if (!before(heap[at].level, heap[at].cell, heap[parent].level, heap[parent].cell)) {
				break;
			}
			std::swap(heap[at], heap[parent]);
			at = parent;
		}
	}

	int DrainageRouter::pop() {
		const int top = heap.front().cell;
		heap.front() = heap.back();
		heap.pop_back();
		size_t at = 0;
		for (;;) {
			const size_t left = 2 * at + 1;
			const size_t right = left + 1;
			size_t		 least = at;
			if (left < heap.size() && before(heap[left].level, heap[left].cell, heap[least].level, heap[least].cell)) {
				least = left;
			}
			if (right < heap.size() && before(heap[right].level, heap[right].cell, heap[least].level, heap[least].cell)) {
				least = right;
			}
			if (least == at) {
				return top;
			}
			std::swap(heap[at], heap[least]);
			at = least;
		}
	}

	void DrainageRouter::route(std::span<const double> heights, std::span<const int> outlets) {
		const int size = gridSize;
		const int cells = size * size;
		assert(heights.size() == static_cast<size_t>(cells) && "DrainageRouter::route: one height per cell");
		assert(!outlets.empty() && "DrainageRouter::route: drainage needs an outlet");
		std::ranges::fill(reached, uint8_t{0});
		std::ranges::fill(isOutlet, uint8_t{0});
		outletCells.assign(outlets.begin(), outlets.end());
		heap.clear();
		for (const int outlet : outlets) {
			assert(outlet >= 0 && outlet < cells && "DrainageRouter::route: an outlet is a cell");
			assert(isOutlet[outlet] == 0 && "DrainageRouter::route: each outlet is listed once");
			assert(std::isfinite(heights[outlet]) && "DrainageRouter::route: heights are finite");
			isOutlet[outlet] = 1;
			reached[outlet] = 1;
			levelOf[outlet] = heights[outlet];
			push(heights[outlet], outlet);
		}

		size_t head = 0;
		size_t tail = 0;
		int	   settled = 0;
		while (!heap.empty() || head < tail) {
			const bool fromFifo = head < tail && (heap.empty() || levelOf[fifo[head]] <= heap.front().level);
			const int  cell = fromFifo ? fifo[head++] : pop();
			downstreamFirst[settled++] = cell;
			const double raised = levelOf[cell] + kFloodRise;
			const int	 row = cell / size;
			const int	 column = cell - row * size;
			for (int rowStep = -1; rowStep <= 1; ++rowStep) {
				const int nextRow = row + rowStep;
				if (nextRow < 0 || nextRow >= size) {
					continue;
				}
				for (int columnStep = -1; columnStep <= 1; ++columnStep) {
					const int nextColumn = column + columnStep;
					if (nextColumn < 0 || nextColumn >= size) {
						continue;
					}
					const int next = nextRow * size + nextColumn;
					if (reached[next] != 0) {
						continue;
					}
					reached[next] = 1;
					const double height = heights[next];
					assert(std::isfinite(height) && "DrainageRouter::route: heights are finite");
					if (height > raised) {
						levelOf[next] = height;
						push(height, next);
					} else {
						levelOf[next] = raised;
						fifo[tail++] = next;
					}
				}
			}
		}
		assert(settled == cells && "DrainageRouter::route: the flood reaches every cell");
		findReceivers();
	}

	void DrainageRouter::findReceivers() {
		const int size = gridSize;
		const int cells = size * size;
		for (int cell = 0; cell < cells; ++cell) {
			if (isOutlet[cell] != 0) {
				receiverOf[cell] = -1;
				continue;
			}
			const int	 row = cell / size;
			const int	 column = cell - row * size;
			const double level = levelOf[cell];
			int			 best = -1;
			double		 steepest = 0;
			for (int rowStep = -1; rowStep <= 1; ++rowStep) {
				const int nextRow = row + rowStep;
				if (nextRow < 0 || nextRow >= size) {
					continue;
				}
				for (int columnStep = -1; columnStep <= 1; ++columnStep) {
					const int nextColumn = column + columnStep;
					if ((rowStep == 0 && columnStep == 0) || nextColumn < 0 || nextColumn >= size) {
						continue;
					}
					const int	 next = nextRow * size + nextColumn;
					const double drop = level - levelOf[next];
					if (!(drop > 0)) {
						continue;
					}
					const double fall = rowStep != 0 && columnStep != 0 ? drop * kInverseRootTwo : drop;
					if (fall > steepest || (fall == steepest && next < best)) {
						steepest = fall;
						best = next;
					}
				}
			}
			assert(best >= 0 && "DrainageRouter: every cell but an outlet stands above the neighbour the flood reached it from");
			receiverOf[cell] = best;
		}
	}

	void DrainageRouter::accumulate() {
		std::ranges::fill(areaOf, 1.0);
		for (size_t index = downstreamFirst.size(); index-- > 0;) {
			const int cell = downstreamFirst[index];
			const int receiver = receiverOf[cell];
			if (receiver >= 0) {
				areaOf[receiver] += areaOf[cell];
			}
		}
	}

	Drainage DrainageRouter::drainage() const {
		return {
			.size = gridSize,
			.receivers = receiverOf,
			.levels = levelOf,
			.area = areaOf,
			.order = downstreamFirst,
			.outlets = outletCells,
		};
	}

} // namespace rules::map
