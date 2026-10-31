#pragma once

#include "Places.h"
#include "PoiData.h"
#include "Pois.h"

#include <span>
#include <string>
#include <vector>

namespace rules::map {

	// The share of the radius a town or village lends its name across: the towns' spacing.
	inline constexpr double kPoiNameReach = 0.25;

	// Each POI's name (stops-and-routes.md, POI names), worked out on read and taking no draws: a town's or
	// village's name within reach and its type's label in title case, "Elk Creek Clinic", pairs taken nearest first,
	// so a second POI of a type near one place takes the next place in its reach; one whose places in reach all lend
	// that name already is numbered after the nearest, "Elk Creek Clinic 2". A stronghold is its faction's, "Mire-
	// Crawlers stronghold", and any other POI with no place in reach its label and its bearing from the compound,
	// "Clinic, north-east".
	[[nodiscard]] std::vector<std::string>
	poiNames(const PoiLayer& layer, const Places& places, const PoiTuning& tuning, std::span<const Faction> factions, double radius);

} // namespace rules::map
