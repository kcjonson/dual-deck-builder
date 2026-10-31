#include "ReportText.h"

#include <cmath>
#include <format>

namespace sim {

	nlohmann::ordered_json numberJson(const std::optional<double>& value) {
		return value ? nlohmann::ordered_json(*value) : nlohmann::ordered_json(nullptr);
	}

	nlohmann::ordered_json rateJson(const Rate& rate) {
		nlohmann::ordered_json json;
		json["count"] = rate.count;
		json["of"] = rate.of;
		json["rate"] = numberJson(rate.rate);
		json["low"] = numberJson(rate.low);
		json["high"] = numberJson(rate.high);
		return json;
	}

	std::string percent(const std::optional<double>& value) {
		return value ? std::format("{}%", std::lround(*value * 100)) : "-";
	}

	std::string percent(const Rate& rate) {
		return percent(rate.rate);
	}

	std::string interval(const Rate& rate) {
		if (!rate.rate) {
			return "-";
		}
		return std::format("{} [{}-{}]", percent(rate), std::lround(*rate.low * 100), std::lround(*rate.high * 100));
	}

	std::string fixed(const std::optional<double>& value, int digits) {
		return value ? std::format("{:.{}f}", *value, digits) : "-";
	}

} // namespace sim
