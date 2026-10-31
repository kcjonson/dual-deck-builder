#include "MapMath.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <iterator>
#include <limits>
#include <utility>

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

	double positiveQuantile(const std::vector<double>& values, double share) {
		if (!(share > 0)) {
			return std::numeric_limits<double>::infinity();
		}
		std::vector<double> positive;
		std::ranges::copy_if(values, std::back_inserter(positive), [](double value) { return value > 0; });
		if (positive.empty()) {
			return std::numeric_limits<double>::infinity();
		}
		const double wanted = share * static_cast<double>(values.size());
		const auto	 count = static_cast<double>(positive.size());
		if (wanted >= count) {
			return std::ranges::min(positive);
		}
		return quantileAbove(std::move(positive), wanted / count);
	}

} // namespace rules::map
