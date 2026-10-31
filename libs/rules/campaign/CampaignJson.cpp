#include "CampaignJson.h"

#include <rules/battle/Battle.h>
#include <rules/core/ContentError.h>

#include <algorithm>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>

namespace rules::campaign {

	namespace {

		constexpr int kMostInt = std::numeric_limits<int>::max();

		// {"repair_kit": 3}: each a card a loaded pack defines, at a whole number from 1. None is an escort's signature
		// card, which only its escort brings, and only into a run deck.
		CardCounts readCounts(JsonReader& reader, std::string_view key, const Content& content) {
			const nlohmann::json& object = reader.requireValue(key);
			if (!object.is_object()) {
				reader.failAt(key, "must be an object of card counts");
			}
			CardCounts counts;
			for (const auto& [name, count] : object.items()) {
				const std::string at = std::string(key) + "." + name;
				if (!count.is_number_integer() || count < 1 || count > kMostInt) {
					reader.failAt(at, "must be a whole number from 1");
				}
				const auto card = content.cards.find(CardId{name});
				if (card == content.cards.end()) {
					reader.failAt(at, "names a card no loaded pack defines");
				}
				if (card->second.signatureOf) {
					reader.failAt(at, "is the " + card->second.signatureOf->value + " escort's signature card, which only it brings");
				}
				counts.emplace(card->first, count.get<int>());
			}
			return counts;
		}

		nlohmann::json countsJson(const CardCounts& counts) {
			nlohmann::json json = nlohmann::json::object();
			for (const auto& [card, count] : counts) {
				json[card.value] = count;
			}
			return json;
		}

		nlohmann::json resourcesJson(const Resources& resources) {
			return {
				{"food", resources.food},
				{"water", resources.water},
				{"fuel", resources.fuel},
				{"meds", resources.meds},
				{"scrap", resources.scrap},
				{"people", resources.people},
			};
		}

		std::string_view nameOf(Building building) {
			return std::ranges::find(kBuildingNames, building, &std::pair<std::string_view, Building>::second)->first;
		}

		std::string_view nameOf(DriverStatus status) {
			return std::ranges::find(kDriverStatusNames, status, &std::pair<std::string_view, DriverStatus>::second)->first;
		}

		std::vector<PackRef> readPacks(JsonReader& reader, const Content& content) {
			std::vector<PackRef> packs;
			for (JsonReader& object : reader.requireObjects("packs")) {
				PackRef pack{.id = PackId{object.requireString("id")}, .version = object.requireString("version")};
				object.finish();
				if (std::ranges::find(packs, pack.id, &PackRef::id) != packs.end()) {
					object.failAt("id", "names pack " + pack.id.value + " twice");
				}
				if (std::ranges::find(content.packs, pack.id, &PackManifest::id) == content.packs.end()) {
					object.failAt("id", "names pack " + pack.id.value + ", which the campaign was made with and isn't loaded");
				}
				packs.push_back(std::move(pack));
			}
			if (packs.empty()) {
				reader.failAt("packs", "can't be empty, since a campaign is made from packs");
			}
			return packs;
		}

		uint32_t readSeed(JsonReader& reader) {
			const nlohmann::json& seed = reader.requireValue("seed");
			if (!seed.is_number_integer() || seed < 0 || seed > std::numeric_limits<uint32_t>::max()) {
				reader.failAt("seed", "must be a whole number from 0 to 4294967295");
			}
			return seed.get<uint32_t>();
		}

		// An id handed out from `counter`: the prefix and a number under it, once.
		template <typename IdType, typename Entry>
		void checkId(JsonReader& reader, const IdType& id, std::string_view prefix, int counter, const std::vector<Entry>& earlier) {
			const std::optional<int> number = idNumber(id.value, prefix);
			if (!number) {
				reader.failAt("id", "must look like " + std::string(prefix) + "1, got \"" + id.value + "\"");
			}
			if (*number >= counter) {
				reader.failAt("id", id.value + " is past the counter that hands ids out, " + std::to_string(counter));
			}
			if (std::ranges::find(earlier, id, &Entry::id) != earlier.end()) {
				reader.failAt("id", id.value + " belongs to an earlier entry");
			}
		}

		DriverRecord readDriver(JsonReader& reader, const Campaign& campaign, const Content& content) {
			JsonReader		   vehicle = reader.requireObject("vehicle");
			const CrewId	   id{reader.requireString("id")};
			const DriverId	   archetype{reader.requireString("archetype")};
			const DriverStatus status = reader.requireEnum("status", kDriverStatusNames);
			DriverRecord	   driver{
					  .id = id,
					  .archetype = archetype,
					  .status = status,
					  .hitpoints = requireIntIn(reader, "hitpoints", 0),
					  .injuredDays = requireIntIn(reader, "injuredDays", 0),
					  .vehicle = {.structure = requireIntIn(vehicle, "structure", 1), .armor = requireIntIn(vehicle, "armor", 0)},
					  .defaultDeck = readCounts(reader, "defaultDeck", content),
			  };
			vehicle.finish();
			reader.finish();
			checkId(reader, driver.id, kCrewPrefix, campaign.nextDriverNumber, campaign.drivers);
			if (!content.drivers.contains(driver.archetype)) {
				reader.failAt("archetype", "names driver " + driver.archetype.value + ", which no loaded pack defines");
			}
			if ((driver.status == DriverStatus::Dead) != (driver.hitpoints == 0)) {
				reader.failAt("hitpoints", "is 0 exactly when the driver is dead");
			}
			if ((driver.status == DriverStatus::Injured) != (driver.injuredDays > 0)) {
				reader.failAt("injuredDays", "is above 0 exactly while the driver is injured");
			}
			if (driver.status == DriverStatus::Dead && !driver.defaultDeck.empty()) {
				reader.failAt("defaultDeck", "is empty once the driver is dead, who took it with them");
			}
			return driver;
		}

		ConvoyEscort readEscort(JsonReader& reader, const Campaign& campaign, const Content& content) {
			ConvoyEscort escort{
				.id = ConvoyId{reader.requireString("id")},
				.type = EscortId{reader.requireString("type")},
				.structure = requireIntIn(reader, "structure", 1),
			};
			reader.finish();
			checkId(reader, escort.id, kConvoyPrefix, campaign.nextEscortNumber, campaign.convoy);
			if (!content.escorts.contains(escort.type)) {
				reader.failAt("type", "names escort " + escort.type.value + ", which no loaded pack defines");
			}
			return escort;
		}

		RunDeck readRunDeck(JsonReader& reader, const Campaign& campaign, const Content& content, const std::vector<ConvoyId>& escorts) {
			RunDeck deck{
				.driver = CrewId{reader.requireString("driver")},
				.own = readCounts(reader, "own", content),
				.leftHome = readCounts(reader, "leftHome", content),
				.borrowed = readCounts(reader, "borrowed", content),
				.escortCards = {},
			};
			for (JsonReader& object : reader.requireObjects("escortCards")) {
				EscortCard card{.card = CardId{object.requireString("card")}, .broughtBy = ConvoyId{object.requireString("broughtBy")}};
				object.finish();
				if (std::ranges::find(escorts, card.broughtBy) == escorts.end()) {
					object.failAt("broughtBy", "names " + card.broughtBy.value + ", which didn't come along on the run");
				}
				const EscortId& type = campaign.findEscort(card.broughtBy)->type;
				if (content.escorts.at(type).signatureCard != card.card) {
					object.failAt("card", "isn't the signature card of " + card.broughtBy.value + ", a " + type.value);
				}
				deck.escortCards.push_back(std::move(card));
			}
			reader.finish();
			const DriverRecord* driver = campaign.findDriver(deck.driver);
			if (driver == nullptr) {
				reader.failAt("driver", "names " + deck.driver.value + ", who isn't in the pool");
			}
			if (driver->status != DriverStatus::Ready) {
				reader.failAt("driver", deck.driver.value + " is " + std::string(nameOf(driver->status)) + ", and only the ready go out");
			}
			if (!driver->defaultDeck.empty()) {
				reader.failAt("driver", deck.driver.value + "'s default deck is in this run deck, so the record holds none");
			}
			for (const auto& [card, count] : deck.borrowed) {
				if (countOf(deck.leftHome, card) > 0) {
					reader.failAt("borrowed", card.value + " is borrowed while the driver's own are left at home, which come back first");
				}
			}
			return deck;
		}

		Run readRun(JsonReader reader, const Campaign& campaign, const Content& content) {
			Run run{
				.id = RunId{reader.requireString("id")},
				.stage = requireIntIn(reader, "stage", 0, kMostStage),
				.seats = {},
				.escorts = {},
				.cargo = readResources(reader.requireObject("cargo")),
				.cargoCards = readCounts(reader, "cargoCards", content),
				.fights = requireIntIn(reader, "fights", 0),
			};
			const std::optional<int> number = idNumber(run.id.value, kRunPrefix);
			if (!number || *number >= campaign.nextRunNumber) {
				reader.failAt("id", "must be run-1 or the like, under the counter that hands ids out");
			}
			std::optional<size_t> lastPlace;
			for (std::string& name : reader.requireStrings("escorts")) {
				const ConvoyId escort{std::move(name)};
				const auto	   place = std::ranges::find(campaign.convoy, escort, &ConvoyEscort::id);
				if (place == campaign.convoy.end()) {
					reader.failAt("escorts", "names " + escort.value + ", which isn't in the convoy");
				}
				const auto index = static_cast<size_t>(place - campaign.convoy.begin());
				if (lastPlace && index <= *lastPlace) {
					reader.failAt("escorts", "lists " + escort.value + " out of roster order, or twice");
				}
				lastPlace = index;
				run.escorts.push_back(escort);
			}
			std::vector<JsonReader> seats = reader.requireObjects("seats");
			if (seats.empty() || seats.size() > 2) {
				reader.failAt("seats", "must seat one or two drivers");
			}
			for (JsonReader& seat : seats) {
				RunDeck deck = readRunDeck(seat, campaign, content, run.escorts);
				if (std::ranges::find(run.seats, deck.driver, &RunDeck::driver) != run.seats.end()) {
					seat.failAt("driver", deck.driver.value + " is in both seats");
				}
				run.seats.push_back(std::move(deck));
			}
			for (const ConvoyId& escort : run.escorts) {
				int cards = 0;
				for (const RunDeck& deck : run.seats) {
					cards += static_cast<int>(std::ranges::count(deck.escortCards, escort, &EscortCard::broughtBy));
				}
				if (cards != 1) {
					reader.failAt(
						"escorts", escort.value + " came along with " + std::to_string(cards) + " cards in the run decks, not one"
					);
				}
			}
			reader.finish();
			return run;
		}

		nlohmann::json runJson(const Run& run) {
			nlohmann::json seats = nlohmann::json::array();
			for (const RunDeck& deck : run.seats) {
				nlohmann::json escortCards = nlohmann::json::array();
				for (const EscortCard& card : deck.escortCards) {
					escortCards.push_back({{"card", card.card.value}, {"broughtBy", card.broughtBy.value}});
				}
				seats.push_back({
					{"driver", deck.driver.value},
					{"own", countsJson(deck.own)},
					{"leftHome", countsJson(deck.leftHome)},
					{"borrowed", countsJson(deck.borrowed)},
					{"escortCards", std::move(escortCards)},
				});
			}
			nlohmann::json escorts = nlohmann::json::array();
			for (const ConvoyId& escort : run.escorts) {
				escorts.push_back(escort.value);
			}
			return {
				{"id", run.id.value},
				{"stage", run.stage},
				{"seats", std::move(seats)},
				{"escorts", std::move(escorts)},
				{"cargo", resourcesJson(run.cargo)},
				{"cargoCards", countsJson(run.cargoCards)},
				{"fights", run.fights},
			};
		}

	} // namespace

	int requireIntIn(JsonReader& reader, std::string_view key, int least, int most) {
		const int value = reader.requireInt(key);
		if (value < least || value > most) {
			reader.failAt(
				key, "must be a whole number from " + std::to_string(least) + (most == kMostInt ? "" : " to " + std::to_string(most))
			);
		}
		return value;
	}

	Resources readResources(JsonReader reader) {
		const Resources resources{
			.food = requireIntIn(reader, "food", 0),
			.water = requireIntIn(reader, "water", 0),
			.fuel = requireIntIn(reader, "fuel", 0),
			.meds = requireIntIn(reader, "meds", 0),
			.scrap = requireIntIn(reader, "scrap", 0),
			.people = requireIntIn(reader, "people", 0),
		};
		reader.finish();
		return resources;
	}

	std::vector<Building> readBuildings(JsonReader& reader, std::string_view key) {
		std::vector<Building> buildings;
		for (const std::string& name : reader.requireStrings(key)) {
			const Building building = reader.enumNamed(key, name, kBuildingNames);
			if (std::ranges::find(buildings, building) != buildings.end()) {
				reader.failAt(key, "lists " + name + " twice");
			}
			buildings.push_back(building);
		}
		std::ranges::sort(buildings);
		return buildings;
	}

	Campaign readCampaign(const nlohmann::json& json, const Content& content) {
		JsonReader reader(json, "campaign");
		const int  version = reader.requireInt("version");
		if (version != kSaveVersion) {
			reader.failAt("version", "is " + std::to_string(version) + ", and this build reads version " + std::to_string(kSaveVersion));
		}
		Campaign campaign{
			.packs = readPacks(reader, content),
			.seed = readSeed(reader),
			.day = requireIntIn(reader, "day", 1),
			.stores = readResources(reader.requireObject("stores")),
			.unrest = requireIntIn(reader, "unrest", 0),
			.buildings = readBuildings(reader, "buildings"),
			.drivers = {},
			.nextDriverNumber = requireIntIn(reader, "nextDriverNumber", 1),
			.locker = readCounts(reader, "locker", content),
			.convoy = {},
			.nextEscortNumber = requireIntIn(reader, "nextEscortNumber", 1),
			.run = std::nullopt,
			.nextRunNumber = requireIntIn(reader, "nextRunNumber", 1),
		};
		for (JsonReader& driver : reader.requireObjects("drivers")) {
			campaign.drivers.push_back(readDriver(driver, campaign, content));
		}
		std::vector<JsonReader> convoy = reader.requireObjects("convoy");
		if (convoy.size() > kMostEscorts) {
			reader.failAt("convoy", "holds at most " + std::to_string(kMostEscorts) + " escorts");
		}
		for (JsonReader& escort : convoy) {
			campaign.convoy.push_back(readEscort(escort, campaign, content));
		}
		const nlohmann::json& run = reader.requireValue("run");
		if (!run.is_null()) {
			campaign.run = readRun(JsonReader(run, reader.where() + ".run"), campaign, content);
		}
		reader.finish();
		return campaign;
	}

	nlohmann::json writeCampaign(const Campaign& campaign, const Content& content) {
		nlohmann::json packs = nlohmann::json::array();
		for (const PackRef& pack : campaign.packs) {
			packs.push_back({{"id", pack.id.value}, {"version", pack.version}});
		}
		nlohmann::json buildings = nlohmann::json::array();
		for (const Building building : campaign.buildings) {
			buildings.push_back(std::string(nameOf(building)));
		}
		nlohmann::json drivers = nlohmann::json::array();
		for (const DriverRecord& driver : campaign.drivers) {
			drivers.push_back({
				{"id", driver.id.value},
				{"archetype", driver.archetype.value},
				{"status", std::string(nameOf(driver.status))},
				{"hitpoints", driver.hitpoints},
				{"injuredDays", driver.injuredDays},
				{"vehicle", {{"structure", driver.vehicle.structure}, {"armor", driver.vehicle.armor}}},
				{"defaultDeck", countsJson(driver.defaultDeck)},
			});
		}
		nlohmann::json convoy = nlohmann::json::array();
		for (const ConvoyEscort& escort : campaign.convoy) {
			convoy.push_back({{"id", escort.id.value}, {"type", escort.type.value}, {"structure", escort.structure}});
		}
		const nlohmann::json json = {
			{"version", kSaveVersion},
			{"packs", std::move(packs)},
			{"seed", campaign.seed},
			{"day", campaign.day},
			{"stores", resourcesJson(campaign.stores)},
			{"unrest", campaign.unrest},
			{"buildings", std::move(buildings)},
			{"drivers", std::move(drivers)},
			{"nextDriverNumber", campaign.nextDriverNumber},
			{"locker", countsJson(campaign.locker)},
			{"convoy", std::move(convoy)},
			{"nextEscortNumber", campaign.nextEscortNumber},
			{"run", campaign.run ? runJson(*campaign.run) : nlohmann::json(nullptr)},
			{"nextRunNumber", campaign.nextRunNumber},
		};
		try {
			if (readCampaign(json, content) != campaign) {
				throw std::logic_error("writeCampaign: the save doesn't read back as the campaign it was written from");
			}
		} catch (const ContentError& error) {
			throw std::logic_error(std::string("writeCampaign: this build made a campaign its own save can't hold: ") + error.what());
		}
		return json;
	}

} // namespace rules::campaign
