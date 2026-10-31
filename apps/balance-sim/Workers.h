#pragma once

#include <threading/TaskPool.h>

#include <cstddef>
#include <functional>
#include <stdexcept>

namespace sim {

	// Items [0, items) over `workers` threads, the caller's among them, by salal's TaskPool, an item a slab. Each item
	// writes only its own slot, so what comes out is the same whatever the workers.
	inline void inParallel(size_t items, int workers, const std::function<void(size_t, size_t)>& play) {
		if (workers < 1) {
			throw std::invalid_argument("the balance sim takes one worker or more");
		}
		if (workers == 1) {
			play(0, items);
			return;
		}
		foundation::TaskPool pool(static_cast<unsigned>(workers - 1));
		pool.parallelFor(0, items, 1, play);
	}

} // namespace sim
