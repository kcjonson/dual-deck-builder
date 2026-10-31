#include "CampaignRules.h"

#include "CampaignJson.h"
#include "CardOffers.h"

#include <rules/core/ContentError.h>
#include <rules/core/JsonReader.h>

#include <algorithm>
#include <array>
#include <filesystem>
#include <map>
#include <string>
#include <vector>

namespace rules::campaign {

	namespace {

		namespace fs = std::filesystem;

		constexpr std::string_view				  kStartFile = "start.json";
		constexpr std::string_view				  kDeckRulesFile = "deck-rules.json";
		constexpr std::string_view				  kCompoundRulesFile = "compound-rules.json";
		constexpr std::string_view				  kGarageRulesFile = "garage-rules.json";
		constexpr std::array<std::string_view, 4> kFiles{kStartFile, kDeckRulesFile, kCompoundRulesFile, kGarageRulesFile};

		// The ceiling on any one compound rule, far past tuning, so a slip in the file fails as it loads.
		constexpr int kMostRule = 1000;

		CampaignStart readStart(JsonReader reader, const Content& content) {
			CampaignStart start{
				.poolSize = requireIntIn(reader, "poolSize", 2, kMostRule),
				.stores = readResources(reader.requireObject("resources")),
				.escorts = {},
				.buildings = readBuildings(reader, "buildings"),
			};
			for (std::string& escort : reader.requireStrings("escorts")) {
				start.escorts.push_back(EscortId{std::move(escort)});
			}
			reader.finish();
			if (start.escorts.size() > kMostEscorts) {
				reader.failAt("escorts", "can hold at most " + std::to_string(kMostEscorts) + ", as many as the convoy takes");
			}
			for (const EscortId& escort : start.escorts) {
				if (!content.escorts.contains(escort)) {
					reader.failAt("escorts", "names escort " + escort.value + ", which no loaded pack defines");
				}
			}
			return start;
		}

		DeckRules readDeckRules(JsonReader reader) {
			JsonReader size = reader.requireObject("deckSize");
			const int  fewest = requireIntIn(size, "min", 1, kMostRule);
			DeckRules  rules{
				 .fewestCards = fewest,
				 .mostCards = requireIntIn(size, "max", fewest, kMostRule),
				 .scrapPerCard = requireIntIn(reader, "scrapPerCard", 0, kMostRule),
			 };
			size.finish();
			reader.finish();
			return rules;
		}

		// Fuel's least is at least 1, so every party brings some and the file can't be tuned into a soft-lock.
		HaulRange readHaul(JsonReader reader, int fewest) {
			const int least = requireIntIn(reader, "min", fewest, kMostRule);
			HaulRange haul{.least = least, .most = requireIntIn(reader, "max", least, kMostRule)};
			reader.finish();
			return haul;
		}

		// A chance in a hundred for each game stage, 0 to kMostStage.
		std::array<int, kMostStage + 1> readStageChances(JsonReader& reader, std::string_view key) {
			const std::vector<int> chances = reader.requireInts(key);
			if (chances.size() != static_cast<size_t>(kMostStage + 1) ||
				std::ranges::any_of(chances, [](int chance) { return chance < 0 || chance > 100; })) {
				reader.failAt(
					key, "must be " + std::to_string(kMostStage + 1) + " chances in a hundred, 0 to 100, one for each game stage"
				);
			}
			std::array<int, kMostStage + 1> byStage{};
			std::ranges::copy(chances, byStage.begin());
			return byStage;
		}

		CompoundRules readCompoundRules(JsonReader reader) {
			JsonReader	  upkeep = reader.requireObject("upkeep");
			JsonReader	  perUnit = upkeep.requireObject("peoplePerUnit");
			JsonReader	  shortfall = reader.requireObject("shortfall");
			JsonReader	  infirmary = reader.requireObject("infirmary");
			JsonReader	  scavenging = reader.requireObject("scavenging");
			JsonReader	  fall = reader.requireObject("fall");
			JsonReader	  clearing = reader.requireObject("clearing");
			JsonReader	  rewards = reader.requireObject("rewards");
			JsonReader	  returnAmbush = reader.requireObject("returnAmbush");
			CompoundRules rules{
				.peoplePerFood = requireIntIn(perUnit, "food", 1, kMostRule),
				.peoplePerWater = requireIntIn(perUnit, "water", 1, kMostRule),
				.peopleLostPerUnit = requireIntIn(shortfall, "peopleLostPerUnit", 0, kMostRule),
				.unrestPerUnit = requireIntIn(shortfall, "unrestPerUnit", 0, kMostRule),
				.hitpointsPerDay = requireIntIn(infirmary, "hitpointsPerDay", 1, kMostRule),
				.medsPerDay = requireIntIn(infirmary, "medsPerDay", 1, kMostRule),
				.scavengedFuel = readHaul(scavenging.requireObject("fuel"), 1),
				.scavengedScrap = readHaul(scavenging.requireObject("scrap"), 0),
				.starveAtFood = requireIntIn(fall, "starveAtFood", 0, kMostRule),
				.riotAtUnrest = requireIntIn(fall, "riotAtUnrest", 1, kMostRule),
				.stopCooldownDays = requireIntIn(clearing, "stopCooldownDays", 1, kMostRule),
				.rewardCards = requireIntIn(rewards, "cards", 1, kMostRule),
				.returnAmbush = readStageChances(returnAmbush, "percentByStage"),
			};
			for (const JsonReader* object :
				 {&perUnit, &upkeep, &shortfall, &infirmary, &scavenging, &fall, &clearing, &rewards, &returnAmbush, &reader}) {
				object->finish();
			}
			return rules;
		}

		GarageRules readGarageRules(JsonReader reader, const Content& content) {
			JsonReader	prices = reader.requireObject("cardPrices");
			GarageRules rules{
				.stock = requireIntIn(reader, "stock", 0, kMostRule),
				.cardPrices = {},
				.repairPerPoint = requireIntIn(reader, "repairPerPoint", 0, kMostRule),
				.hirePrices = {},
			};
			for (const auto& [name, rarity] : kRarityNames) {
				if (std::ranges::find(kDropRates, rarity, &DropRate::rarity) != kDropRates.end()) {
					rules.cardPrices.emplace(rarity, requireIntIn(prices, name, 0, kMostRule));
				}
			}
			prices.finish();
			const nlohmann::json& hire = reader.requireValue("hirePrices");
			if (!hire.is_object()) {
				reader.failAt("hirePrices", "must be an object of escort types and their prices");
			}
			for (const auto& [name, price] : hire.items()) {
				const std::string at = "hirePrices." + name;
				if (!content.escorts.contains(EscortId{name})) {
					reader.failAt(at, "names escort " + name + ", which no loaded pack defines");
				}
				if (!price.is_number_integer() || price < 0 || price > kMostRule) {
					reader.failAt(at, "must be a whole number from 0 to " + std::to_string(kMostRule));
				}
				rules.hirePrices.emplace(EscortId{name}, price.get<int>());
			}
			reader.finish();
			return rules;
		}

	} // namespace

	CampaignRules loadCampaignRules(const Content& content) {
		// Each file's latest pack, and where it is.
		std::map<std::string_view, std::pair<PackId, fs::path>, std::less<>> files;
		for (const PackManifest& pack : content.packs) {
			const fs::path folder = pack.root / "campaign";
			if (!fs::is_directory(folder)) {
				continue;
			}
			for (const fs::directory_entry& entry : fs::directory_iterator(folder)) {
				const std::string name = entry.path().filename().string();
				const auto		  known = std::ranges::find(kFiles, name);
				if (!entry.is_regular_file() || known == kFiles.end()) {
					throw ContentError(
						entry.path().generic_string() +
						" isn't start.json, deck-rules.json, compound-rules.json, or garage-rules.json, and nothing reads it"
					);
				}
				const auto earlier = files.find(*known);
				if (earlier != files.end() && !packRequires(content, pack.id, earlier->second.first)) {
					const PackId& from = earlier->second.first;
					throw ContentError(
						entry.path().generic_string() + ": pack " + pack.id.value + " overrides campaign/" + name + " from pack " +
						from.value + " without requiring " + from.value
					);
				}
				files.insert_or_assign(*known, std::pair{pack.id, entry.path()});
			}
		}
		const auto read = [&](std::string_view name) {
			const auto found = files.find(name);
			if (found == files.end()) {
				throw ContentError("no loaded pack has campaign/" + std::string(name));
			}
			return std::pair{readJsonFile(found->second.second), found->second.second.generic_string()};
		};
		const auto [start, startFile] = read(kStartFile);
		const auto [deck, deckFile] = read(kDeckRulesFile);
		const auto [compound, compoundFile] = read(kCompoundRulesFile);
		const auto [garage, garageFile] = read(kGarageRulesFile);
		return CampaignRules{
			.start = readStart(JsonReader(start, startFile), content),
			.deck = readDeckRules(JsonReader(deck, deckFile)),
			.compound = readCompoundRules(JsonReader(compound, compoundFile)),
			.garage = readGarageRules(JsonReader(garage, garageFile), content),
		};
	}

} // namespace rules::campaign
