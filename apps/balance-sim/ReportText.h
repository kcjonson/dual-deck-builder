#pragma once

#include "Measures.h"

#include <nlohmann/json.hpp>

#include <optional>
#include <string>

namespace sim {

	// How the reports write a measure, in the JSON and in the readable summary.

	[[nodiscard]] nlohmann::ordered_json numberJson(const std::optional<double>& value);
	[[nodiscard]] nlohmann::ordered_json rateJson(const Rate& rate);

	// `95%`, or `-` for none.
	[[nodiscard]] std::string percent(const std::optional<double>& value);
	[[nodiscard]] std::string percent(const Rate& rate);

	// `95% [93-96]`, the 90% interval in brackets.
	[[nodiscard]] std::string interval(const Rate& rate);

	// To `digits` places, or `-` for none.
	[[nodiscard]] std::string fixed(const std::optional<double>& value, int digits = 1);

} // namespace sim
