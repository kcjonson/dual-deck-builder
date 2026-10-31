#include "RandomStreams.h"

#include <algorithm>
#include <cassert>
#include <limits>

namespace rules {

	RandomStreams::RandomStreams(uint32_t seed)
		: rootSeed(seed) {}

	foundation::Rng RandomStreams::next(std::string_view stream) {
		auto counter = std::ranges::lower_bound(counters, stream, {}, &Counter::stream);
		if (counter == counters.end() || counter->stream != stream) {
			counter = counters.insert(counter, Counter{.stream = std::string(stream), .events = 0});
		}
		assert(counter->events < std::numeric_limits<uint32_t>::max() && "RandomStreams::next: a stream has had 2^32 - 1 events");
		const uint32_t event = counter->events++;
		return foundation::Rng(rootSeed).fork(stream, event);
	}

	uint32_t RandomStreams::eventsOn(std::string_view stream) const {
		const auto counter = std::ranges::lower_bound(counters, stream, {}, &Counter::stream);
		return counter != counters.end() && counter->stream == stream ? counter->events : 0;
	}

} // namespace rules
