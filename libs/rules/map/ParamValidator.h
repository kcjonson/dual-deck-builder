#pragma once

#include "MapParams.h"

#include <string>
#include <string_view>
#include <vector>

namespace rules::map {

	// One value the validator changed, for the Map Lab's readout.
	struct ParamClamp {
		// The parameter's key.
		std::string_view param;
		double			 from{0};
		double			 to{0};
		// In a few words: "tuning range 3 to 9", "strongholds + 2".
		std::string reason;

		bool operator==(const ParamClamp&) const = default;
	};

	struct ValidatedMapParams {
		MapParams params;
		// In the order they were made; empty when the params were already valid.
		std::vector<ParamClamp> clamps;
	};

	// The parameter validator (Area Map Generation, Validation and retries), which generation runs on the
	// output of. It clamps every value into its tuning range, then the combinations the generator can't
	// honour. The seed, the environment and whole-number parameters need no repair: their types hold them.
	[[nodiscard]] ValidatedMapParams validateMapParams(const MapParams& params);

	// As the readout words it: "highways raised to 6 (strongholds + 2)".
	[[nodiscard]] std::string describeClamp(const ParamClamp& clamp);

} // namespace rules::map
