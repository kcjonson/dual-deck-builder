#pragma once

#include "Campaign.h"

#include <rules/packs/Pack.h>

#include <cstdint>
#include <string>
#include <variant>
#include <vector>

namespace rules::campaign {

	// Drivers joining the pool (Compound and Supply Runs, The driver pool; find-stops.md): founding's deal, someone new
	// found on the road, who joins once their run gets home, and a missing driver found on a run, who comes home with
	// it. The Find: driver stop that turns them up is the map's, and hands whoIsFound its stop's seed.

	// "Road Warrior 2": the archetype's title and how many of it have joined the pool up to them, the dead included
	// (call 4). Throws std::invalid_argument for a driver outside the pool.
	[[nodiscard]] std::string driverName(const Campaign& campaign, const Content& content, const CrewId& driver);

	// A driver joins the pool now: the next driver id, at their archetype's full HP, their vehicle whole, and its
	// starting deck as their default deck. Returns their id. Throws std::invalid_argument once the campaign is over, and
	// for an archetype no loaded pack defines.
	CrewId recruitDriver(Campaign& campaign, const Content& content, const DriverId& archetype);

	// Someone new: the unlocked archetype the compound has fewest living drivers of, the missing and anyone riding home
	// as a recruit counted, drawn evenly on `seed` among ties (calls 211 and 273). Repeats and the order the unlocked
	// come in change nothing. Throws std::invalid_argument for none unlocked, or one no loaded pack defines.
	[[nodiscard]] DriverId
	recruitArchetype(const Campaign& campaign, const Content& content, const std::vector<DriverId>& unlocked, uint32_t seed);

	// Who a Find: driver turns up: one of the pool's missing, or someone new of an archetype.
	using FoundDriver = std::variant<CrewId, DriverId>;

	// The first missing driver in pool order who isn't found on this run already, or with nobody missing, someone new,
	// recruitArchetype's (call 211). Throws std::invalid_argument with no run out, and as recruitArchetype does.
	[[nodiscard]] FoundDriver
	whoIsFound(const Campaign& campaign, const Content& content, const std::vector<DriverId>& unlocked, uint32_t seed);

	// Takes on who a find turned up, riding home with the run: a missing driver still missing until it's home (call 43),
	// and someone new as one of its recruits (call 212). unloadRun brings both in, and a failed run loses both. Throws
	// std::invalid_argument with no run out, for a driver outside the pool, one who isn't missing or is found on this run
	// already, and an archetype no loaded pack defines.
	void takeFoundDriver(Campaign& campaign, const Content& content, const FoundDriver& found);

} // namespace rules::campaign
