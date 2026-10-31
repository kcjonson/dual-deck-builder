#pragma once

#include "ConfigFields.h"

#include <rules/core/Ids.h>
#include <rules/core/Opponent.h>
#include <rules/packs/Pack.h>

#include <nlohmann/json.hpp>

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace sim {

	// What `balance-sim fights` plays (Balance Simulation, The core and fights), read strictly from the config's JSON. The
	// tuning to try isn't in it: that's packs loaded over the base pack, as the game loads them.

	// One fight of a route: a skull count, its encounter picked on the fight's seed at the config's tier as a run's stop
	// picks it, or an encounter named by id, at its own skulls.
	struct FightStep {
		int								  skulls{1};
		std::optional<rules::EncounterId> encounter;

		bool operator==(const FightStep&) const = default;
	};

	// The fights a route would field, in order, the crew carrying its damage from one to the next. The map's routes and
	// stops aren't in the sim yet, so a route is this plain list.
	using RouteConfig = std::vector<FightStep>;

	struct FightsConfig {
		// Run n of every cell plays the campaign seed's fork("run", n), its fight f that run's fork("fight", f).
		uint32_t				 seed{1};
		int						 runs{100};
		std::vector<CrewConfig>	 crews;
		std::vector<RouteConfig> routes;
		// The destination tier whose encounters a skull count picks from.
		int				 tier{1};
		std::vector<int> stages{0};
		// A fight still on after this many player turns has stalled.
		int turns{25};
		// The player's stand-in on every seat: the aggressive flanker is the floor, intent_aware the ceiling.
		rules::Behavior standIn{.policy = "aggressive_flanker"};
		// Each crew card's draws and plays, and what each play did to the raiders' plans, at two projections of the
		// enemy turn a play.
		bool cards{false};

		bool operator==(const FightsConfig&) const = default;
	};

	// Reads a config, filling what it leaves out:
	//
	//   seed        0 or more, 1
	//   runs        runs a cell, 1 or more, 100
	//   crews       "all" (every pair of different archetypes, then each alone), "pairs", "solo", or a list of crews,
	//               each a list of one or two seats, a seat an archetype's id or {"archetype", "deck", "add"}, where
	//               deck replaces its starting deck and add puts cards in, both card counts by id; "all"
	//   archetypes  what "all", "pairs", and "solo" draw from; the archetypes the packs start unlocked
	//   routes      a list of routes, each a list of fights, a fight a skull count or an encounter's id; [[1], [2], [3]]
	//   tier        1 to 5, 1
	//   stages      game stages, 0 to 6, each its own cells; [0]
	//   turns       the stall cap, 1 or more, 25
	//   standIn     {"policy", "weights", "difficulty"}, as an opponent's behavior names one; the aggressive flanker
	//   cards       whether to tally each crew card's draws and plays (--cards); false
	//
	// Anything else, or anything the packs don't define, fails as a ContentError naming `where` and the path in it.
	[[nodiscard]] FightsConfig readFightsConfig(const nlohmann::json& config, const std::string& where, const rules::Content& content);

	// The config as JSON readFightsConfig reads back the same, its crews listed out.
	[[nodiscard]] nlohmann::json fightsConfigJson(const FightsConfig& config);

	// A route as the config writes it.
	[[nodiscard]] nlohmann::json routeJson(const RouteConfig& route);

} // namespace sim
