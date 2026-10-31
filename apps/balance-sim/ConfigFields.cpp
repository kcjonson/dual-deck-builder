#include "ConfigFields.h"

#include <ai/OpponentPolicies.h>

#include <rules/battle/Battle.h>
#include <rules/campaign/Founding.h>
#include <rules/core/ContentError.h>

#include <algorithm>
#include <limits>
#include <stdexcept>

namespace sim {

	namespace {

		using rules::campaign::CardCounts;

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

		nlohmann::json cardsJson(const CardCounts& cards) {
			nlohmann::json counts = nlohmann::json::object();
			for (const auto& [card, count] : cards) {
				counts[card.value] = count;
			}
			return counts;
		}

	} // namespace

	void failAt(const std::string& path, const std::string& message) {
		throw rules::ContentError(path + " " + message);
	}

	std::vector<CrewConfig> readCrews(rules::JsonReader& reader, const rules::Content& content, std::string_view fallback) {
		const std::string	  where = reader.where() + ".crews";
		const nlohmann::json& crews = reader.has("crews") ? reader.requireValue("crews") : nlohmann::json(std::string(fallback));
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

	std::vector<int> readStages(rules::JsonReader& reader) {
		if (!reader.has("stages")) {
			return {0};
		}
		std::vector<int> stages = reader.requireInts("stages");
		if (stages.empty()) {
			reader.failAt("stages", "lists no stages");
		}
		for (const int stage : stages) {
			if (stage < 0 || stage > rules::kMostStage) {
				reader.failAt(
					"stages", "holds " + std::to_string(stage) + ", and game stage runs 0 to " + std::to_string(rules::kMostStage)
				);
			}
			if (std::ranges::count(stages, stage) > 1) {
				reader.failAt("stages", "holds " + std::to_string(stage) + " twice");
			}
		}
		return stages;
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

	std::vector<uint32_t> readMaps(rules::JsonReader& reader, int fallback) {
		if (!reader.has("maps")) {
			std::vector<uint32_t> seeds;
			for (int seed = 1; seed <= fallback; ++seed) {
				seeds.push_back(static_cast<uint32_t>(seed));
			}
			return seeds;
		}
		const nlohmann::json& maps = reader.requireValue("maps");
		if (maps.is_number_integer()) {
			const int64_t count = maps.get<int64_t>();
			if (count < 1 || count > 1000) {
				reader.failAt("maps", "must be a count of maps from 1 to 1000, or a list of seeds");
			}
			std::vector<uint32_t> seeds;
			for (int64_t seed = 1; seed <= count; ++seed) {
				seeds.push_back(static_cast<uint32_t>(seed));
			}
			return seeds;
		}
		if (!maps.is_array() || maps.empty()) {
			reader.failAt("maps", "must be a count of maps, or a list of seeds");
		}
		std::vector<uint32_t> seeds;
		for (size_t index = 0; index < maps.size(); ++index) {
			const nlohmann::json& seed = maps[index];
			const std::string	  path = reader.where() + ".maps[" + std::to_string(index) + "]";
			if (!seed.is_number_integer() || seed.get<int64_t>() < 0 || seed.get<int64_t>() > std::numeric_limits<uint32_t>::max()) {
				failAt(path, "must be a seed, a whole number from 0");
			}
			const auto read = static_cast<uint32_t>(seed.get<int64_t>());
			if (std::ranges::find(seeds, read) != seeds.end()) {
				failAt(path, "is seed " + std::to_string(read) + " again");
			}
			seeds.push_back(read);
		}
		return seeds;
	}

	int readAtLeast(rules::JsonReader& reader, std::string_view key, int least, int fallback) {
		const int value = reader.optionalInt(key).value_or(fallback);
		if (value < least) {
			reader.failAt(key, "must be " + std::to_string(least) + " or more");
		}
		return value;
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

	nlohmann::json standInJson(const rules::Behavior& standIn) {
		nlohmann::json json{{"policy", standIn.policy}};
		if (!standIn.weights.empty()) {
			json["weights"] = standIn.weights;
		}
		if (!standIn.difficulty.empty()) {
			json["difficulty"] = standIn.difficulty;
		}
		return json;
	}

	std::string crewName(const CrewConfig& crew) {
		std::string name;
		for (const SeatConfig& seat : crew) {
			name += (name.empty() ? "" : "+") + seat.archetype.value;
		}
		return name;
	}

	std::vector<std::string> crewLabels(std::span<const CrewConfig> crews) {
		std::vector<std::string> names;
		for (const CrewConfig& crew : crews) {
			names.push_back(crewName(crew));
		}
		std::vector<std::string> labels;
		for (size_t crew = 0; crew < crews.size(); ++crew) {
			labels.push_back(names[crew] + (std::ranges::count(names, names[crew]) > 1 ? "#" + std::to_string(crew + 1) : ""));
		}
		return labels;
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
