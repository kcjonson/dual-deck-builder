#include "RunsConfig.h"

#include <rules/core/JsonReader.h>

#include <algorithm>
#include <string>

namespace sim {

	namespace {

		// The tiers a run can leave for: every one but the strongholds'.
		constexpr int kMostRunTier = 4;

		std::optional<int> readRoutes(rules::JsonReader& reader) {
			if (!reader.has("routes")) {
				return std::nullopt;
			}
			const nlohmann::json& routes = reader.requireValue("routes");
			if (routes.is_string() && routes.get<std::string>() == "all") {
				return std::nullopt;
			}
			if (!routes.is_number_integer() || routes.get<int64_t>() < 1 || routes.get<int64_t>() > 10000) {
				reader.failAt("routes", "must be \"all\" or how many of each map's routes to run, 1 or more");
			}
			return static_cast<int>(routes.get<int64_t>());
		}

		std::vector<int> readTiers(rules::JsonReader& reader) {
			if (!reader.has("tiers")) {
				return {1, 2, 3, 4};
			}
			std::vector<int> tiers = reader.requireInts("tiers");
			if (tiers.empty()) {
				reader.failAt("tiers", "lists no tiers");
			}
			for (const int tier : tiers) {
				if (tier == kMostRunTier + 1) {
					reader.failAt("tiers", "holds 5, the strongholds' routes, which no run leaves on until their boss fights exist");
				}
				if (tier < 1 || tier > kMostRunTier) {
					reader.failAt("tiers", "holds " + std::to_string(tier) + ", and a run's destination tier is 1 to 4");
				}
				if (std::ranges::count(tiers, tier) > 1) {
					reader.failAt("tiers", "holds " + std::to_string(tier) + " twice");
				}
			}
			return tiers;
		}

	} // namespace

	RunsConfig readRunsConfig(const nlohmann::json& config, const std::string& where, const rules::Content& content) {
		rules::JsonReader reader(config, where);
		RunsConfig		  read;
		read.maps = readMaps(reader, 1);
		read.runs = readAtLeast(reader, "runs", 1, 20);
		read.crews = readCrews(reader, content, "pairs");
		read.routes = readRoutes(reader);
		read.tiers = readTiers(reader);
		read.stages = readStages(reader);
		read.turns = readAtLeast(reader, "turns", 1, 25);
		read.standIn = readStandIn(reader);
		read.neighbor = reader.has("neighbor") ? reader.requireBool("neighbor") : true;
		reader.finish();
		return read;
	}

	nlohmann::json runsConfigJson(const RunsConfig& config) {
		nlohmann::json crews = nlohmann::json::array();
		for (const CrewConfig& crew : config.crews) {
			crews.push_back(crewJson(crew));
		}
		return nlohmann::json{
			{"maps", config.maps},
			{"runs", config.runs},
			{"crews", std::move(crews)},
			{"routes", config.routes ? nlohmann::json(*config.routes) : nlohmann::json("all")},
			{"tiers", config.tiers},
			{"stages", config.stages},
			{"turns", config.turns},
			{"standIn", standInJson(config.standIn)},
			{"neighbor", config.neighbor},
		};
	}

} // namespace sim
