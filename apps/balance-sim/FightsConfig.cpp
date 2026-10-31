#include "FightsConfig.h"

#include <rules/battle/Encounters.h>
#include <rules/core/ContentError.h>
#include <rules/core/Encounter.h>
#include <rules/core/JsonReader.h>

#include <string>

namespace sim {

	namespace {

		FightStep readStep(const nlohmann::json& step, const std::string& path, int tier, const rules::Content& content) {
			if (step.is_string()) {
				const rules::EncounterId id{step.get<std::string>()};
				const auto				 found = content.encounters.find(id);
				if (found == content.encounters.end()) {
					failAt(path, "\"" + id.value + "\" is no encounter a loaded pack defines");
				}
				return FightStep{.skulls = found->second.skulls, .encounter = id};
			}
			if (!step.is_number_integer() || step.get<int64_t>() < 1 || step.get<int64_t>() > rules::kMostSkulls) {
				failAt(path, "must be a skull count from 1 to " + std::to_string(rules::kMostSkulls) + " or an encounter's id");
			}
			const int skulls = static_cast<int>(step.get<int64_t>());
			if (rules::encountersFor(content, skulls, tier).empty()) {
				failAt(
					path,
					"asks for a " + std::to_string(skulls) + "-skull fight, and no loaded pack has one at tier " + std::to_string(tier)
				);
			}
			return FightStep{.skulls = skulls};
		}

		std::vector<RouteConfig> readRoutes(rules::JsonReader& reader, int tier, const rules::Content& content) {
			if (!reader.has("routes")) {
				return {{FightStep{.skulls = 1}}, {FightStep{.skulls = 2}}, {FightStep{.skulls = 3}}};
			}
			const std::string	  where = reader.where() + ".routes";
			const nlohmann::json& routes = reader.requireValue("routes");
			if (!routes.is_array() || routes.empty()) {
				failAt(where, "must be a list of routes");
			}
			std::vector<RouteConfig> read;
			for (size_t index = 0; index < routes.size(); ++index) {
				const std::string	  path = where + "[" + std::to_string(index) + "]";
				const nlohmann::json& route = routes[index];
				if (!route.is_array() || route.empty()) {
					failAt(path, "must be a list of one or more fights");
				}
				RouteConfig steps;
				for (size_t step = 0; step < route.size(); ++step) {
					steps.push_back(readStep(route[step], path + "[" + std::to_string(step) + "]", tier, content));
				}
				read.push_back(std::move(steps));
			}
			return read;
		}

	} // namespace

	FightsConfig readFightsConfig(const nlohmann::json& config, const std::string& where, const rules::Content& content) {
		rules::JsonReader reader(config, where);
		FightsConfig	  read;
		read.seed = static_cast<uint32_t>(readAtLeast(reader, "seed", 0, 1));
		read.runs = readAtLeast(reader, "runs", 1, 100);
		read.crews = readCrews(reader, content, "all");
		read.tier = reader.optionalInt("tier").value_or(1);
		if (read.tier < 1 || read.tier > rules::kMostTier) {
			reader.failAt("tier", "must be from 1 to " + std::to_string(rules::kMostTier));
		}
		read.routes = readRoutes(reader, read.tier, content);
		read.stages = readStages(reader);
		read.turns = readAtLeast(reader, "turns", 1, 25);
		read.standIn = readStandIn(reader);
		reader.finish();
		return read;
	}

	nlohmann::json routeJson(const RouteConfig& route) {
		nlohmann::json steps = nlohmann::json::array();
		for (const FightStep& step : route) {
			steps.push_back(step.encounter ? nlohmann::json(step.encounter->value) : nlohmann::json(step.skulls));
		}
		return steps;
	}

	nlohmann::json fightsConfigJson(const FightsConfig& config) {
		nlohmann::json crews = nlohmann::json::array();
		for (const CrewConfig& crew : config.crews) {
			crews.push_back(crewJson(crew));
		}
		nlohmann::json routes = nlohmann::json::array();
		for (const RouteConfig& route : config.routes) {
			routes.push_back(routeJson(route));
		}
		return nlohmann::json{
			{"seed", config.seed},
			{"runs", config.runs},
			{"crews", std::move(crews)},
			{"routes", std::move(routes)},
			{"tier", config.tier},
			{"stages", config.stages},
			{"turns", config.turns},
			{"standIn", standInJson(config.standIn)},
		};
	}

} // namespace sim
