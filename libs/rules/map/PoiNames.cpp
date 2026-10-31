#include "PoiNames.h"

#include "RouteDescriptors.h"

#include <algorithm>
#include <cassert>
#include <cctype>
#include <optional>
#include <set>

namespace rules::map {

	namespace {

		std::string titleCase(std::string label) {
			for (size_t index = 0; index < label.size(); ++index) {
				if (index == 0 || label[index - 1] == ' ') {
					label[index] = static_cast<char>(std::toupper(static_cast<unsigned char>(label[index])));
				}
			}
			return label;
		}

		struct Pair {
			size_t poi{0};
			size_t place{0};
			double distance{0};
		};

	} // namespace

	std::vector<std::string>
	poiNames(const PoiLayer& layer, const Places& places, const PoiTuning& tuning, std::span<const Faction> factions, double radius) {
		std::vector<const Settlement*> named;
		for (const Settlement& town : places.towns()) {
			named.push_back(&town);
		}
		for (const Settlement& village : places.villages()) {
			named.push_back(&village);
		}
		const auto label = [&](const std::string& type) {
			return tuning.types.find(type)->second.label;
		};
		const double	  reach = kPoiNameReach * radius;
		std::vector<Pair> pairs;
		for (size_t poi = 0; poi < layer.pois.size(); ++poi) {
			if (layer.pois[poi].type == kStrongholdType) {
				continue;
			}
			const Point site = layer.pois[poi].site.at;
			for (size_t place = 0; place < named.size(); ++place) {
				const double dx = named[place]->x - site.x;
				const double dy = named[place]->y - site.y;
				const double distance = dx * dx + dy * dy;
				if (distance <= reach * reach) {
					pairs.push_back({.poi = poi, .place = place, .distance = distance});
				}
			}
		}
		std::ranges::sort(pairs, [](const Pair& a, const Pair& b) {
			return a.distance < b.distance || (a.distance == b.distance && (a.poi < b.poi || (a.poi == b.poi && a.place < b.place)));
		});

		std::set<std::string> taken;
		const auto			  unique = [&](const std::string& base) {
			   std::string name = base;
			   for (int number = 2; taken.contains(name); ++number) {
				   name = base + " " + std::to_string(number);
			   }
			   taken.insert(name);
			   return name;
		};
		const auto placeName = [&](const Pair& pair) {
			return named[pair.place]->name + " " + titleCase(label(layer.pois[pair.poi].type));
		};
		std::vector<std::optional<std::string>> names(layer.pois.size());
		for (const Pair& pair : pairs) {
			if (!names[pair.poi] && !taken.contains(placeName(pair))) {
				names[pair.poi] = unique(placeName(pair));
			}
		}
		for (const Pair& pair : pairs) {
			if (!names[pair.poi]) {
				names[pair.poi] = unique(placeName(pair));
			}
		}
		std::vector<std::string> result;
		for (size_t poi = 0; poi < layer.pois.size(); ++poi) {
			if (names[poi]) {
				result.push_back(*names[poi]);
				continue;
			}
			const Poi& destination = layer.pois[poi];
			if (destination.type == kStrongholdType) {
				const auto held = std::ranges::find(layer.strongholds, static_cast<int>(poi), &Stronghold::poi);
				assert(held != layer.strongholds.end() && "poiNames: a stronghold is seated");
				const auto faction = std::ranges::find(factions, held->faction, &Faction::id);
				assert(faction != factions.end() && "poiNames: a stronghold's faction is the packs'");
				result.push_back(unique(faction->label + " stronghold"));
				continue;
			}
			result.push_back(unique(label(destination.type) + ", " + compass(destination.site.at.x, destination.site.at.y)));
		}
		return result;
	}

} // namespace rules::map
