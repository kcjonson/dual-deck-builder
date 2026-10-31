#include "RollParams.h"

#include <random/Rng.h>

#include <algorithm>
#include <array>

namespace rules::map {

	namespace {

		constexpr std::array<Environment, kEnvironments.size()> environmentOrder() {
			std::array<Environment, kEnvironments.size()> order{};
			for (size_t index = 0; index < order.size(); ++index) {
				order[index] = kEnvironments[index].environment;
			}
			return order;
		}

		constexpr std::array<Environment, kEnvironments.size()> kRolledEnvironments = environmentOrder();

		// A draw split at its centre: half below it and half above, whatever room each side has, each half a
		// triangle likeliest at the centre and thinning to nothing at its bound. u1 + u2 - 1 is a triangle on
		// (-1, 1), and each sign is stretched to its own side.
		double rollAround(foundation::Rng rng, const NumberParamSpec& spec, double value) {
			const RollBounds bounds = rollBounds(spec, value);
			const double	 offset = rng.nextDouble() + rng.nextDouble() - 1;
			const double	 drawn =
				offset < 0 ? bounds.centre + offset * (bounds.centre - bounds.min) : bounds.centre + offset * (bounds.max - bounds.centre);
			return std::clamp(snapToStep(spec.step, drawn), spec.campaign.min, spec.campaign.max);
		}

	} // namespace

	RollBounds rollBounds(const NumberParamSpec& spec, double value) {
		const double centre = std::clamp(value, spec.campaign.min, spec.campaign.max);
		const double reach = (spec.campaign.max - spec.campaign.min) / 2;
		return {.min = std::max(spec.campaign.min, centre - reach), .centre = centre, .max = std::min(spec.campaign.max, centre + reach)};
	}

	ValidatedMapParams rollParams(uint32_t seed) {
		const foundation::Rng stream = foundation::Rng(seed).fork("params");
		foundation::Rng		  pick = stream.fork("environment");
		const Environment	  environment = pick.pick(kRolledEnvironments);
		const MapParams		  defaults = environmentDefaults(seed, environment);
		MapParams			  rolled = defaults;
		for (const NumberParamSpec& spec : kNumberParams) {
			setParamValue(rolled, spec, rollAround(stream.fork(spec.key), spec, paramValue(defaults, spec)));
		}
		return validateMapParams(rolled);
	}

} // namespace rules::map
