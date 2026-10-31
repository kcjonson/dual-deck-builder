#include "FightsConfig.h"

#include <ai/OpponentPolicies.h>

#include <rules/battle/Battle.h>
#include <rules/battle/Encounters.h>
#include <rules/campaign/Founding.h>
#include <rules/core/ContentError.h>
#include <rules/core/Encounter.h>
#include <rules/core/JsonReader.h>

#include <algorithm>
#include <stdexcept>

namespace sim {

	namespace {

		using rules::campaign::CardCounts;

		[[noreturn]] void failAt(const std::string& path, const std::string& message) {
			throw rules::ContentError(path + " " + message);
		}

		CardCounts
		readCards(const nlohmann::json& counts, const std::string& path, const rules::DriverId& archetype, const rules::Content& content) {
			if (!counts.is_object()) {
				failAt(path, "must be an object of card counts by id");
			}
			CardCounts cards;
			for (const auto& [id, count] : counts.items()) {
				const std::string at = path + "." + id;
				const auto		  found = content.cards.find(rules::CardId{id});
				if (found == content.cards.end()) {
					failAt(at, "is no card a loaded pack defines");
				}
				if (found->second.signatureOf) {
					failAt(at, "is an escort's signature card, which only its escort brings");
				}
				if (found->second.driverRestriction && *found->second.driverRestriction != archetype) {
					failAt(at, "is marked for " + found->second.driverRestriction->value + ", not " + archetype.value);
				}
				if (!count.is_number_integer() || count.get<int64_t>() < 1 || count.get<int64_t>() > 99) {
					failAt(at, "must be a whole number of copies from 1 to 99");
				}
				cards.emplace(found->first, static_cast<int>(count.get<int64_t>()));
			}
			return cards;
		}

		rules::DriverId archetypeNamed(const std::string& id, const std::string& path, const rules::Content& content) {
			const rules::DriverId archetype{id};
			if (!content.drivers.contains(archetype)) {
				failAt(path, "\"" + id + "\" is no archetype a loaded pack defines");
			}
			return archetype;
		}

		SeatConfig readSeat(const nlohmann::json& seat, const std::string& path, const rules::Content& content) {
			if (seat.is_string()) {
				return SeatConfig{.archetype = archetypeNamed(seat.get<std::string>(), path, content)};
			}
			if (!seat.is_object()) {
				failAt(path, "must be an archetype's id or an object naming one");
			}
			rules::JsonReader reader(seat, path);
			SeatConfig		  read{.archetype = archetypeNamed(reader.requireString("archetype"), path + ".archetype", content)};
			if (reader.has("deck")) {
				read.deck = readCards(reader.requireValue("deck"), path + ".deck", read.archetype, content);
				if (read.deck->empty()) {
					failAt(path + ".deck", "holds no cards");
				}
			}
			if (reader.has("add")) {
				read.add = readCards(reader.requireValue("add"), path + ".add", read.archetype, content);
			}
			reader.finish();
			return read;
		}

		CrewConfig readCrew(const nlohmann::json& crew, const std::string& path, const rules::Content& content) {
			if (!crew.is_array() || crew.empty() || crew.size() > 2) {
				failAt(path, "must be a list of one or two seats");
			}
			CrewConfig seats;
			for (size_t index = 0; index < crew.size(); ++index) {
				seats.push_back(readSeat(crew[index], path + "[" + std::to_string(index) + "]", content));
			}
			if (seats.size() == 2 && seats[0].archetype == seats[1].archetype) {
				failAt(path, "seats two " + seats[0].archetype.value + "s, and a pair is two different archetypes");
			}
			return seats;
		}

		std::vector<CrewConfig> readCrews(rules::JsonReader& reader, const rules::Content& content) {
			const std::string	  where = reader.where() + ".crews";
			const nlohmann::json& crews = reader.has("crews") ? reader.requireValue("crews") : nlohmann::json("all");
			if (crews.is_array()) {
				if (reader.has("archetypes")) {
					reader.failAt("archetypes", "only says what \"all\", \"pairs\", and \"solo\" draw from, and the crews are listed");
				}
				if (crews.empty()) {
					failAt(where, "lists no crews");
				}
				std::vector<CrewConfig> read;
				for (size_t index = 0; index < crews.size(); ++index) {
					read.push_back(readCrew(crews[index], where + "[" + std::to_string(index) + "]", content));
				}
				return read;
			}
			const std::string kind = crews.is_string() ? crews.get<std::string>() : "";
			if (kind != "all" && kind != "pairs" && kind != "solo") {
				failAt(where, "must be \"all\", \"pairs\", \"solo\", or a list of crews");
			}
			std::vector<rules::DriverId> archetypes;
			if (reader.has("archetypes")) {
				const std::vector<std::string> ids = reader.requireStrings("archetypes");
				for (size_t index = 0; index < ids.size(); ++index) {
					const rules::DriverId archetype =
						archetypeNamed(ids[index], reader.where() + ".archetypes[" + std::to_string(index) + "]", content);
					if (std::ranges::find(archetypes, archetype) != archetypes.end()) {
						reader.failAt("archetypes", "names " + ids[index] + " twice");
					}
					archetypes.push_back(archetype);
				}
			} else {
				archetypes = rules::campaign::unlockedAtStart(content);
			}
			std::vector<CrewConfig> dealt;
			if (kind != "solo") {
				for (size_t first = 0; first < archetypes.size(); ++first) {
					for (size_t second = first + 1; second < archetypes.size(); ++second) {
						dealt.push_back({SeatConfig{.archetype = archetypes[first]}, SeatConfig{.archetype = archetypes[second]}});
					}
				}
			}
			if (kind != "pairs") {
				for (const rules::DriverId& archetype : archetypes) {
					dealt.push_back({SeatConfig{.archetype = archetype}});
				}
			}
			if (dealt.empty()) {
				failAt(where, "makes no crews from " + std::to_string(archetypes.size()) + " archetypes");
			}
			return dealt;
		}

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

		rules::Behavior readStandIn(rules::JsonReader& reader) {
			if (!reader.has("standIn")) {
				return rules::Behavior{.policy = "aggressive_flanker"};
			}
			rules::JsonReader standIn = reader.requireObject("standIn");
			rules::Behavior	  behavior{.policy = standIn.requireString("policy")};
			if (standIn.has("weights")) {
				const nlohmann::json& weights = standIn.requireValue("weights");
				if (!weights.is_object()) {
					standIn.failAt("weights", "must be an object of numbers by name");
				}
				for (const auto& [name, value] : weights.items()) {
					if (!value.is_number()) {
						failAt(standIn.where() + ".weights." + name, "must be a number");
					}
					behavior.weights.emplace(name, value.get<double>());
				}
			}
			behavior.difficulty = standIn.optionalString("difficulty").value_or("");
			standIn.finish();
			try {
				(void)ai::makePolicy(behavior, rules::Side::Player);
			} catch (const std::invalid_argument& error) {
				standIn.fail(std::string("isn't a player's stand-in: ") + error.what());
			}
			return behavior;
		}

		int readAtLeast(rules::JsonReader& reader, std::string_view key, int least, int fallback) {
			const int value = reader.optionalInt(key).value_or(fallback);
			if (value < least) {
				reader.failAt(key, "must be " + std::to_string(least) + " or more");
			}
			return value;
		}

		nlohmann::json cardsJson(const CardCounts& cards) {
			nlohmann::json counts = nlohmann::json::object();
			for (const auto& [card, count] : cards) {
				counts[card.value] = count;
			}
			return counts;
		}

	} // namespace

	FightsConfig readFightsConfig(const nlohmann::json& config, const std::string& where, const rules::Content& content) {
		rules::JsonReader reader(config, where);
		FightsConfig	  read;
		read.seed = static_cast<uint32_t>(readAtLeast(reader, "seed", 0, 1));
		read.runs = readAtLeast(reader, "runs", 1, 100);
		read.crews = readCrews(reader, content);
		read.tier = reader.optionalInt("tier").value_or(1);
		if (read.tier < 1 || read.tier > rules::kMostTier) {
			reader.failAt("tier", "must be from 1 to " + std::to_string(rules::kMostTier));
		}
		read.routes = readRoutes(reader, read.tier, content);
		if (reader.has("stages")) {
			read.stages = reader.requireInts("stages");
			if (read.stages.empty()) {
				reader.failAt("stages", "lists no stages");
			}
			for (size_t index = 0; index < read.stages.size(); ++index) {
				const int stage = read.stages[index];
				if (stage < 0 || stage > rules::kMostStage) {
					reader.failAt(
						"stages", "holds " + std::to_string(stage) + ", and game stage runs 0 to " + std::to_string(rules::kMostStage)
					);
				}
				if (std::ranges::count(read.stages, stage) > 1) {
					reader.failAt("stages", "holds " + std::to_string(stage) + " twice");
				}
			}
		}
		read.turns = readAtLeast(reader, "turns", 1, 25);
		read.standIn = readStandIn(reader);
		reader.finish();
		return read;
	}

	nlohmann::json crewJson(const CrewConfig& crew) {
		nlohmann::json seats = nlohmann::json::array();
		for (const SeatConfig& seat : crew) {
			if (!seat.deck && seat.add.empty()) {
				seats.push_back(seat.archetype.value);
				continue;
			}
			nlohmann::json written{{"archetype", seat.archetype.value}};
			if (seat.deck) {
				written["deck"] = cardsJson(*seat.deck);
			}
			if (!seat.add.empty()) {
				written["add"] = cardsJson(seat.add);
			}
			seats.push_back(std::move(written));
		}
		return seats;
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
		nlohmann::json standIn{{"policy", config.standIn.policy}};
		if (!config.standIn.weights.empty()) {
			standIn["weights"] = config.standIn.weights;
		}
		if (!config.standIn.difficulty.empty()) {
			standIn["difficulty"] = config.standIn.difficulty;
		}
		return nlohmann::json{
			{"seed", config.seed},
			{"runs", config.runs},
			{"crews", std::move(crews)},
			{"routes", std::move(routes)},
			{"tier", config.tier},
			{"stages", config.stages},
			{"turns", config.turns},
			{"standIn", std::move(standIn)},
		};
	}

	CardCounts deckOf(const SeatConfig& seat, const rules::Content& content) {
		CardCounts deck;
		if (seat.deck) {
			deck = *seat.deck;
		} else {
			for (const rules::DeckEntry& entry : content.drivers.at(seat.archetype).startingDeck) {
				rules::campaign::addCards(deck, entry.card, entry.count);
			}
		}
		rules::campaign::addCards(deck, seat.add);
		return deck;
	}

} // namespace sim
