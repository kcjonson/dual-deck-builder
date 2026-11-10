// What the road shows of a fight (Battle Screen Design 1 and 3, vehicle-token.md), over a real one on the base pack: the
// tokens and their order, names, meters, chips and wrecks, each intent as a pill with its mark, the lines the end-turn
// preview draws, planned swerves, the rows a wave pulls into, and the rear view each vehicle's class draws.

#include "road/RoadPicture.h"
#include "GameTesting.h"

#include <rules/battle/Battle.h>
#include <rules/battle/EnemyTurn.h>

#include <algorithm>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace {

	using namespace game;
	using game::road::RoadPicture;
	using game::road::TargetMark;
	using game::road::TokenData;
	using game::road::TokenSide;
	using rules::BattleState;
	using rules::DriverIndex;
	using rules::IntentKind;
	using rules::Side;
	using rules::VehicleIndex;

	const std::vector<std::string> kSeats{"Road Warrior 1", "Interceptor 2"};

	rules::PlayerSeat seat(const char* driver) {
		const rules::Content& content = game::testing::testRules().content;
		const rules::DriverId id{driver};
		return {.driver = id, .deck = rules::cardsOf(content.drivers.at(id).startingDeck), .slot = std::nullopt};
	}

	// Two seats, an Outrider, and a Scavenger, a Wasteland Raider and a Warlord, the raiders' turn planned.
	BattleState fight() {
		const GameRules&   loaded = game::testing::testRules();
		rules::BattleStart start = rules::startBattle(
			{
				.players = {seat("road_warrior"), seat("interceptor")},
				.escorts = {{.escort = rules::EscortId{"outrider"}, .structure = std::nullopt, .slot = std::nullopt}},
				.raiders =
					{{.opponent = rules::OpponentId{"scav_bike"}, .slot = std::nullopt},
					 {.opponent = rules::OpponentId{"rust_buggy"}, .slot = std::nullopt},
					 {.opponent = rules::OpponentId{"warlord"}, .slot = std::nullopt}},
				.seed = 7,
			},
			loaded.content
		);
		(void)rules::planEnemyTurn(start.state, loaded.content, loaded.raiders.forRaiders());
		return std::move(start.state);
	}

	VehicleIndex vehicleOf(const BattleState& state, DriverIndex driver) {
		const std::optional<VehicleIndex> riding = rules::vehicleCarrying(state, driver);
		EXPECT_TRUE(riding.has_value());
		return riding.value_or(VehicleIndex{});
	}

	const TokenData& tokenOf(const RoadPicture& picture, VehicleIndex vehicle) {
		const auto found = std::ranges::find(picture.vehicles, vehicle, &road::RoadVehicle::index);
		EXPECT_NE(found, picture.vehicles.end());
		return found->token;
	}

	RoadPicture
	pictureOf(const BattleState& state, std::span<const rules::Intent> intents, std::span<const rules::RoadSlot> arrivals = {}) {
		return road::roadPicture(state, game::testing::testRules().content, intents, arrivals, kSeats);
	}

	TEST(RoadPicture, EveryVehicleOnTheRoadHasATokenInItsSlotRaidersFirst) {
		BattleState		  state = fight();
		const RoadPicture picture = pictureOf(state, {});
		ASSERT_EQ(picture.vehicles.size(), 6U);
		for (size_t place = 0; place < 3; ++place) {
			EXPECT_EQ(picture.vehicles[place].token.side, TokenSide::Raider) << place;
		}
		for (const road::RoadVehicle& vehicle : picture.vehicles) {
			EXPECT_EQ(vehicle.slot, state.vehicle(vehicle.index).slot);
		}
		// A vehicle off the road has no token.
		state.vehicles[static_cast<size_t>(picture.vehicles.front().index.value)].onRoad = false;
		EXPECT_EQ(pictureOf(state, {}).vehicles.size(), 5U);
	}

	TEST(RoadPicture, ATokenCarriesTheNamesMetersSpeedAndChipsTheFightHas) {
		BattleState			  state = fight();
		const rules::Content& content = game::testing::testRules().content;
		const VehicleIndex	  first = vehicleOf(state, DriverIndex{0});
		const VehicleIndex	  second = vehicleOf(state, DriverIndex{1});
		rules::BattleVehicle& rig = state.vehicle(first);
		rig.shield = 4;
		rig.statuses.push_back({.status = rules::Status::Vulnerable, .value = 0, .turns = 2});
		rig.statuses.push_back({.status = rules::Status::SpeedBoost, .value = 2, .turns = 1});
		state.driver(DriverIndex{0}).hitpoints -= 5;

		const RoadPicture picture = pictureOf(state, {});
		const TokenData&  driven = tokenOf(picture, first);
		EXPECT_EQ(driven.name, "Road Warrior 1");
		EXPECT_EQ(driven.vehicle, content.drivers.at(rules::DriverId{"road_warrior"}).vehicle.name) << "the vehicle under its driver";
		EXPECT_EQ(driven.side, TokenSide::Player);
		EXPECT_EQ(driven.seat, 0);
		EXPECT_EQ(tokenOf(picture, second).seat, 1);
		EXPECT_EQ(driven.structure.value, rig.structure);
		EXPECT_EQ(driven.structure.max, rig.maxStructure);
		EXPECT_EQ(driven.armor, rig.armor);
		ASSERT_TRUE(driven.driver.has_value());
		EXPECT_EQ(driven.driver->value, state.driver(DriverIndex{0}).maxHitpoints - 5);
		EXPECT_EQ(driven.speed, rules::speedOf(state, first));
		EXPECT_EQ(driven.statuses, (std::vector<std::string>{"SH4", "VUL2", "SPD2"})) << "shield first, then as they landed";

		const auto escort = std::ranges::find_if(picture.vehicles, [](const road::RoadVehicle& vehicle) {
			return vehicle.token.side == TokenSide::Escort;
		});
		ASSERT_NE(escort, picture.vehicles.end());
		EXPECT_EQ(escort->token.name, content.escorts.at(rules::EscortId{"outrider"}).name);
		EXPECT_TRUE(escort->token.vehicle.empty()) << "an escort's title is its vehicle, with no second line";
		EXPECT_FALSE(escort->token.driver.has_value()) << "an escort has no driver's meter";
		EXPECT_FALSE(escort->token.seat.has_value());

		const VehicleIndex raider = vehicleOf(state, DriverIndex{2});
		EXPECT_EQ(tokenOf(picture, raider).name, content.opponents.at(rules::OpponentId{"scav_bike"}).name);
		EXPECT_EQ(tokenOf(picture, raider).side, TokenSide::Raider);
	}

	TEST(RoadPicture, AnEscortsPassengerTakesItsHpRowAndASpentOneSaysSo) {
		BattleState		   state = fight();
		const auto		   found = std::ranges::find_if(state.vehicles, &rules::BattleVehicle::isEscort);
		const VehicleIndex escort{static_cast<int>(found - state.vehicles.begin())};
		state.vehicle(escort).passenger = DriverIndex{1};
		state.vehicle(escort).spent = true;
		const TokenData token = tokenOf(pictureOf(state, {}), escort);
		ASSERT_TRUE(token.passenger.has_value());
		EXPECT_EQ(token.passenger->value, state.driver(DriverIndex{1}).hitpoints);
		EXPECT_TRUE(token.spent);
		EXPECT_FLOAT_EQ(road::VehicleToken::heightFor(token), road::VehicleToken::kHeight) << "it stays 117 tall";
	}

	TEST(RoadPicture, AWreckIsStampedAndARaiderWithNobodyAboardHasNoDriver) {
		BattleState		   state = fight();
		const VehicleIndex wreck = vehicleOf(state, DriverIndex{2});
		const VehicleIndex unmanned = vehicleOf(state, DriverIndex{3});
		state.vehicle(wreck).structure = 0;
		state.driver(DriverIndex{3}).hitpoints = 0;
		state.vehicle(unmanned).driver.reset();
		const RoadPicture picture = pictureOf(state, {});
		EXPECT_EQ(tokenOf(picture, wreck).wreck, road::Wreck::Wrecked);
		EXPECT_EQ(tokenOf(picture, unmanned).wreck, road::Wreck::NoDriver);
		EXPECT_FALSE(tokenOf(picture, unmanned).name.empty());
		EXPECT_TRUE(tokenOf(picture, unmanned).vehicle.empty()) << "unmanned, its vehicle is the title with no second line";
		EXPECT_FALSE(tokenOf(picture, vehicleOf(state, DriverIndex{4})).vehicle.empty());
		EXPECT_EQ(tokenOf(picture, vehicleOf(state, DriverIndex{4})).wreck, road::Wreck::None);
	}

	TEST(RoadPicture, ThePlannedTurnShowsAPillPerStepAndTheElitesHidden) {
		const BattleState				 state = fight();
		const std::vector<rules::Intent> intents = rules::intentsOf(state, game::testing::testRules().content);
		ASSERT_FALSE(intents.empty());
		const RoadPicture picture = pictureOf(state, intents);
		for (const DriverIndex raider : {DriverIndex{2}, DriverIndex{3}, DriverIndex{4}}) {
			const TokenData& token = tokenOf(picture, vehicleOf(state, raider));
			const auto		 steps = std::ranges::count(intents, raider, &rules::Intent::raider);
			ASSERT_EQ(token.intents.size(), static_cast<size_t>(steps)) << raider.value;
			for (const road::TokenIntent& pill : token.intents) {
				EXPECT_EQ(pill.value == "?", raider == DriverIndex{4}) << "the Warlord's are hidden, the others' aren't";
			}
		}
		// Every intent at a vehicle draws a line from its raider, red for an attack.
		size_t aimed = 0;
		for (const rules::Intent& intent : intents) {
			aimed += intent.target || intent.area ? 1 : 0;
		}
		EXPECT_EQ(picture.intents.size(), aimed);
		for (const road::IntentLine& line : picture.intents) {
			EXPECT_EQ(state.vehicle(line.from).side, Side::Raiders);
		}
	}

	TEST(RoadPicture, AnIntentsValueAndMarkSayWhatItDoesToWhom) {
		const BattleState  state = fight();
		const VehicleIndex first = vehicleOf(state, DriverIndex{0});
		const VehicleIndex second = vehicleOf(state, DriverIndex{1});
		const VehicleIndex escort{
			static_cast<int>(std::ranges::find_if(state.vehicles, &rules::BattleVehicle::isEscort) - state.vehicles.begin())
		};
		const VehicleIndex				 bike = vehicleOf(state, DriverIndex{2});
		const DriverIndex				 raider{2};
		const std::vector<rules::Intent> intents{
			{.raider = raider, .step = 0, .kind = IntentKind::Attack, .target = first, .hits = {6, 6, 6}},
			{.raider = raider, .step = 1, .kind = IntentKind::Attack, .target = second, .misses = 1},
			{.raider = raider, .step = 2, .kind = IntentKind::Attack, .area = true, .hits = {4, 6}},
			{.raider = raider, .step = 3, .kind = IntentKind::Debuff, .target = escort, .statuses = {rules::Status::Vulnerable}},
			{.raider = raider, .step = 4, .kind = IntentKind::Defend, .target = bike, .defense = 5},
			{.raider = raider, .step = 5, .kind = IntentKind::Attack, .target = first, .hits = {3, 5}},
		};
		const RoadPicture					   picture = pictureOf(state, intents);
		const TokenData&					   token = tokenOf(picture, bike);
		std::vector<std::string>			   values;
		std::vector<std::optional<TargetMark>> marks;
		for (const road::TokenIntent& pill : token.intents) {
			values.push_back(pill.value);
			marks.push_back(pill.mark);
		}
		EXPECT_EQ(values, (std::vector<std::string>{"6x3", "MISS", "6", "VUL", "+5", "8"}));
		EXPECT_EQ(
			marks,
			(std::vector<std::optional<TargetMark>>{
				TargetMark::Triangle, TargetMark::Diamond, TargetMark::Both, TargetMark::Square, std::nullopt, TargetMark::Triangle
			})
		);
		EXPECT_EQ(token.intents[3].kind, IntentKind::Debuff);
		// Its own Defend draws no line; the area hit's line names nobody.
		ASSERT_EQ(picture.intents.size(), 5U);
		EXPECT_EQ(picture.intents[2], (road::IntentLine{.from = bike, .to = std::nullopt, .attack = true}));
		EXPECT_EQ(picture.intents[3], (road::IntentLine{.from = bike, .to = escort, .attack = false}));
	}

	TEST(RoadPicture, PlannedSwervesAndArrivingRowsAreMarked) {
		const BattleState				 state = fight();
		const VehicleIndex				 bike = vehicleOf(state, DriverIndex{2});
		const rules::RoadSlot			 to{.lane = rules::RoadLane::RaiderOutside, .row = rules::Row::Ahead};
		const std::vector<rules::Intent> intents{
			{.raider = DriverIndex{2}, .step = 0, .kind = IntentKind::Move, .movesTo = to},
			{.raider = DriverIndex{2}, .step = 1, .kind = IntentKind::Move, .movesTo = to},
		};
		const std::vector<rules::RoadSlot> arrivals{
			{.lane = rules::RoadLane::RaiderInside, .row = rules::Row::Behind},
			{.lane = rules::RoadLane::RaiderOutside, .row = rules::Row::Ahead},
			{.lane = rules::RoadLane::RaiderOutside, .row = rules::Row::Behind},
		};
		const RoadPicture picture = pictureOf(state, intents, arrivals);
		EXPECT_EQ(picture.planned, (std::vector<road::PlannedMove>{{.raider = bike, .to = to}}));
		EXPECT_EQ(picture.arrivals, (std::vector<rules::Row>{rules::Row::Ahead, rules::Row::Behind}));
		EXPECT_EQ(tokenOf(picture, bike).intents.front().value, "MOVE");
	}

	TEST(RoadPicture, EachVehicleDrawsTheRearViewOfItsClassAndAClassWithNoneTheGenericOne) {
		const BattleState state = fight();

		const auto artByName = [](const RoadPicture& picture) {
			std::map<std::string, std::string> art;
			for (const road::RoadVehicle& vehicle : picture.vehicles) {
				art[vehicle.token.name] = road::VehicleToken::artFor(vehicle.token.vehicleClass);
			}
			return art;
		};
		EXPECT_EQ(
			artByName(pictureOf(state, {})),
			(std::map<std::string, std::string>{
				{"Road Warrior 1", "vehicle-rig"},
				{"Interceptor 2", "vehicle-bike"},
				{"Outrider", "vehicle-bike"},
				{"Scavenger", "vehicle-bike"},
				{"Wasteland Raider", "vehicle-buggy"},
				{"Warlord", "vehicle-rig"},
			})
		);
		rules::Content modded = game::testing::testRules().content;
		modded.escorts.at(rules::EscortId{"outrider"}).vehicleClass = "hovercraft";
		modded.opponents.at(rules::OpponentId{"warlord"}).vehicle.vehicleClass.clear();
		const std::map<std::string, std::string> fallen = artByName(road::roadPicture(state, modded, {}, {}, kSeats));
		EXPECT_EQ(fallen.at("Outrider"), "vehicle-generic") << "a class with no drawing";
		EXPECT_EQ(fallen.at("Warlord"), "vehicle-generic") << "no class at all";
	}

	TEST(RoadPicture, EveryVehicleClassInTheBasePackHasADrawingOfItsOwn) {
		const rules::Content&							 content = game::testing::testRules().content;
		std::vector<std::pair<std::string, std::string>> classes;
		for (const auto& [id, driver] : content.drivers) {
			classes.emplace_back(driver.vehicle.name, driver.vehicle.vehicleClass);
		}
		for (const auto& [id, opponent] : content.opponents) {
			classes.emplace_back(opponent.vehicle.name, opponent.vehicle.vehicleClass);
		}
		for (const auto& [id, escort] : content.escorts) {
			classes.emplace_back(escort.name, escort.vehicleClass);
		}
		for (const auto& [vehicle, vehicleClass] : classes) {
			EXPECT_NE(road::VehicleToken::artFor(vehicleClass), "vehicle-generic") << vehicle << " (" << vehicleClass << ")";
		}
	}

} // namespace
