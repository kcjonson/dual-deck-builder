#pragma once

#include "Biome.h"
#include "MoveCost.h"
#include "RoadNetwork.h"
#include "RouteLegs.h"

#include <array>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace rules::map {

	// How a route is named and what it costs to drive, a pack's map/routes.json.
	struct RouteTuning {
		// World units of road a unit of fuel covers, out and back.
		double unitsPerFuel{0};
		// The share of a route's own road a biome needs to name it, and the world units its legs' biomes are
		// sampled at.
		double biomeShare{0};
		double biomeStep{0};
		// By Biome: its route name, or empty for one that never names a route.
		std::array<std::string, 6> biomeNames;
		// By RoadClass. The highway's holds kRouteNumberSlot once, where its route number goes; the others don't.
		std::array<std::string, 3> classNames;
	};

	inline constexpr std::string_view kRouteNumberSlot = "{number}";

	// A pack's map/routes.json: {"unitsPerFuel", "names": {"biomeShare", "biomeStep", "biomes", "classes"}}, with
	// a name for any biome and one for every class. Anything else fails with a ContentError naming the file and
	// the field.
	[[nodiscard]] RouteTuning readRouteTuning(const std::filesystem::path& file);

	// A route as the run route screen names and prices it (Area Map Generation, Routes; stops-and-routes.md,
	// Route descriptors): what generation fixes about it, before stops or knowledge.
	struct RouteDescriptor {
		// Its place among its destination's routes, quickest first.
		int route{0};
		// Leg ids from the compound out.
		std::vector<int> legs;
		// "Route 9 highway", "Back roads", "Through the mire": from its own road, the legs no other route to its
		// destination uses, then told apart from those routes by the side it comes in from, then by letter.
		std::string name;
		// The class and the biome most of its own road is, ties to the earlier.
		RoadClass roadClass{RoadClass::Highway};
		Biome	  biome{Biome::Scrub};
		// World units, and hours of driving one way at the map's travel pace: out, before its stops, or home.
		double length{0};
		double hours{0};
		// Paid at departure, out and back.
		int fuel{0};
	};

	struct DescribeArgs {
		const RoadNetwork& network;
		const RouteLegs&   routeLegs;
		int				   destination{0};
		const BiomeAt&	   biomeAt;
		const RouteTuning& tuning;
	};

	// Each of a destination's routes described, quickest first. A highway's route number is the network's
	// (RoadNetwork::routeNumbers) for the main highway of its own leg with the most highway on it.
	[[nodiscard]] std::vector<RouteDescriptor> describeRoutes(const DescribeArgs& args);

	// Fuel for a route of `length`, out and back: a unit per unitsPerFuel of road, at least one.
	[[nodiscard]] int fuelFor(double length, const RouteTuning& tuning);

	// The point of the compass a direction is nearest, x east and y north, by plain arithmetic: "north",
	// "north-east", and so on.
	[[nodiscard]] std::string compass(double dx, double dy);

} // namespace rules::map
