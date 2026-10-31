#pragma once

#include "ConfigFields.h"

#include <rules/core/Opponent.h>
#include <rules/packs/Pack.h>

#include <nlohmann/json.hpp>

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace sim {

	// What `balance-sim runs` plays (Balance Simulation, runs), read strictly from the config's JSON: crews over the
	// routes of maps made from seeds, each stop in order, as a supply run plays them.

	struct RunsConfig {
		// rollParams seeds, each a map made as founding makes one. Run n of every cell on a map is its campaign's run n, so
		// it draws on the map seed's fork("run", n).
		std::vector<uint32_t>	maps{1};
		int						runs{20};
		std::vector<CrewConfig> crews;
		// How many of each map's routes to run, drawn on the map's seed, or every one when none.
		std::optional<int> routes;
		// The destination tiers whose routes run: 1 to 4, since no run leaves for a stronghold (call 410).
		std::vector<int> tiers{1, 2, 3, 4};
		std::vector<int> stages{0};
		// A fight still on after this many player turns has stalled, and the run is abandoned there.
		int				turns{25};
		rules::Behavior standIn{.policy = "aggressive_flanker"};
		// Each route runs again the day after a run to its nearest neighbor, with that run's stops still cleared.
		bool neighbor{true};

		bool operator==(const RunsConfig&) const = default;
	};

	// Reads a config, filling what it leaves out:
	//
	//   maps        a count, seeds 1 to it, or a list of seeds, each 0 or more; 1
	//   runs        runs a cell, 1 or more, 20
	//   crews       as the fights config's, with archetypes; "pairs"
	//   routes      "all", or how many of each map's routes, 1 or more; "all"
	//   tiers       destination tiers, 1 to 4, each once; [1, 2, 3, 4]
	//   stages      game stages, 0 to 6, each its own cells; [0]
	//   turns       the stall cap, 1 or more, 25
	//   standIn     as the fights config's; the aggressive flanker
	//   neighbor    whether each route runs again behind its nearest neighbor's run; true
	//
	// Anything else, or anything the packs don't define, fails as a ContentError naming `where` and the path in it.
	[[nodiscard]] RunsConfig readRunsConfig(const nlohmann::json& config, const std::string& where, const rules::Content& content);

	// The config as JSON readRunsConfig reads back the same, its maps and crews listed out.
	[[nodiscard]] nlohmann::json runsConfigJson(const RunsConfig& config);

} // namespace sim
