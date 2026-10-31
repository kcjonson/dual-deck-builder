#include "StopTables.h"

#include "ContentReading.h"

#include <rules/core/ContentError.h>
#include <rules/core/JsonReader.h>

#include <algorithm>
#include <cassert>
#include <cmath>
#include <utility>

namespace rules::map {

	namespace {

		// A row's weight or multiplier for each type it names; `fill` for each it leaves out.
		std::array<double, kStopTypeCount> readRow(JsonReader& row, double fill) {
			std::array<double, kStopTypeCount> weights{};
			weights.fill(fill);
			for (const auto& [name, type] : kStopTypeNames) {
				if (row.has(name)) {
					weights[static_cast<size_t>(type)] = readAtLeast(row, name, 0);
				}
			}
			row.finish();
			return weights;
		}

	} // namespace

	StopTables::StopTables(const Weights& weights, std::vector<std::string> territories, const std::string& where)
		: names(std::move(territories)) {
		assert(names.size() == weights.territories.size() && "StopTables: a multiplier row for each territory");
		const size_t rows = 3 * 6 * static_cast<size_t>(kStopTiers) * names.size();
		fights.resize(rows);
		calms.resize(rows);
		for (const auto& [className, roadClass] : kRoadClassNames) {
			for (const auto& [biomeName, biome] : kBiomeNames) {
				for (int tier = 1; tier <= kStopTiers; ++tier) {
					for (size_t territory = 0; territory < names.size(); ++territory) {
						const size_t row = rowOf(roadClass, biome, tier, static_cast<int>(territory));
						double		 fight = 0;
						double		 calm = 0;
						for (size_t type = 0; type < kStopTypeCount; ++type) {
							const auto	 kind = static_cast<StopType>(type);
							const double weight = !isResolvable(kind) ? 0
																	  : weights.classes[static_cast<size_t>(roadClass)][type] *
																			weights.biomes[static_cast<size_t>(biome)][type] *
																			weights.tiers[static_cast<size_t>(tier - 1)][type] *
																			weights.territories[territory][type];
							fight += isFight(kind) ? weight : 0;
							calm += isCalm(kind) ? weight : 0;
							fights[row][type] = fight;
							calms[row][type] = calm;
						}
						const std::string at = where + ": " + std::string(className) + " in " + std::string(biomeName) + " at tier " +
											   std::to_string(tier) + " in territory " + names[territory];
						if (!(fight > 0 && std::isfinite(fight))) {
							throw ContentError(at + " weighs no fight the run resolves, so a fight stop has nothing to be");
						}
						if (!(calm > 0 && std::isfinite(calm))) {
							throw ContentError(at + " weighs no calm stop the run resolves, so a calm stop has nothing to be");
						}
					}
				}
			}
		}
	}

	int StopTables::territory(std::string_view name) const {
		const auto found = std::ranges::find(names, name);
		assert(found != names.end() && "StopTables: a territory the tables have");
		return static_cast<int>(found - names.begin());
	}

	size_t StopTables::rowOf(RoadClass roadClass, Biome biome, int tier, int territory) const {
		assert(
			tier >= 1 && tier <= kStopTiers && territory >= 0 && std::cmp_less(territory, names.size()) &&
			"StopTables: a row the tables have"
		);
		return ((static_cast<size_t>(roadClass) * 6 + static_cast<size_t>(biome)) * kStopTiers + static_cast<size_t>(tier - 1)) *
				   names.size() +
			   static_cast<size_t>(territory);
	}

	StopType StopTables::draw(RoadClass roadClass, Biome biome, int tier, int territory, double draw, bool fight) const {
		const std::array<double, kStopTypeCount>& sums = (fight ? fights : calms)[rowOf(roadClass, biome, tier, territory)];
		const double							  target = draw * sums.back();
		size_t									  last = 0;
		for (size_t type = 0; type < kStopTypeCount; ++type) {
			const double before = type == 0 ? 0 : sums[type - 1];
			if (sums[type] > before) {
				last = type;
				if (sums[type] > target) {
					return static_cast<StopType>(type);
				}
			}
		}
		// draw * total can round up to the total; the last type with weight takes it.
		return static_cast<StopType>(last);
	}

	StopTables readStopTables(const std::filesystem::path& file) {
		const nlohmann::json json = readJsonFile(file);
		JsonReader			 reader(json, file.generic_string());
		StopTables::Weights	 weights;
		for (auto& row : weights.biomes) {
			row.fill(1);
		}
		for (auto& row : weights.tiers) {
			row.fill(1);
		}

		JsonReader classes = reader.requireObject("classes");
		for (const auto& [name, roadClass] : kRoadClassNames) {
			JsonReader row = classes.requireObject(name);
			weights.classes[static_cast<size_t>(roadClass)] = readRow(row, 0);
		}
		classes.finish();
		for (auto& [name, row] : reader.requireEntries("biomes")) {
			weights.biomes[static_cast<size_t>(reader.enumNamed("biomes", name, kBiomeNames))] = readRow(row, 1);
		}
		for (auto& [name, row] : reader.requireEntries("tiers")) {
			int tier = 0;
			for (int each = 1; each <= kStopTiers; ++each) {
				tier = name == std::to_string(each) ? each : tier;
			}
			if (tier == 0) {
				reader.failAt("tiers", "\"" + name + "\" is not a tier from 1 to " + std::to_string(kStopTiers));
			}
			weights.tiers[static_cast<size_t>(tier - 1)] = readRow(row, 1);
		}
		std::vector<std::string> territories;
		for (auto& [name, row] : reader.requireEntries("territories")) {
			territories.push_back(name);
			weights.territories.push_back(readRow(row, 1));
		}
		if (std::ranges::find(territories, kNoTerritory) == territories.end()) {
			reader.failAt("territories", "must hold \"" + std::string(kNoTerritory) + "\", the ground no stronghold claims");
		}
		reader.finish();
		return {weights, std::move(territories), file.generic_string()};
	}

} // namespace rules::map
