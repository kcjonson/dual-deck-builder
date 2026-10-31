#pragma once

#include "MapParams.h"
#include "ParamValidator.h"

#include <cstdint>

namespace rules::map {

	// Where a parameter's roll can land.
	struct RollBounds {
		double min{0};
		// The value the roll centres on, held inside the campaign range. Half the draws fall either side.
		double centre{0};
		double max{0};
	};

	// A roll round `value`, the environment's: half the campaign range either side of it, cut to the range.
	[[nodiscard]] RollBounds rollBounds(const NumberParamSpec& spec, double value);

	// The finished game's parameters for a seed (Area Map Generation, Randomising for the finished game),
	// validated, with what the validator changed for the Map Lab's preview. The environment is an even
	// pick, then each number is drawn round that environment's value.
	//
	// Each parameter draws on its own fork of the seed's `params` stream, named by its key, the environment
	// included, so a parameter's draw depends on the seed, its key, its campaign range and step, and the
	// value it centres on, never on the other rows or their order. What comes back is less independent:
	// the validator raises highways to strongholds + 2 in about one roll in five, every number centres on
	// its environment's value, and the pick indexes kEnvironments.
	[[nodiscard]] ValidatedMapParams rollParams(uint32_t seed);

} // namespace rules::map
