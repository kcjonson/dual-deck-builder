#pragma once

#include <map>
#include <optional>
#include <span>
#include <vector>

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

	// Whole numbers spread out: their mean, least and most, and how many of each.
	struct Spread {
		std::optional<double> mean;
		int					  least{0};
		int					  most{0};
		std::map<int, int>	  counts;

		bool operator==(const Spread&) const = default;
	};

	[[nodiscard]] Spread spreadOf(std::span<const int> values);

	// `part` of `whole`, 0 of nothing.
	[[nodiscard]] inline double share(int part, int whole) {
		return whole == 0 ? 0.0 : static_cast<double>(part) / whole;
	}

	// Of the records `among` keeps, the share `counted` holds.
	template <typename Record>
	[[nodiscard]] Rate rateWhere(std::span<const Record> records, auto&& among, auto&& counted) {
		int of = 0;
		int count = 0;
		for (const Record& record : records) {
			if (among(record)) {
				++of;
				count += counted(record) ? 1 : 0;
			}
		}
		return rateOf(count, of);
	}

	// The mean of `value` over the records `keep` keeps.
	template <typename Record>
	[[nodiscard]] std::optional<double> meanWhere(std::span<const Record> records, auto&& keep, auto&& value) {
		std::vector<double> values;
		for (const Record& record : records) {
			if (keep(record)) {
				values.push_back(static_cast<double>(value(record)));
			}
		}
		return meanOf(values);
	}

} // namespace sim
