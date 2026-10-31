#include "StopRules.h"

#include <bit>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <optional>
#include <tuple>
#include <utility>

namespace rules::map {

	namespace {

		// The stops behind the leg, then the pattern's, a fight as an ambush and the rest as wrecks.
		std::vector<StopType> withBehind(std::span<const StopType> behind, const std::vector<bool>& pattern) {
			std::vector<StopType> types(behind.begin(), behind.end());
			for (const bool fight : pattern) {
				types.push_back(fight ? StopType::Ambush : StopType::Wreck);
			}
			return types;
		}

		std::vector<bool> spreadPattern(int count, int fights) {
			std::vector<bool> pattern(static_cast<size_t>(count));
			for (int fight = 0; fight < fights; ++fight) {
				pattern[static_cast<size_t>(fight * count / fights)] = true;
			}
			return pattern;
		}

		// Every pattern of `fights` in `count` that keeps the rules, scored. Bit count - 1 - i is stop i, so counting
		// down meets the patterns with their fights earliest first, and a strict improvement keeps the first on a tie.
		std::optional<std::vector<bool>> bestPattern(const ArrangeArgs& args, int fights) {
			using Score = std::tuple<int, int, double>;
			std::optional<std::vector<bool>> best;
			Score							 bestScore;
			const int						 count = args.count;
			for (uint32_t mask = (uint32_t{1} << count) - 1;; --mask) {
				if (std::popcount(mask) == fights) {
					std::vector<bool> pattern(static_cast<size_t>(count));
					for (int stop = 0; stop < count; ++stop) {
						pattern[static_cast<size_t>(stop)] = ((mask >> (count - 1 - stop)) & 1U) != 0;
					}
					if (keepsRules(withBehind(args.behind, pattern))) {
						int trailing = 0;
						for (int stop = count - 1; stop >= 0 && pattern[static_cast<size_t>(stop)]; --stop) {
							trailing += 1;
						}
						double spread = 0;
						int	   seen = 0;
						for (int stop = 0; stop < count; ++stop) {
							if (pattern[static_cast<size_t>(stop)]) {
								spread += std::abs(stop - ((seen + 0.5) * count / fights - 0.5));
								seen += 1;
							}
						}
						const bool	endsOnFight = args.shared && count > fights && pattern.back();
						const Score score{endsOnFight ? 1 : 0, trailing, spread};
						if (!best || score < bestScore) {
							best = std::move(pattern);
							bestScore = score;
						}
					}
				}
				if (mask == 0) {
					break;
				}
			}
			return best;
		}

	} // namespace

	bool keepsRules(std::span<const StopType> types) {
		for (size_t index = 2; index < types.size(); ++index) {
			if (!isCalm(types[index]) && !isCalm(types[index - 1]) && !isCalm(types[index - 2])) {
				return false;
			}
		}
		return true;
	}

	std::vector<bool> arrange(const ArrangeArgs& args) {
		assert(args.count >= 0 && args.fights >= 0 && args.behind.size() <= 2 && "arrange: a leg's stops after at most two");
		if (args.count == 0) {
			return {};
		}
		for (int want = args.fights < args.count ? args.fights : args.count; want >= 0; --want) {
			const std::optional<std::vector<bool>> pattern =
				args.count > kArrangeLimit ? std::optional(spreadPattern(args.count, want)) : bestPattern(args, want);
			if (pattern && keepsRules(withBehind(args.behind, *pattern))) {
				return *pattern;
			}
		}
		return std::vector<bool>(static_cast<size_t>(args.count));
	}

} // namespace rules::map
