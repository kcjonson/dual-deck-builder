#include "ParamValidator.h"

#include <algorithm>
#include <array>
#include <cassert>
#include <charconv>
#include <cmath>
#include <utility>

namespace rules::map {

	namespace {

		// The shortest text that reads back as the same double: 0.15, not 0.1499999999999999944.
		std::string formatNumber(double value) {
			std::array<char, 32> text{};
			const auto [end, error] = std::to_chars(text.data(), text.data() + text.size(), value);
			assert(error == std::errc{} && "formatNumber: 32 characters hold any double");
			return {text.data(), end};
		}

		class Validation {
		  public:
			explicit Validation(const MapParams& params)
				: result{.params = params, .clamps = {}} {}

			void change(NumberParam param, double to, std::string reason) {
				const NumberParamSpec& spec = paramSpec(param);
				result.clamps.push_back(
					{.param = spec.key, .from = paramValue(result.params, spec), .to = to, .reason = std::move(reason)}
				);
				setParamValue(result.params, spec, to);
			}

			[[nodiscard]] const MapParams&	 params() const { return result.params; }
			[[nodiscard]] ValidatedMapParams take() { return std::move(result); }

		  private:
			ValidatedMapParams result;
		};

	} // namespace

	ValidatedMapParams validateMapParams(const MapParams& params) {
		Validation validation(params);
		for (const NumberParamSpec& spec : kNumberParams) {
			const double value = paramValue(params, spec);
			assert(std::isfinite(value) && "validateMapParams: every parameter is a finite number");
			const double clamped = std::clamp(value, spec.tuning.min, spec.tuning.max);
			if (clamped != value) {
				validation.change(
					spec.param, clamped, "tuning range " + formatNumber(spec.tuning.min) + " to " + formatNumber(spec.tuning.max)
				);
			}
		}

		// A stronghold sits in its sector's outer band where two branches of the route tree meet, and
		// highways lead the branches; two more highways than strongholds keeps a sector with no seam between
		// branches rare. When even the most highways can't cover that, strongholds come down first (Area Map
		// Generation, open question 3).
		const auto highwaysMax = static_cast<int>(paramSpec(NumberParam::Highways).tuning.max);
		if (validation.params().strongholds + 2 > highwaysMax) {
			validation.change(NumberParam::Strongholds, highwaysMax - 2, "highways max - 2");
		}
		if (validation.params().highways < validation.params().strongholds + 2) {
			validation.change(NumberParam::Highways, validation.params().strongholds + 2, "strongholds + 2");
		}

		// n exits at least s degrees from their neighbours only fit round the rim while n * s is 360 or less.
		const int separationMax = 360 / validation.params().highways;
		if (validation.params().highwaySeparation > separationMax) {
			validation.change(NumberParam::HighwaySeparation, separationMax, "360 / highways");
		}
		return validation.take();
	}

	std::string describeClamp(const ParamClamp& clamp) {
		const std::string_view verb = clamp.to > clamp.from ? "raised" : "lowered";
		return std::string(clamp.param) + " " + std::string(verb) + " to " + formatNumber(clamp.to) + " (" + clamp.reason + ")";
	}

} // namespace rules::map
