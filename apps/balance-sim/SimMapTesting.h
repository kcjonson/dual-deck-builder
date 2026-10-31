#pragma once

// Shared by the sim's slow tests: the map tests' fixture map as a run reads it, which takes the map stages to build.

#include "Runs.h"

#include <rules/campaign/CampaignTesting.h>

#include <span>

namespace sim::tests {

	inline const RunMap& fixtureRunMap() {
		static const RunMap map{
			.seed = rules::campaigns::testMap().origin.params.seed,
			.origin = rules::campaigns::testMap().origin,
			.layers = rules::campaigns::testLayers(),
		};
		return map;
	}

	inline std::span<const RunMap> fixtureMaps() {
		return {&fixtureRunMap(), 1};
	}

} // namespace sim::tests
