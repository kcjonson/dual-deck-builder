#include "Measures.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace sim {

	namespace {

		// z for a two-sided 90% interval.
		constexpr double kZ90 = 1.6448536269514722;

	} // namespace

	Rate rateOf(int count, int of) {
		if (count < 0 || count > of) {
			throw std::invalid_argument("rateOf: a count is from 0 to what it's a share of");
		}
		if (of == 0) {
			return Rate{.count = 0, .of = 0};
		}
		const double share = static_cast<double>(count) / of;
		const double z2 = kZ90 * kZ90;
		const double centre = (share + z2 / (2.0 * of)) / (1.0 + z2 / of);
		const double reach = (kZ90 / (1.0 + z2 / of)) * std::sqrt(share * (1.0 - share) / of + z2 / (4.0 * of * of));
		return Rate{
			.count = count,
			.of = of,
			.rate = share,
			.low = count == 0 ? 0.0 : centre - reach,
			.high = count == of ? 1.0 : centre + reach,
		};
	}

	std::optional<double> meanOf(std::span<const double> values) {
		if (values.empty()) {
			return std::nullopt;
		}
		double sum = 0;
		for (const double value : values) {
			sum += value;
		}
		return sum / static_cast<double>(values.size());
	}

	Spread spreadOf(std::span<const int> values) {
		Spread spread;
		if (values.empty()) {
			return spread;
		}
		double sum = 0;
		spread.least = values.front();
		spread.most = values.front();
		for (const int value : values) {
			sum += value;
			spread.least = std::min(spread.least, value);
			spread.most = std::max(spread.most, value);
			++spread.counts[value];
		}
		spread.mean = sum / static_cast<double>(values.size());
		return spread;
	}

} // namespace sim
