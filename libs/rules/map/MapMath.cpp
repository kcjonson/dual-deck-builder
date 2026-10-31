#include "MapMath.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <limits>

namespace rules::map {

	double quantileAbove(std::vector<double> values, double share) {
		if (share <= 0 || values.empty()) {
			return std::numeric_limits<double>::infinity();
		}
		if (share >= 1) {
			return -std::numeric_limits<double>::infinity();
		}
		const auto count = static_cast<double>(values.size());
		const auto index = static_cast<std::ptrdiff_t>(std::clamp(std::round((1 - share) * count), 0.0, count - 1));
		std::ranges::nth_element(values, values.begin() + index);
		return values[static_cast<size_t>(index)];
	}

} // namespace rules::map
