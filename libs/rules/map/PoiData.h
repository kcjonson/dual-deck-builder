#pragma once

#include "Biome.h"

#include <rules/core/JsonReader.h>

#include <array>
#include <filesystem>
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace rules::map {

	// What a POI yields and a supplies find holds.
	enum class Resource { Food, Water, Fuel, Meds, Scrap };

	inline constexpr EnumNames<Resource, 5> kResourceNames{{
		{"food", Resource::Food},
		{"water", Resource::Water},
		{"fuel", Resource::Fuel},
		{"meds", Resource::Meds},
		{"scrap", Resource::Scrap},
	}};

	// A stronghold's type; no type in the tuning has it.
	inline constexpr std::string_view kStrongholdType = "stronghold";

	struct PoiType {
		std::string label;
		// By Resource, 0 for one it doesn't yield.
		std::array<int, 5> yields{};
	};

	// Where a placement rule holds: every field it gives holds, and a condition with none holds everywhere.
	struct SiteCondition {
		std::optional<double>			  ruinAtLeast;
		std::optional<double>			  elevationBelow;
		std::optional<double>			  moistureAtLeast;
		std::optional<std::vector<Biome>> biomes;
		// World units to the nearest highway.
		std::optional<double> highwayWithin;
	};

	// Types a POI takes where any of `where` holds, one picked by a draw.
	struct PlacementRule {
		std::vector<std::string>   types;
		std::vector<SiteCondition> where;
	};

	// How POIs and strongholds are placed, a pack's map/pois.json (route-tree-and-pois.md, Strongholds and POIs).
	struct PoiTuning {
		struct Strongholds {
			// Shares of the radius: the outer band they stand in, and how far apart they keep.
			double inner{0};
			double outer{0};
			double spacing{0};
			// Steps of the sectors' rotation tried, each an even share of a sector.
			int rotationSteps{1};
			// World units round a site its faction fit samples, and the most a faction's fit is nudged a map.
			double fitRadius{0};
			double fitJitter{0};
		};
		struct Rings {
			// From the metro's edge out to `outer` of the radius, each ring's target before poiDensity.
			double			 outer{0};
			std::vector<int> targets;
		};
		struct Sites {
			// Shares of the radius every site keeps from every POI placed.
			double spacing{0};
			// World units between sites along a meeting stretch, and kept from its ends: `margin`, or `marginShare` of
			// a short one.
			double step{0};
			double margin{0};
			double marginShare{0};
		};
		struct Score {
			double noise{0};
			double ruin{0};
			double highway{0};
			double highwayWithin{0};
			double threeWay{0};
		};

		Strongholds strongholds;
		Rings		rings;
		Sites		sites;
		Score		score;
		// What the first ring's POIs yield between them, before location types them.
		std::vector<Resource> cover;
		// In order; the last holds everywhere.
		std::vector<PlacementRule>					placement;
		std::map<std::string, PoiType, std::less<>> types;
	};

	// A pack's map/pois.json. Every type a rule names is a type; the last rule has a condition that holds
	// everywhere, so every site is typed; and some type yields each resource the first ring covers. Anything else
	// fails with a ContentError naming the file and the field.
	[[nodiscard]] PoiTuning readPoiTuning(const std::filesystem::path& file);

	// A faction, as the map seats its stronghold: the land it wants.
	struct Faction {
		std::string id;
		std::string label;
		// By Biome, how much it wants each, and how much it wants ruins.
		std::array<double, 6> biomes{};
		double				  ruin{0};
	};

	// A pack's factions/factions.json, {"<id>": {"label", "terrain": {"biomes": {...}, "ruin"}}}, in id order.
	[[nodiscard]] std::vector<Faction> readFactions(const std::filesystem::path& file);

} // namespace rules::map
