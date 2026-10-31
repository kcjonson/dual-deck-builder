#include "Rules.h"

#include <random/Rng.h>

namespace rules {
	uint32_t firstDraw(uint32_t seed) {
		foundation::Rng rng(seed);
		return rng.nextUInt32();
	}
} // namespace rules
