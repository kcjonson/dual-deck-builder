#include "CampaignJson.h"

#include "CampaignEnd.h"
#include "CardOffers.h"

#include <rules/battle/Battle.h>
#include <rules/core/ContentError.h>
#include <rules/map/MapPipeline.h>
#include <rules/map/MapPresets.h>
#include <rules/map/ParamValidator.h>
#include <rules/map/StopData.h>

#include <algorithm>
#include <charconv>
#include <cstdint>
#include <limits>
#include <set>
#include <stdexcept>
#include <string>
#include <variant>

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

		template <typename Tag>
		nlohmann::json idsJson(const std::vector<Id<Tag>>& ids) {
			nlohmann::json json = nlohmann::json::array();
			for (const Id<Tag>& id : ids) {
				json.push_back(id.value);
			}
			return json;
		}

		// Today's stock: each a card a shop sells, once.
		std::vector<GarageOffer> readGarage(JsonReader& reader, const Content& content) {
			std::vector<GarageOffer> stock;
			for (JsonReader& object : reader.requireObjects("garage")) {
				GarageOffer offer{.card = CardId{object.requireString("card")}, .sold = object.requireBool("sold")};
				object.finish();
				const auto card = content.cards.find(offer.card);
				if (card == content.cards.end() || !isOffered(card->second)) {
					object.failAt("card", "names " + offer.card.value + ", which no loaded pack defines as a card a shop sells");
				}
				if (std::ranges::find(stock, offer.card, &GarageOffer::card) != stock.end()) {
					object.failAt("card", "names " + offer.card.value + ", which an earlier offer is");
				}
				stock.push_back(std::move(offer));
			}
			return stock;
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

		template <typename Enum, std::size_t Count>
		std::string_view nameOf(Enum value, const EnumNames<Enum, Count>& names) {
			return std::ranges::find(names, value, &std::pair<std::string_view, Enum>::second)->first;
		}

		// Every parameter on the campaign's seed, valid as they stand, since the map was made on them once the validator
		// had been over them.
		map::MapParams readMapParams(JsonReader params, uint32_t seed) {
			const map::MapParamSet set = map::readMapParamSet(params);
			for (const map::NumberParamSpec& spec : map::kNumberParams) {
				if (!set.overrides.at(static_cast<size_t>(spec.param))) {
					params.failAt(spec.key, "is missing, and the map was made on every parameter");
				}
			}
			if (set.seed != seed) {
				params.failAt("seed", "is " + std::to_string(set.seed) + ", and the campaign's is " + std::to_string(seed));
			}
			const map::MapParams			   resolved = map::resolveMapParams(set);
			const std::vector<map::ParamClamp> clamps = map::validateMapParams(resolved).clamps;
			if (!clamps.empty()) {
				params.failAt(clamps.front().param, "isn't one a map is made on: " + map::describeClamp(clamps.front()));
			}
			return resolved;
		}

		nlohmann::json paramsJson(const map::MapParams& params) {
			nlohmann::json json = {{"seed", params.seed}, {"environment", std::string(nameOf(params.environment, map::kEnvironmentNames))}};
			for (const map::NumberParamSpec& spec : map::kNumberParams) {
				std::visit([&](auto field) { json[std::string(spec.key)] = params.*field; }, spec.field);
			}
			return json;
		}

		uint64_t readFingerprint(JsonReader& reader) {
			const std::string text = reader.requireString("fingerprint");
			uint64_t		  fingerprint = 0;
			const auto [end, error] = std::from_chars(text.data(), text.data() + text.size(), fingerprint, 16);
			if (error != std::errc{} || end != text.data() + text.size() || fingerprintText(fingerprint) != text) {
				reader.failAt("fingerprint", "must be 16 lowercase hex digits, got \"" + text + "\"");
			}
			return fingerprint;
		}

		// Each stage's attempt by its name, which is all the shape there is to read: whether they fit the pipeline is
		// the pipeline's to say, as loadCampaign makes the map.
		MapOrigin readMapOrigin(JsonReader reader, uint32_t seed) {
			JsonReader attempts = reader.requireObject("attempts");
			MapOrigin  origin{
				 .params = readMapParams(reader.requireObject("params"), seed),
				 .mapAttempt = static_cast<uint32_t>(requireIntIn(attempts, "map", 0, static_cast<int>(map::kMapAttempts) - 1)),
				 .stageAttempts = {},
				 .fingerprint = readFingerprint(reader),
			 };
			const nlohmann::json& stages = attempts.requireValue("stages");
			if (!stages.is_object() || stages.empty()) {
				attempts.failAt("stages", "must be an object of each stage's winning attempt, by its name");
			}
			for (const auto& [name, attempt] : stages.items()) {
				if (!attempt.is_number_integer() || attempt < 0 || attempt >= map::kStageAttempts) {
					attempts.failAt("stages." + name, "must be a whole number from 0 to " + std::to_string(map::kStageAttempts - 1));
				}
				origin.stageAttempts.emplace(name, attempt.get<uint32_t>());
			}
			attempts.finish();
			reader.finish();
			return origin;
		}

		nlohmann::json originJson(const MapOrigin& origin) {
			nlohmann::json stages = nlohmann::json::object();
			for (const auto& [name, attempt] : origin.stageAttempts) {
				stages[name] = attempt;
			}
			return {
				{"params", paramsJson(origin.params)},
				{"attempts", {{"map", origin.mapAttempt}, {"stages", std::move(stages)}}},
				{"fingerprint", fingerprintText(origin.fingerprint)},
			};
		}

		// Map ids, each from 0, in id order and once.
		std::vector<int> readIds(JsonReader& reader, std::string_view key) {
			std::vector<int> ids = reader.requireInts(key);
			for (size_t index = 0; index < ids.size(); ++index) {
				if (ids[index] < 0) {
					reader.failAt(key, "lists " + std::to_string(ids[index]) + ", and the map's ids run from 0");
				}
				if (index > 0 && ids[index] <= ids[index - 1]) {
					reader.failAt(
						key,
						"lists " + std::to_string(ids[index]) + " after " + std::to_string(ids[index - 1]) +
							"; it runs in id order, each id once"
					);
				}
			}
			return ids;
		}

		// Each stop once, in id order, cleared no later than today, and none neither cleared nor back, which is a stop
		// with no entry.
		MapState readMapState(JsonReader reader, int day) {
			MapState state{
				.clearedPois = readIds(reader, "clearedPois"),
				.chartedLegs = readIds(reader, "chartedLegs"),
				.stops = {},
				.strongholdsTaken = readIds(reader, "strongholdsTaken"),
			};
			for (JsonReader& entry : reader.requireObjects("stops")) {
				StopState			  stop{.stop = requireIntIn(entry, "stop", 0), .roll = requireIntIn(entry, "roll", 0), .cleared = {}};
				const nlohmann::json& cleared = entry.requireValue("cleared");
				if (!cleared.is_null()) {
					if (!cleared.is_number_integer() || cleared < 1 || cleared > day) {
						entry.failAt(
							"cleared", "must be null or a day from 1 to today, " + std::to_string(day) + ", since no run clears one later"
						);
					}
					stop.cleared = cleared.get<int>();
				}
				entry.finish();
				if (!state.stops.empty() && stop.stop <= state.stops.back().stop) {
					entry.failAt(
						"stop", "comes after stop " + std::to_string(state.stops.back().stop) + "; the stops run in id order, each once"
					);
				}
				if (stop.roll == 0 && !stop.cleared) {
					entry.fail("is neither cleared nor back, which is a stop with no entry");
				}
				state.stops.push_back(stop);
			}
			reader.finish();
			return state;
		}

		nlohmann::json stateJson(const MapState& state) {
			nlohmann::json stops = nlohmann::json::array();
			for (const StopState& stop : state.stops) {
				stops.push_back({
					{"stop", stop.stop},
					{"roll", stop.roll},
					{"cleared", stop.cleared ? nlohmann::json(*stop.cleared) : nlohmann::json(nullptr)},
				});
			}
			return {
				{"clearedPois", state.clearedPois},
				{"chartedLegs", state.chartedLegs},
				{"stops", std::move(stops)},
				{"strongholdsTaken", state.strongholdsTaken},
			};
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
				reader.failAt(
					"driver",
					deck.driver.value + " is " + std::string(nameOf(driver->status, kDriverStatusNames)) + ", and only the ready go out"
				);
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

		// Map ids in an order of their own, each from 0 and once.
		std::vector<int> readIdList(JsonReader& reader, std::string_view key) {
			std::vector<int> ids = reader.requireInts(key);
			std::set<int>	 seen;
			for (const int id : ids) {
				if (id < 0 || !seen.insert(id).second) {
					reader.failAt(key, "lists " + std::to_string(id) + ", and its ids run from 0, each once");
				}
			}
			return ids;
		}

		// Where the run is on its route, and the reward on offer there, each a card a shop sells, once.
		RunRoute readRunRoute(JsonReader reader, const Content& content) {
			RunRoute route{
				.poi = requireIntIn(reader, "poi", 0),
				.route = requireIntIn(reader, "route", 0),
				.tier = requireIntIn(reader, "tier", 1, map::kStopTiers),
				.legs = readIdList(reader, "legs"),
				.stops = readIdList(reader, "stops"),
				.leg = 0,
				.next = 0,
				.reward = {},
			};
			route.leg = requireIntIn(reader, "leg", 0, static_cast<int>(route.legs.size()));
			route.next = requireIntIn(reader, "next", 0, static_cast<int>(route.stops.size()));
			for (std::string& name : reader.requireStrings("reward")) {
				const auto card = content.cards.find(CardId{name});
				if (card == content.cards.end() || !isOffered(card->second)) {
					reader.failAt("reward", "names " + name + ", which no loaded pack defines as a card a reward offers");
				}
				if (std::ranges::find(route.reward, card->first) != route.reward.end()) {
					reader.failAt("reward", "names " + name + " twice");
				}
				route.reward.push_back(card->first);
			}
			reader.finish();
			if (!route.reward.empty() && static_cast<size_t>(route.next) == route.stops.size()) {
				reader.failAt("reward", "is on offer past the run's last stop, where nothing offers one");
			}
			return route;
		}

		nlohmann::json routeJson(const RunRoute& route) {
			return {
				{"poi", route.poi},
				{"route", route.route},
				{"tier", route.tier},
				{"legs", route.legs},
				{"stops", route.stops},
				{"leg", route.leg},
				{"next", route.next},
				{"reward", idsJson(route.reward)},
			};
		}

		Run readRun(JsonReader reader, const Campaign& campaign, const Content& content) {
			Run run{
				.id = RunId{reader.requireString("id")},
				.stage = requireIntIn(reader, "stage", 0, kMostStage),
				.seats = {},
				.escorts = {},
				.cargo = readResources(reader.requireObject("cargo")),
				.cargoCards = readCounts(reader, "cargoCards", content),
				.found = {},
				.recruits = {},
				.fights = requireIntIn(reader, "fights", 0),
				.route = std::nullopt,
			};
			const nlohmann::json& route = reader.requireValue("route");
			if (!route.is_null()) {
				run.route = readRunRoute(JsonReader(route, reader.where() + ".route"), content);
			}
			for (std::string& name : reader.requireStrings("found")) {
				const CrewId		found{std::move(name)};
				const DriverRecord* driver = campaign.findDriver(found);
				if (driver == nullptr || driver->status != DriverStatus::Missing) {
					reader.failAt("found", "names " + found.value + ", who isn't one of the pool's missing");
				}
				if (std::ranges::find(run.found, found) != run.found.end()) {
					reader.failAt("found", "names " + found.value + " twice");
				}
				run.found.push_back(found);
			}
			for (std::string& name : reader.requireStrings("recruits")) {
				DriverId recruit{std::move(name)};
				if (!content.drivers.contains(recruit)) {
					reader.failAt("recruits", "names driver " + recruit.value + ", which no loaded pack defines");
				}
				run.recruits.push_back(std::move(recruit));
			}
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

		// An end the state shows: no run out, and nobody left at the compound or no People, by its cause.
		CampaignEnd readEnd(JsonReader reader, const Campaign& campaign) {
			const CampaignEnd end{
				.ending = reader.requireEnum("ending", kEndingNames), .cause = reader.requireEnum("cause", kEndCauseNames)
			};
			reader.finish();
			if (campaign.run) {
				reader.fail("is set with a run out, which has to be home or lost first");
			}
			if (end.cause == EndCause::LastDriver ? !nobodyAtCompound(campaign) : campaign.stores.people > 0) {
				reader.failAt("cause", "isn't what the campaign shows: someone is still at the compound, or People is above 0");
			}
			return end;
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
			return {
				{"id", run.id.value},
				{"stage", run.stage},
				{"seats", std::move(seats)},
				{"escorts", idsJson(run.escorts)},
				{"cargo", resourcesJson(run.cargo)},
				{"cargoCards", countsJson(run.cargoCards)},
				{"found", idsJson(run.found)},
				{"recruits", idsJson(run.recruits)},
				{"fights", run.fights},
				{"route", run.route ? routeJson(*run.route) : nlohmann::json(nullptr)},
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

	std::string fingerprintText(uint64_t fingerprint) {
		constexpr std::string_view kDigits = "0123456789abcdef";
		std::string				   text(16, '0');
		for (size_t digit = 0; digit < text.size(); ++digit) {
			text[text.size() - 1 - digit] = kDigits[(fingerprint >> (4 * digit)) & 0xFU];
		}
		return text;
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
			.garage = readGarage(reader, content),
			.convoy = {},
			.nextEscortNumber = requireIntIn(reader, "nextEscortNumber", 1),
			.run = std::nullopt,
			.nextRunNumber = requireIntIn(reader, "nextRunNumber", 1),
		};
		campaign.mapOrigin = readMapOrigin(reader.requireObject("mapOrigin"), campaign.seed);
		campaign.mapState = readMapState(reader.requireObject("mapState"), campaign.day);
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
		for (JsonReader& entry : reader.requireObjects("log")) {
			LogEntry line{.day = requireIntIn(entry, "day", 1, campaign.day), .text = entry.requireString("text")};
			entry.finish();
			if (!campaign.log.empty() && line.day < campaign.log.back().day) {
				entry.failAt("day", "is before the line ahead of it; the log runs in day order");
			}
			if (line.text.empty()) {
				entry.failAt("text", "can't be empty");
			}
			campaign.log.push_back(std::move(line));
		}
		JsonReader tally = reader.requireObject("tally");
		campaign.tally = Tally{
			.runsHome = requireIntIn(tally, "runsHome", 0),
			.runsFailed = requireIntIn(tally, "runsFailed", 0),
			.fightsWon = requireIntIn(tally, "fightsWon", 0),
		};
		tally.finish();
		if (campaign.tally.runsHome + campaign.tally.runsFailed > campaign.nextRunNumber - 1 - (campaign.run ? 1 : 0)) {
			reader.failAt("tally", "counts more runs ended than were handed ids, less the one out");
		}
		const nlohmann::json& end = reader.requireValue("end");
		if (!end.is_null()) {
			campaign.end = readEnd(JsonReader(end, reader.where() + ".end"), campaign);
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
			buildings.push_back(std::string(nameOf(building, kBuildingNames)));
		}
		nlohmann::json drivers = nlohmann::json::array();
		for (const DriverRecord& driver : campaign.drivers) {
			drivers.push_back({
				{"id", driver.id.value},
				{"archetype", driver.archetype.value},
				{"status", std::string(nameOf(driver.status, kDriverStatusNames))},
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
		nlohmann::json garage = nlohmann::json::array();
		for (const GarageOffer& offer : campaign.garage) {
			garage.push_back({{"card", offer.card.value}, {"sold", offer.sold}});
		}
		nlohmann::json log = nlohmann::json::array();
		for (const LogEntry& line : campaign.log) {
			log.push_back({{"day", line.day}, {"text", line.text}});
		}
		const nlohmann::json end = campaign.end ? nlohmann::json{
			{"ending", std::string(nameOf(campaign.end->ending, kEndingNames))},
			{"cause", std::string(nameOf(campaign.end->cause, kEndCauseNames))},
		} : nlohmann::json(nullptr);
		const nlohmann::json json = {
			{"version", kSaveVersion},
			{"packs", std::move(packs)},
			{"seed", campaign.seed},
			{"mapOrigin", originJson(campaign.mapOrigin)},
			{"mapState", stateJson(campaign.mapState)},
			{"day", campaign.day},
			{"stores", resourcesJson(campaign.stores)},
			{"unrest", campaign.unrest},
			{"buildings", std::move(buildings)},
			{"drivers", std::move(drivers)},
			{"nextDriverNumber", campaign.nextDriverNumber},
			{"locker", countsJson(campaign.locker)},
			{"garage", std::move(garage)},
			{"convoy", std::move(convoy)},
			{"nextEscortNumber", campaign.nextEscortNumber},
			{"run", campaign.run ? runJson(*campaign.run) : nlohmann::json(nullptr)},
			{"nextRunNumber", campaign.nextRunNumber},
			{"log", std::move(log)},
			{"tally",
			 {{"runsHome", campaign.tally.runsHome}, {"runsFailed", campaign.tally.runsFailed}, {"fightsWon", campaign.tally.fightsWon}}},
			{"end", end},
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
