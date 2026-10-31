#pragma once

#include <algorithm>
#include <array>
#include <cstddef>
#include <map>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

namespace ai {

	template <typename Weights, std::size_t Count>
	using WeightNames = std::array<std::pair<std::string_view, double Weights::*>, Count>;

	// A policy's weights with the ones a behavior names set, failing on a name the policy doesn't take.
	template <typename Weights, std::size_t Count>
	[[nodiscard]] Weights
	weightsNamed(const std::map<std::string, double>& named, const WeightNames<Weights, Count>& names, std::string_view policy) {
		Weights weights;
		for (const auto& [name, value] : named) {
			const auto found = std::ranges::find(names, name, &std::pair<std::string_view, double Weights::*>::first);
			if (found == names.end()) {
				std::string known;
				for (const auto& [candidate, member] : names) {
					known += known.empty() ? "" : ", ";
					known += candidate;
				}
				throw std::invalid_argument("weight \"" + name + "\" isn't one the " + std::string(policy) + " takes (" + known + ")");
			}
			weights.*(found->second) = value;
		}
		return weights;
	}

} // namespace ai
