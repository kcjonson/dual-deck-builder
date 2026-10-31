#pragma once

#include <vector>

// Small shaping functions the map's stages share, all plain arithmetic, so a value shaped here is the same
// on every platform and generation can branch on it.
namespace rules::map {

	// Smoothstep of a value already scaled to [0, 1], held outside it. NaN gives 0, so a bad value can only
	// switch a feature off.
	[[nodiscard]] constexpr double smooth01(double value) {
		if (!(value > 0)) {
			return 0;
		}
		if (value >= 1) {
			return 1;
		}
		return value * value * (3 - 2 * value);
	}

	// smooth01's derivative.
	[[nodiscard]] constexpr double smoothSlope(double value) {
		if (!(value > 0) || value >= 1) {
			return 0;
		}
		return 6 * value * (1 - value);
	}

	[[nodiscard]] constexpr double lerp(double from, double to, double amount) {
		return from + (to - from) * amount;
	}

	[[nodiscard]] constexpr double clamp01(double value) {
		return value < 0 ? 0 : (value > 1 ? 1 : value);
	}

	// The value `share` of `values` lie at or above: +infinity for a share of 0 or less, or no values, so
	// none do, and -infinity for 1 or more, so all do.
	[[nodiscard]] double quantileAbove(std::vector<double> values, double share);

	// The value `share` of `values` lie at or above, for a feature measured as a value above 0, so never 0
	// itself: where fewer than that share are above 0, the least of those above 0, so everything that
	// qualifies at all does. +infinity when none is above 0 or the share is 0 or less.
	[[nodiscard]] double positiveQuantile(const std::vector<double>& values, double share);

} // namespace rules::map
