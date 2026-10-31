#pragma once

#include <rules/campaign/Campaign.h>
#include <rules/core/Ids.h>
#include <rules/core/JsonReader.h>
#include <rules/core/Opponent.h>
#include <rules/packs/Pack.h>

#include <nlohmann/json.hpp>

#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace sim {

	// What the fights and runs configs read alike (Balance Simulation, The fights config): the crews, the stages, the
	// stand-in, and a whole number with a floor, each failing as a ContentError naming the path in the file.

	// One seat of a crew: an archetype on its starting deck, on a deck given in its place, or with cards added to it.
	struct SeatConfig {
		rules::DriverId							   archetype;
		std::optional<rules::campaign::CardCounts> deck;
		rules::campaign::CardCounts				   add;

		bool operator==(const SeatConfig&) const = default;
	};

	// Seat 1 first: one driver, or two of different archetypes, as load out seats them.
	using CrewConfig = std::vector<SeatConfig>;

	[[noreturn]] void failAt(const std::string& path, const std::string& message);

	// `crews` and `archetypes`: "all" (every pair of different archetypes, then each alone), "pairs", "solo", or a list
	// of crews, each one or two seats, a seat an archetype's id or {"archetype", "deck", "add"}; `fallback` when left out.
	// `archetypes` says what the first three draw from, the archetypes the packs start unlocked when left out.
	[[nodiscard]] std::vector<CrewConfig> readCrews(rules::JsonReader& reader, const rules::Content& content, std::string_view fallback);

	// `stages`, each from 0 to 6 and once; [0] when left out.
	[[nodiscard]] std::vector<int> readStages(rules::JsonReader& reader);

	// `standIn`: {"policy", "weights", "difficulty"}, as an opponent's behavior names one, any policy the AI builds for
	// the player's side; the aggressive flanker when left out.
	[[nodiscard]] rules::Behavior readStandIn(rules::JsonReader& reader);

	// A whole number at `key`, `least` or more, `fallback` when left out.
	[[nodiscard]] int readAtLeast(rules::JsonReader& reader, std::string_view key, int least, int fallback);

	// A crew and a stand-in as a config writes them.
	[[nodiscard]] nlohmann::json crewJson(const CrewConfig& crew);
	[[nodiscard]] nlohmann::json standInJson(const rules::Behavior& standIn);

	// The crew's archetypes in seat order: `road_warrior+interceptor`.
	[[nodiscard]] std::string crewName(const CrewConfig& crew);

	// Each crew's name, one listed more than once, on other decks, adding `#` and its place in the crews from 1.
	[[nodiscard]] std::vector<std::string> crewLabels(std::span<const CrewConfig> crews);

	// The cards a seat brings to its run: its own deck or its archetype's starting deck, with what it adds.
	[[nodiscard]] rules::campaign::CardCounts deckOf(const SeatConfig& seat, const rules::Content& content);

} // namespace sim
