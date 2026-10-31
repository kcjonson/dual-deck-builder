#pragma once

#include "Runs.h"

#include <rules/packs/Pack.h>

#include <nlohmann/json.hpp>

#include <iosfwd>
#include <span>

namespace sim {

	// What `balance-sim runs` writes: the packs it loaded, the config as it read it, the maps, a row a cell, and the
	// cells grouped by tier, by route risk, by stop, and behind a neighbor's run. The same config, packs, and maps give the
	// same JSON whatever the workers; the wall time isn't in it.
	[[nodiscard]] nlohmann::ordered_json runReportJson(const RunsReport& report, std::span<const rules::PackManifest> packs);

	// The readable summary: runs by destination tier against Runs and Encounters' per-run targets, each pair by tier,
	// what they brought home, runs by route risk, each kind of stop, the fairness spreads, the gap behind a neighbor's
	// run, the routes pairs came home from least, and what a stand-in's decision cost.
	void printRunReport(std::ostream& out, const RunsReport& report, std::span<const rules::PackManifest> packs);

} // namespace sim
