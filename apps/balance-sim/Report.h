#pragma once

#include "Fights.h"

#include <rules/packs/Pack.h>

#include <nlohmann/json.hpp>

#include <iosfwd>
#include <span>

namespace sim {

	// What `balance-sim fights` writes: the packs it loaded, the config as it read it, a row a cell, and the per-fight
	// rows by skull count. The same config, packs, and seed give the same JSON whatever the workers; the wall time isn't
	// in it.
	[[nodiscard]] nlohmann::ordered_json reportJson(const FightsReport& report, std::span<const rules::PackManifest> packs);

	// The readable summary: every cell's runs and fights, the opening fights by skull count against Runs and Encounters'
	// per-fight targets, the fairness spreads, what the raiders played, and what a stand-in's decision cost.
	void printReport(std::ostream& out, const FightsReport& report, std::span<const rules::PackManifest> packs);

} // namespace sim
