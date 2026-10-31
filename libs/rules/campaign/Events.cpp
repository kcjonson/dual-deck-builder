#include "Events.h"

#include "CampaignJson.h"

#include <rules/battle/Encounters.h>
#include <rules/core/ContentError.h>
#include <rules/core/JsonReader.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <stdexcept>
#include <utility>

namespace rules::campaign {

	namespace {

		namespace fs = std::filesystem;

		// Bounds on content, so a slip in a file fails as it loads. The text has none: the TypeScript's caps were what
		// its screen held at 1024x600, and the event scene will set its own.
		constexpr size_t kFewestChoices = 2;
		constexpr size_t kMostChoices = 4;
		constexpr size_t kMostOutcomes = 4;
		constexpr int	 kMostResource = 30;
		constexpr int	 kMostSettlers = 8;
		constexpr int	 kMostDrivers = 2;
		constexpr int	 kMostDamage = 20;
		constexpr double kMostHours = 6;
		constexpr int	 kMostDanger = 3;
		constexpr int	 kMostCopies = 3;
		constexpr int	 kMostWeight = 100;

		// The stores an event moves, by name: the compound's but people, which it gives as settlers.
		constexpr std::array<std::pair<std::string_view, int Resources::*>, 5> kEventResources{{
			{"food", &Resources::food},
			{"water", &Resources::water},
			{"fuel", &Resources::fuel},
			{"meds", &Resources::meds},
			{"scrap", &Resources::scrap},
		}};

		// The .json files directly in `folder`, sorted, so packs load the same everywhere. Anything else in it fails,
		// since nothing would read it.
		std::vector<fs::path> jsonFilesIn(const fs::path& folder) {
			std::vector<fs::path> files;
			if (!fs::is_directory(folder)) {
				return files;
			}
			for (const fs::directory_entry& entry : fs::directory_iterator(folder)) {
				if (!entry.is_regular_file() || entry.path().extension() != ".json") {
					throw ContentError(
						entry.path().generic_string() + " isn't a .json file, and nothing in " + folder.generic_string() + " reads it"
					);
				}
				files.push_back(entry.path());
			}
			std::ranges::sort(files);
			return files;
		}

		std::string readId(JsonReader& reader, std::string_view key) {
			std::string id = reader.requireString(key);
			const auto	inName = [](char letter) {
				 return (letter >= 'a' && letter <= 'z') || (letter >= '0' && letter <= '9') || letter == '_';
			};
			if (id.empty() || id.front() < 'a' || id.front() > 'z' || !std::ranges::all_of(id, inName)) {
				reader.failAt(key, "must be lower snake case, got \"" + id + "\"");
			}
			return id;
		}

		std::string readText(JsonReader& reader, std::string_view key) {
			std::string text = reader.requireString(key);
			if (text.empty()) {
				reader.failAt(key, "must say something");
			}
			return text;
		}

		// {"fuel": 3}: a resource at least, none at 0, a loss signed where `losses` lets one in.
		void readChanges(JsonReader reader, bool losses, Resources& gained, Resources& lost) {
			bool named = false;
			for (const auto& [name, field] : kEventResources) {
				const std::optional<int> amount = reader.optionalInt(name);
				if (!amount) {
					continue;
				}
				named = true;
				if (*amount == 0 || *amount > kMostResource || *amount < (losses ? -kMostResource : 1)) {
					reader.failAt(
						name,
						losses ? "must be a whole number from -" + std::to_string(kMostResource) + " to " + std::to_string(kMostResource) +
									 ", not 0; leave it out otherwise"
							   : "must be a whole number from 1 to " + std::to_string(kMostResource)
					);
				}
				(*amount > 0 ? gained : lost).*field = std::abs(*amount);
			}
			reader.finish();
			if (!named) {
				reader.fail("must name a resource; leave it out otherwise");
			}
		}

		// {"medical_kit": 1}: each a card a loaded pack defines and no escort's signature card, a few copies at most.
		CardCounts readCards(JsonReader& reader, const Content& content) {
			const nlohmann::json& object = reader.requireValue("cards");
			if (!object.is_object() || object.empty()) {
				reader.failAt("cards", "must be an object of card counts naming a card; leave it out otherwise");
			}
			CardCounts cards;
			for (const auto& [name, count] : object.items()) {
				const std::string at = "cards." + name;
				if (!count.is_number_integer() || count < 1 || count > kMostCopies) {
					reader.failAt(at, "must be a whole number from 1 to " + std::to_string(kMostCopies));
				}
				const auto card = content.cards.find(CardId{name});
				if (card == content.cards.end()) {
					reader.failAt(at, "names a card no loaded pack defines");
				}
				if (card->second.signatureOf) {
					reader.failAt(at, "is the " + card->second.signatureOf->value + " escort's signature card, which only it brings");
				}
				cards.emplace(card->first, count.get<int>());
			}
			return cards;
		}

		int readDamage(JsonReader& reader, std::string_view key, bool gainsOnly) {
			const std::optional<int> amount = reader.optionalInt(key);
			if (!amount) {
				return 0;
			}
			if (*amount == 0 || *amount > kMostDamage || *amount < (gainsOnly ? 1 : -kMostDamage)) {
				reader.failAt(
					key,
					gainsOnly ? "must be a gain from 1 to " + std::to_string(kMostDamage) + ", since winning the fight gives it"
							  : "must be a whole number from -" + std::to_string(kMostDamage) + " to " + std::to_string(kMostDamage) +
									", not 0; leave it out otherwise"
				);
			}
			return *amount;
		}

		// An outcome's fields, or a fight's, which are gains only, the fight being the cost.
		EventGains readGains(JsonReader& reader, const Content& content, bool fight) {
			EventGains gains;
			if (std::optional<JsonReader> resources = reader.optionalObject("resources")) {
				readChanges(std::move(*resources), !fight, gains.gained, gains.lost);
			}
			if (const std::optional<int> settlers = reader.optionalInt("settlers")) {
				if (*settlers < 1 || *settlers > kMostSettlers) {
					reader.failAt("settlers", "must be a whole number from 1 to " + std::to_string(kMostSettlers));
				}
				gains.gained.people = *settlers;
			}
			if (reader.has("cards")) {
				gains.cards = readCards(reader, content);
			}
			if (reader.has("cardPick")) {
				if (fight) {
					reader.failAt("cardPick", "can't be a fight's, whose win opens the reward anyway");
				}
				if (!reader.requireBool("cardPick")) {
					reader.failAt("cardPick", "must be true when given; leave it out otherwise");
				}
				gains.cardPick = true;
			}
			if (const std::optional<std::string> escort = reader.optionalString("escort")) {
				if (!content.escorts.contains(EscortId{*escort})) {
					reader.failAt("escort", "names escort " + *escort + ", which no loaded pack defines");
				}
				gains.escort = EscortId{*escort};
			}
			if (const std::optional<int> drivers = reader.optionalInt("drivers")) {
				if (*drivers < 1 || *drivers > kMostDrivers) {
					reader.failAt("drivers", "must be a whole number from 1 to " + std::to_string(kMostDrivers));
				}
				gains.drivers = *drivers;
			}
			gains.structure = readDamage(reader, "structure", fight);
			gains.hp = readDamage(reader, "hp", fight);
			return gains;
		}

		EventFight readFight(JsonReader reader, const Content& content) {
			EventFight fight;
			fight.skulls = requireIntIn(reader, "skulls", 1, kMostSkulls);
			fight.text = readText(reader, "text");
			fight.won = readGains(reader, content, true);
			reader.finish();
			for (int tier = 1; tier <= map::kStopTiers; ++tier) {
				if (encountersFor(content, fight.skulls, tier).empty()) {
					reader.failAt(
						"skulls",
						"is " + std::to_string(fight.skulls) + ", and no loaded pack has an encounter of it at tier " + std::to_string(tier)
					);
				}
			}
			return fight;
		}

		EventOutcome readOutcome(JsonReader& reader, const Content& content) {
			EventOutcome outcome;
			if (const std::optional<int> weight = reader.optionalInt("weight")) {
				if (*weight < 1 || *weight > kMostWeight) {
					reader.failAt("weight", "must be a whole number from 1 to " + std::to_string(kMostWeight));
				}
				outcome.weight = *weight;
			}
			outcome.text = readText(reader, "text");
			if (reader.has("hours")) {
				const double hours = reader.requireNumber("hours");
				if (!(hours > 0 && hours <= kMostHours && std::floor(hours * 2) == hours * 2)) {
					reader.failAt(
						"hours", "must be a whole number of half hours from 0.5 to " + std::to_string(static_cast<int>(kMostHours))
					);
				}
				outcome.hours = hours;
			}
			outcome.gains = readGains(reader, content, false);
			if (std::optional<JsonReader> fight = reader.optionalObject("fight")) {
				if (outcome.gains.cardPick) {
					reader.failAt("fight", "comes with cardPick, and the fight's win opens the reward anyway");
				}
				outcome.fight = readFight(std::move(*fight), content);
			}
			reader.finish();
			return outcome;
		}

		EventNeeds readNeeds(JsonReader reader, const Content& content) {
			EventNeeds needs;
			if (std::optional<std::string> archetype = reader.optionalString("archetype")) {
				if (!content.drivers.contains(DriverId{*archetype})) {
					reader.failAt("archetype", "names driver " + *archetype + ", which no loaded pack defines");
				}
				needs.archetype = DriverId{std::move(*archetype)};
			}
			if (std::optional<std::string> card = reader.optionalString("card")) {
				if (!content.cards.contains(CardId{*card})) {
					reader.failAt("card", "names card " + *card + ", which no loaded pack defines");
				}
				needs.card = CardId{std::move(*card)};
			}
			if (std::optional<std::string> escort = reader.optionalString("escort")) {
				if (!content.escorts.contains(EscortId{*escort})) {
					reader.failAt("escort", "names escort " + *escort + ", which no loaded pack defines");
				}
				needs.escort = EscortId{std::move(*escort)};
			}
			reader.finish();
			if (!needs.archetype && !needs.card && !needs.escort) {
				reader.fail("must need something, an archetype, a card, or an escort; leave it out otherwise");
			}
			return needs;
		}

		EventChoice readChoice(JsonReader& reader, const Content& content) {
			EventChoice choice;
			choice.id = readId(reader, "id");
			choice.title = readText(reader, "title");
			choice.preview = readText(reader, "preview");
			if (std::optional<JsonReader> needs = reader.optionalObject("requires")) {
				choice.needs = readNeeds(std::move(*needs), content);
			}
			if (std::optional<JsonReader> cost = reader.optionalObject("cost")) {
				Resources none;
				readChanges(std::move(*cost), false, choice.cost, none);
			}
			choice.danger = requireIntIn(reader, "danger", 0, kMostDanger);
			std::vector<JsonReader> outcomes = reader.requireObjects("outcomes");
			if (outcomes.empty() || outcomes.size() > kMostOutcomes) {
				reader.failAt("outcomes", "must hold 1 to " + std::to_string(kMostOutcomes) + " outcomes");
			}
			for (JsonReader& outcome : outcomes) {
				choice.outcomes.push_back(readOutcome(outcome, content));
			}
			reader.finish();
			return choice;
		}

		EventDefinition readEvent(JsonReader& reader, const Content& content, const PackId& pack) {
			EventDefinition event;
			event.id = EventId{readId(reader, "id")};
			event.pack = pack;
			event.stopType = reader.requireEnum("stopType", map::kStopTypeNames);
			if (!resolvesAsEvent(event.stopType)) {
				reader.failAt("stopType", "isn't a stop the run resolves as an event, which wreck and distress are");
			}
			event.title = readText(reader, "title");
			JsonReader illustration = reader.requireObject("illustration");
			event.art = readId(illustration, "art");
			event.caption = readText(illustration, "caption");
			illustration.finish();
			event.setup = readText(reader, "setup");
			event.situation = readText(reader, "situation");
			std::vector<JsonReader> choices = reader.requireObjects("choices");
			if (choices.size() < kFewestChoices || choices.size() > kMostChoices) {
				reader.failAt(
					"choices", "must hold " + std::to_string(kFewestChoices) + " to " + std::to_string(kMostChoices) + " choices"
				);
			}
			for (JsonReader& object : choices) {
				EventChoice choice = readChoice(object, content);
				if (std::ranges::find(event.choices, choice.id, &EventChoice::id) != event.choices.end()) {
					object.failAt("id", "is " + choice.id + ", which an earlier choice in the event is");
				}
				event.choices.push_back(std::move(choice));
			}
			reader.finish();
			if (std::ranges::none_of(event.choices, isFree)) {
				reader.failAt("choices", "must hold a choice that needs nothing and costs nothing, so no party is stuck at the stop");
			}
			return event;
		}

	} // namespace

	Events loadEvents(const Content& content) {
		Events						   events;
		std::map<EventId, std::string> files;
		for (const PackManifest& pack : content.packs) {
			for (const fs::path& path : jsonFilesIn(pack.root / "events")) {
				const std::string	 file = path.generic_string();
				const nlohmann::json json = readJsonFile(path);
				JsonReader			 reader(json, file);
				for (JsonReader& object : reader.requireObjects("events")) {
					EventDefinition event = readEvent(object, content, pack.id);
					const auto		earlier = events.find(event.id);
					if (earlier != events.end()) {
						const PackId& from = earlier->second.pack;
						if (from == pack.id) {
							throw ContentError(
								file + ": event " + event.id.value + " is defined twice in pack " + pack.id.value + ", here and in " +
								files.at(event.id)
							);
						}
						if (!packRequires(content, pack.id, from)) {
							throw ContentError(
								file + ": pack " + pack.id.value + " overrides event " + event.id.value + " from pack " + from.value +
								" without requiring " + from.value
							);
						}
					}
					files.insert_or_assign(event.id, file);
					events.insert_or_assign(event.id, std::move(event));
				}
				reader.finish();
			}
		}
		for (const auto& [name, type] : map::kStopTypeNames) {
			if (resolvesAsEvent(type) && eventsFor(events, type).empty()) {
				throw ContentError("no loaded pack has an event for a " + std::string(name) + " stop, which the run resolves as an event");
			}
		}
		return events;
	}

	std::vector<const EventDefinition*> eventsFor(const Events& events, map::StopType type) {
		std::vector<const EventDefinition*> found;
		for (const auto& [id, event] : events) {
			if (event.stopType == type) {
				found.push_back(&event);
			}
		}
		return found;
	}

	bool isFree(const EventChoice& choice) {
		return choice.needs == EventNeeds{} && choice.cost == Resources{};
	}

	const EventChoice& choiceOf(const EventDefinition& event, std::string_view choice) {
		const auto found = std::ranges::find(event.choices, choice, &EventChoice::id);
		if (found == event.choices.end()) {
			throw std::invalid_argument("event " + event.id.value + " has no choice " + std::string(choice));
		}
		return *found;
	}

} // namespace rules::campaign
