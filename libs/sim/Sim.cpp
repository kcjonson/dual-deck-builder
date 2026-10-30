#include "Sim.h"

#include <random/Rng.h>

namespace sim {
	uint32_t firstDraw(uint32_t seed) {
		foundation::Rng rng(seed);
		return rng.nextUInt32();
	}
} // namespace sim
