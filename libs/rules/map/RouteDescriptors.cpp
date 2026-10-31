#include "RouteDescriptors.h"

#include <rules/core/JsonReader.h>

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <optional>
#include <set>
#include <span>
#include <utility>

namespace rules::map {

	namespace {

		// tan(22.5 degrees): where a bearing turns from a point of the compass to the one between.
		constexpr double kEighth = 0.41421356237309503;

		double readPositive(JsonReader& reader, std::string_view key) {
			const double value = reader.requireNumber(key);
			if (!(value > 0)) {
				reader.failAt(key, "must be above 0");
			}
			return value;
		}

		size_t slots(std::string_view name) {
			size_t count = 0;
			for (size_t at = name.find(kRouteNumberSlot); at != std::string_view::npos; at = name.find(kRouteNumberSlot, at + 1)) {
				count += 1;
			}
			return count;
		}

		struct Named {
			std::string name;
			RoadClass	roadClass{RoadClass::Highway};
			Biome		biome{Biome::Scrub};
		};

		// A route's name from its own legs: a biome's where one covers biomeShare of them and has a name, or else
		// its dominant class's, a highway's with the route number of the main highway on the own leg with the most
		// highway.
		Named nameOf(std::span<const LegProfile> own, std::span<const int> routeNumbers, const RouteTuning& tuning) {
			std::array<double, 3> classLengths{};
			std::array<double, 6> biomeLengths{};
			double				  total = 0;
			int					  highway = -1;
			double				  mostHighway = 0;
			for (const LegProfile& leg : own) {
				for (size_t road = 0; road < classLengths.size(); ++road) {
					classLengths[road] += leg.classLengths[road];
					total += leg.classLengths[road];
				}
				for (size_t biome = 0; biome < biomeLengths.size(); ++biome) {
					biomeLengths[biome] += leg.biomeLengths[biome];
				}
				const double highwayLength = leg.classLengths[static_cast<size_t>(RoadClass::Highway)];
				if (leg.highway >= 0 && highwayLength > mostHighway) {
					highway = leg.highway;
					mostHighway = highwayLength;
				}
			}
			const auto roadClass = static_cast<size_t>(std::ranges::max_element(classLengths) - classLengths.begin());
			const auto biome = static_cast<size_t>(std::ranges::max_element(biomeLengths) - biomeLengths.begin());
			Named	   named{.name = {}, .roadClass = static_cast<RoadClass>(roadClass), .biome = static_cast<Biome>(biome)};
			if (!tuning.biomeNames[biome].empty() && total > 0 && biomeLengths[biome] >= tuning.biomeShare * total) {
				named.name = tuning.biomeNames[biome];
				return named;
			}
			named.name = tuning.classNames[roadClass];
			if (named.roadClass == RoadClass::Highway) {
				assert(highway >= 0 && std::cmp_less(highway, routeNumbers.size()) && "describeRoutes: every highway has a route number");
				named.name.replace(
					named.name.find(kRouteNumberSlot), kRouteNumberSlot.size(), std::to_string(routeNumbers[static_cast<size_t>(highway)])
				);
			}
			return named;
		}

		// Per route, whether another has its name.
		std::vector<bool> sharingNames(std::span<const RouteDescriptor> routes) {
			std::vector<bool> sharing;
			for (const RouteDescriptor& route : routes) {
				sharing.push_back(std::ranges::count(routes, route.name, &RouteDescriptor::name) > 1);
			}
			return sharing;
		}

	} // namespace

	RouteTuning readRouteTuning(const std::filesystem::path& file) {
		const nlohmann::json json = readJsonFile(file);
		JsonReader			 reader(json, file.generic_string());
		RouteTuning			 tuning;
		tuning.unitsPerFuel = readPositive(reader, "unitsPerFuel");
		JsonReader names = reader.requireObject("names");
		tuning.biomeShare = readPositive(names, "biomeShare");
		if (tuning.biomeShare > 1) {
			names.failAt("biomeShare", "must be at most 1");
		}
		tuning.biomeStep = readPositive(names, "biomeStep");
		JsonReader biomes = names.requireObject("biomes");
		for (const auto& [key, biome] : kBiomeNames) {
			if (std::optional<std::string> name = biomes.optionalString(key)) {
				if (name->empty()) {
					biomes.failAt(key, "is empty");
				}
				tuning.biomeNames[static_cast<size_t>(biome)] = std::move(*name);
			}
		}
		biomes.finish();
		JsonReader classes = names.requireObject("classes");
		for (const auto& [key, road] : kRoadClassNames) {
			std::string	 name = classes.requireString(key);
			const size_t wanted = road == RoadClass::Highway ? 1 : 0;
			if (name.empty()) {
				classes.failAt(key, "is empty");
			}
			if (slots(name) != wanted) {
				classes.failAt(key, wanted == 1 ? "must hold {number} once" : "can't hold {number}: only a highway has a route number");
			}
			tuning.classNames[static_cast<size_t>(road)] = std::move(name);
		}
		classes.finish();
		names.finish();
		reader.finish();
		return tuning;
	}

	std::vector<RouteDescriptor> describeRoutes(const DescribeArgs& args) {
		const std::vector<Route> routes = routesTo(args.routeLegs, args.destination);
		assert(!routes.empty() && "describeRoutes: a destination has its arrivals");
		std::vector<RouteDescriptor> described;
		std::vector<Point>			 middles;
		for (size_t place = 0; place < routes.size(); ++place) {
			std::set<int> others;
			for (size_t other = 0; other < routes.size(); ++other) {
				if (other != place) {
					others.insert(routes[other].legs.begin(), routes[other].legs.end());
				}
			}
			std::vector<LegProfile> own;
			for (const int leg : routes[place].legs) {
				if (!others.contains(leg)) {
					own.push_back(
						profileLeg(args.network, args.routeLegs.legs[static_cast<size_t>(leg)], args.biomeAt, args.tuning.biomeStep)
					);
				}
			}
			// Its last leg at least: no two arrivals share one.
			assert(!own.empty() && "describeRoutes: a route has road of its own");
			Named named = nameOf(own, args.network.routeNumbers, args.tuning);
			middles.push_back(own.back().middle);
			described.push_back({
				.route = static_cast<int>(place),
				.legs = routes[place].legs,
				.name = std::move(named.name),
				.roadClass = named.roadClass,
				.biome = named.biome,
				.length = routes[place].length,
				.hours = routes[place].hours,
				.fuel = fuelFor(routes[place].length, args.tuning),
			});
		}
		// Routes that came out alike get the side they come in from, from the destination to the middle of each one's
		// last leg; any still alike, their letter.
		const Point				site = legPoints(args.network, args.routeLegs.legs[static_cast<size_t>(routes.front().legs.back())]).back();
		const std::vector<bool> alike = sharingNames(described);
		for (size_t place = 0; place < described.size(); ++place) {
			if (alike[place]) {
				described[place].name += " from the " + compass(middles[place].x - site.x, middles[place].y - site.y);
			}
		}
		const std::vector<bool> stillAlike = sharingNames(described);
		for (size_t place = 0; place < described.size(); ++place) {
			if (stillAlike[place]) {
				described[place].name += std::string(" ") + static_cast<char>('A' + place);
			}
		}
		return described;
	}

	int fuelFor(double length, const RouteTuning& tuning) {
		const int fuel = static_cast<int>(std::ceil(length / tuning.unitsPerFuel));
		return fuel < 1 ? 1 : fuel;
	}

	std::string compass(double dx, double dy) {
		const double across = std::abs(dx);
		const double up = std::abs(dy);
		if (up <= across * kEighth) {
			return dx < 0 ? "west" : "east";
		}
		if (across <= up * kEighth) {
			return dy < 0 ? "south" : "north";
		}
		return std::string(dy < 0 ? "south" : "north") + (dx < 0 ? "-west" : "-east");
	}

} // namespace rules::map
