#include "PoiData.h"

#include "ContentReading.h"

#include <algorithm>
#include <set>
#include <string>
#include <utility>

namespace rules::map {

	namespace {

		SiteCondition readCondition(JsonReader& reader) {
			SiteCondition condition;
			const auto	  optionalNumber = [&](std::string_view key) -> std::optional<double> {
				   if (!reader.has(key)) {
					   return std::nullopt;
				   }
				   return reader.requireNumber(key);
			};
			condition.ruinAtLeast = optionalNumber("ruinAtLeast");
			condition.elevationBelow = optionalNumber("elevationBelow");
			condition.moistureAtLeast = optionalNumber("moistureAtLeast");
			if (reader.has("biomes")) {
				std::vector<Biome> biomes;
				for (const std::string& name : reader.requireStrings("biomes")) {
					biomes.push_back(reader.enumNamed("biomes", name, kBiomeNames));
				}
				if (biomes.empty()) {
					reader.failAt("biomes", "must name a biome");
				}
				condition.biomes = std::move(biomes);
			}
			if (reader.has("highwayWithin")) {
				condition.highwayWithin = readAtLeast(reader, "highwayWithin", 0);
			}
			reader.finish();
			return condition;
		}

		bool everywhere(const SiteCondition& condition) {
			return !condition.ruinAtLeast && !condition.elevationBelow && !condition.moistureAtLeast && !condition.biomes &&
				   !condition.highwayWithin;
		}

	} // namespace

	PoiTuning readPoiTuning(const std::filesystem::path& file) {
		const nlohmann::json json = readJsonFile(file);
		JsonReader			 reader(json, file.generic_string());
		PoiTuning			 tuning;

		JsonReader strongholds = reader.requireObject("strongholds");
		JsonReader band = strongholds.requireObject("band");
		tuning.strongholds.inner = readShare(band, "inner");
		tuning.strongholds.outer = readShare(band, "outer");
		if (tuning.strongholds.outer <= tuning.strongholds.inner) {
			band.failAt("outer", "must be past inner");
		}
		band.finish();
		tuning.strongholds.spacing = readShare(strongholds, "spacing");
		tuning.strongholds.rotationSteps = readIntAtLeast(strongholds, "rotationSteps", 1);
		tuning.strongholds.fitRadius = readAtLeast(strongholds, "fitRadius", 0);
		tuning.strongholds.fitJitter = readAtLeast(strongholds, "fitJitter", 0);
		strongholds.finish();

		JsonReader rings = reader.requireObject("rings");
		tuning.rings.outer = readShare(rings, "outer");
		tuning.rings.targets = rings.requireInts("targets");
		if (tuning.rings.targets.empty() || std::ranges::any_of(tuning.rings.targets, [](int target) { return target < 0; })) {
			rings.failAt("targets", "must list a target of 0 or more for at least one ring");
		}
		rings.finish();

		JsonReader sites = reader.requireObject("sites");
		tuning.sites.spacing = readShare(sites, "spacing");
		tuning.sites.step = readAtLeast(sites, "step", 1);
		tuning.sites.margin = readAtLeast(sites, "margin", 0);
		tuning.sites.marginShare = readShare(sites, "marginShare");
		if (tuning.sites.marginShare >= 0.5) {
			sites.failAt("marginShare", "must leave the middle of a stretch: under 0.5");
		}
		sites.finish();

		JsonReader score = reader.requireObject("score");
		tuning.score.noise = readAtLeast(score, "noise", 0);
		tuning.score.ruin = readAtLeast(score, "ruin", 0);
		tuning.score.highway = readAtLeast(score, "highway", 0);
		tuning.score.highwayWithin = readAtLeast(score, "highwayWithin", 0);
		tuning.score.threeWay = readAtLeast(score, "threeWay", 0);
		score.finish();

		for (auto& [id, type] : reader.requireEntries("types")) {
			if (id == kStrongholdType) {
				reader.failAt("types", "can't define " + std::string(kStrongholdType) + ", which is a stronghold's own");
			}
			PoiType	   read{.label = type.requireString("label"), .yields = {}};
			JsonReader yields = type.requireObject("yields");
			for (const auto& [name, resource] : kResourceNames) {
				if (yields.has(name)) {
					read.yields[static_cast<size_t>(resource)] = readIntAtLeast(yields, name, 1);
				}
			}
			yields.finish();
			type.finish();
			tuning.types.emplace(id, std::move(read));
		}

		std::set<Resource> covered;
		for (const std::string& name : reader.requireStrings("cover")) {
			const Resource resource = reader.enumNamed("cover", name, kResourceNames);
			if (!covered.insert(resource).second) {
				reader.failAt("cover", "lists " + name + " twice");
			}
			const bool yielded = std::ranges::any_of(tuning.types, [&](const auto& entry) {
				return entry.second.yields[static_cast<size_t>(resource)] > 0;
			});
			if (!yielded) {
				reader.failAt("cover", "lists " + name + ", which no type yields");
			}
			tuning.cover.push_back(resource);
		}

		for (JsonReader& rule : reader.requireObjects("placement")) {
			PlacementRule read{.types = rule.requireStrings("types"), .where = {}};
			if (read.types.empty()) {
				rule.failAt("types", "must name a type");
			}
			for (const std::string& type : read.types) {
				if (!tuning.types.contains(type)) {
					rule.failAt("types", "names " + type + ", which isn't a type");
				}
			}
			for (JsonReader& condition : rule.requireObjects("where")) {
				read.where.push_back(readCondition(condition));
			}
			if (read.where.empty()) {
				rule.failAt("where", "must give a condition");
			}
			rule.finish();
			tuning.placement.push_back(std::move(read));
		}
		if (tuning.placement.empty() || !std::ranges::any_of(tuning.placement.back().where, everywhere)) {
			reader.failAt("placement", "must end with a rule that holds everywhere, a condition {}");
		}
		reader.finish();
		return tuning;
	}

	std::vector<Faction> readFactions(const std::filesystem::path& file) {
		const nlohmann::json json = readJsonFile(file);
		JsonReader			 reader(json, file.generic_string());
		std::vector<Faction> factions;
		for (const auto& [key, value] : json.items()) {
			JsonReader faction = reader.requireObject(key);
			Faction	   read{.id = key, .label = faction.requireString("label"), .biomes = {}, .ruin = 0};
			JsonReader terrain = faction.requireObject("terrain");
			JsonReader biomes = terrain.requireObject("biomes");
			for (const auto& [name, biome] : kBiomeNames) {
				if (biomes.has(name)) {
					read.biomes[static_cast<size_t>(biome)] = readAtLeast(biomes, name, 0);
				}
			}
			biomes.finish();
			read.ruin = readAtLeast(terrain, "ruin", 0);
			terrain.finish();
			faction.finish();
			factions.push_back(std::move(read));
		}
		if (factions.empty()) {
			reader.fail("must define a faction");
		}
		reader.finish();
		return factions;
	}

} // namespace rules::map
