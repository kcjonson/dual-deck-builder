#pragma once

#include "Gen.h"

#include <rules/packs/Pack.h>

#include <nlohmann/json.hpp>

#include <iosfwd>
#include <span>

namespace sim {

	// What `balance-sim gen` writes: the packs, the config, every map with every route's audit, which is the route corpus
	// the spec had `gen` write as a file of its own, and the tier and ring rows. The same seeds give the same JSON
	// whatever the workers.
	[[nodiscard]] nlohmann::ordered_json genReportJson(const GenReport& report, std::span<const rules::PackManifest> packs);

	// The readable summary: by destination tier, stops and fights against the bands, stop types, skulls, hours, own road
	// and the neighbors, then the rings, the stops stage's shortfalls, and anything placed with no resolver.
	void printGenReport(std::ostream& out, const GenReport& report, std::span<const rules::PackManifest> packs);

} // namespace sim
