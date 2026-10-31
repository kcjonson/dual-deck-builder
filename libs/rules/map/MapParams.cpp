#include "MapParams.h"

#include <cassert>
#include <cmath>
#include <limits>

namespace rules::map {

	namespace {

		consteval bool tableInOrder() {
			for (size_t index = 0; index < kNumberParams.size(); ++index) {
				if (static_cast<size_t>(kNumberParams[index].param) != index) {
					return false;
				}
			}
			for (size_t index = 0; index < kEnvironments.size(); ++index) {
				if (kEnvironments[index].environment != kEnvironmentNames[index].second) {
					return false;
				}
			}
			return true;
		}

		static_assert(tableInOrder(), "kNumberParams and kEnvironments are indexed by their enums");

	} // namespace

	const NumberParamSpec& paramSpec(NumberParam param) {
		return kNumberParams[static_cast<size_t>(param)];
	}

	const EnvironmentSpec& environmentSpec(Environment environment) {
		return kEnvironments[static_cast<size_t>(environment)];
	}

	double paramValue(const MapParams& params, const NumberParamSpec& spec) {
		if (const auto* field = std::get_if<int MapParams::*>(&spec.field)) {
			return params.*(*field);
		}
		return params.*std::get<double MapParams::*>(spec.field);
	}

	void setParamValue(MapParams& params, const NumberParamSpec& spec, double value) {
		if (const auto* field = std::get_if<int MapParams::*>(&spec.field)) {
			assert(
				value == std::floor(value) && value >= std::numeric_limits<int>::min() && value <= std::numeric_limits<int>::max() &&
				"setParamValue: a whole-number parameter takes a whole number"
			);
			params.*(*field) = static_cast<int>(value);
			return;
		}
		params.*std::get<double MapParams::*>(spec.field) = value;
	}

	double snapToStep(StepGrid step, double value) {
		assert(step.units > 0 && step.perUnit > 0 && std::isfinite(value) && "snapToStep: a positive step and a finite value");
		const double steps = std::round(value * step.perUnit / step.units);
		return steps * step.units / step.perUnit;
	}

	MapParams environmentDefaults(uint32_t seed, Environment environment) {
		MapParams params{.seed = seed, .environment = environment};
		for (const NumberParamSpec& spec : kNumberParams) {
			setParamValue(params, spec, spec.defaultValue);
		}
		for (const ParamValue& value : environmentSpec(environment).values) {
			setParamValue(params, paramSpec(value.param), value.value);
		}
		return params;
	}

	MapParams resolveMapParams(const MapParamSet& set) {
		MapParams params = environmentDefaults(set.seed, set.environment);
		for (const NumberParamSpec& spec : kNumberParams) {
			if (const std::optional<double>& value = set.overrides[static_cast<size_t>(spec.param)]) {
				setParamValue(params, spec, *value);
			}
		}
		return params;
	}

} // namespace rules::map
