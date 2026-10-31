#pragma once

#include <optional>
#include <span>

namespace sim {

	// The sim's measures as plain numbers (Balance Simulation, Measures). Every rate carries its count and a 90%
	// interval, so a 3-point move on 100 runs isn't read as a change.

	// A share of something counted, with what it's a share of. With nothing to count, the rate and its interval are none.
	struct Rate {
		int					  count{0};
		int					  of{0};
		std::optional<double> rate;
		// The Wilson score interval at 90%.
		std::optional<double> low;
		std::optional<double> high;

		bool operator==(const Rate&) const = default;
	};

	// `count` out of `of`, with its interval. Exact at the ends, where the arithmetic lands a hair inside them.
	[[nodiscard]] Rate rateOf(int count, int of);

	// The mean, or none with nothing to average.
	[[nodiscard]] std::optional<double> meanOf(std::span<const double> values);

} // namespace sim
