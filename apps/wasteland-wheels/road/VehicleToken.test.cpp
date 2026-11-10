// The vehicle token (Battle Screen Design 3, vehicle-token.md): its height with and without a passenger, how it scales into
// a slot, its chips and intents past what fits, the rear view its vehicle class draws, and every kind of token laid out
// and linted 0 on a sheet.

#include "road/VehicleToken.h"
#include "GameTesting.h"
#include "atlas/Art.h"
#include "atlas/Sheet.h"

#include <nlohmann/json.hpp>

#include <string>
#include <utility>
#include <vector>

namespace {

	using namespace game;
	using namespace game::testing;
	using road::TokenData;
	using road::TokenSide;
	using road::VehicleToken;

	TokenData player() {
		return {
			.name = "Road Warrior 1",
			.vehicle = "War Rig",
			.vehicleClass = "rig",
			.side = TokenSide::Player,
			.seat = 0,
			.structure = {.value = 34, .max = 40},
			.armor = 6,
			.driver = road::Meter{.value = 22, .max = 30},
			.speed = 1,
			.statuses = {"SH4", "VUL"},
		};
	}

	TokenData raider() {
		return {
			.name = "Wasteland Raider",
			.vehicle = "Spiked Interceptor of the Long Road",
			.vehicleClass = "buggy",
			.side = TokenSide::Raider,
			.structure = {.value = 12, .max = 20},
			.armor = 2,
			.driver = road::Meter{.value = 9, .max = 12},
			.speed = 3,
			.intents = {
				{.value = "6", .mark = road::TargetMark::Triangle},
				{.value = "4x2", .mark = road::TargetMark::Both},
				{.value = "3", .mark = road::TargetMark::Diamond}
			},
		};
	}

	TokenData escort() {
		return {
			.name = "Fuel Hauler",
			.vehicleClass = "tanker",
			.side = TokenSide::Escort,
			.structure = {.value = 18, .max = 20},
			.passenger = road::Meter{.value = 14, .max = 25},
			.speed = 2,
			.statuses = {"SH6", "VUL", "SLW", "BRN", "JAM"},
			.spent = true,
		};
	}

	TEST(VehicleToken, APassengersRowMakesItTallerExceptOnAnEscort) {
		EXPECT_FLOAT_EQ(VehicleToken::heightFor(player()), VehicleToken::kHeight);
		TokenData carrying = player();
		carrying.passenger = road::Meter{.value = 10, .max = 25};
		EXPECT_FLOAT_EQ(VehicleToken::heightFor(carrying), VehicleToken::kPassengerHeight);
		EXPECT_FLOAT_EQ(VehicleToken::heightFor(escort()), VehicleToken::kHeight);
	}

	TEST(VehicleToken, ItScalesIntoItsSlotBetweenOneAndTheRoadsCap) {
		EXPECT_FLOAT_EQ(VehicleToken::slotScale({202.0F, 121.0F}, VehicleToken::kHeight), 1.0F);
		EXPECT_LT(VehicleToken::slotScale({150.0F, 121.0F}, VehicleToken::kHeight), 1.0F) << "too small reads under 1";
		EXPECT_FLOAT_EQ(VehicleToken::fitScale({150.0F, 121.0F}, VehicleToken::kHeight), 1.0F);
		EXPECT_FLOAT_EQ(VehicleToken::fitScale({400.0F, 300.0F}, VehicleToken::kHeight), VehicleToken::kMaxScale);
		EXPECT_FLOAT_EQ(VehicleToken::fitScale({400.0F, 300.0F}, VehicleToken::kHeight, 1.1F), 1.1F);
		// A passenger's taller token takes less of the same slot.
		EXPECT_LT(
			VehicleToken::slotScale({300.0F, 150.0F}, VehicleToken::kPassengerHeight),
			VehicleToken::slotScale({300.0F, 150.0F}, VehicleToken::kHeight)
		);
	}

	TEST(VehicleToken, PastFiveChipsItShowsFourAndTheRestCountedAndPastTwoIntentsTheRestCounted) {
		const VehicleToken spent({.data = escort()});
		EXPECT_EQ(spent.shownChips(), (std::vector<std::string>{"SPENT", "SH6", "VUL", "SLW", "+2"}));
		const VehicleToken rig({.data = player()});
		EXPECT_EQ(rig.shownChips(), (std::vector<std::string>{"SH4", "VUL"}));
		const VehicleToken interceptor({.data = raider()});
		EXPECT_EQ(interceptor.shownIntents(), (std::vector<std::string>{"6", "4x2", "+1"}));
	}

	TEST(VehicleToken, EachVehicleClassHasItsOwnRearViewAndAnyOtherClassTheGenericOne) {
		const std::vector<std::pair<std::string, std::string>> drawn{
			{"bike", "vehicle-bike"},
			{"buggy", "vehicle-buggy"},
			{"car", "vehicle-car"},
			{"truck", "vehicle-truck"},
			{"rig", "vehicle-rig"},
			{"tanker", "vehicle-tanker"},
		};
		for (const auto& [vehicleClass, art] : drawn) {
			EXPECT_EQ(VehicleToken::artFor(vehicleClass), art) << vehicleClass;
			EXPECT_FALSE(game::art::art(art).empty()) << art << " isn't in art/";
		}
		EXPECT_EQ(VehicleToken::artFor("hovercraft"), "vehicle-generic");
		EXPECT_EQ(VehicleToken::artFor("Rig"), "vehicle-generic") << "classes are matched exactly";
		EXPECT_EQ(VehicleToken::artFor(""), "vehicle-generic");
		EXPECT_FALSE(game::art::art("vehicle-generic").empty());
	}

	class Tokens : public GameTest {};

	TEST_F(Tokens, EveryKindLaysOutAtItsSizeAndLintsZero) {
		start(fixtureMakers(), true);
		openParts([](ui::Ref<ui::Component> root) {
			ui::Ref<atlas::Sheet> sheet = root.addChild<atlas::Sheet>({
				.id = "sheet",
				.size = {ui::percent(100.0F), ui::percent(100.0F)},
				.layout =
					{.display = ui::Display::Flex,
					 .flexDirection = ui::FlexDirection::Row,
					 .gap = 24.0F,
					 .alignItems = ui::AlignItems::Start},
				.identity = "tokens",
			});
			ui::Layout			  padded = sheet.get()->getLayout();
			padded.padding = ui::Edges(60.0F);
			padded.flexWrap = ui::FlexWrap::Wrap;
			sheet.get()->setLayout(padded);
			TokenData carrying = player();
			carrying.passenger = road::Meter{.value = 10, .max = 25};
			TokenData wreck = raider();
			wreck.wreck = road::Wreck::Wrecked;
			TokenData unmanned = raider();
			unmanned.wreck = road::Wreck::NoDriver;
			sheet.addChild<VehicleToken>({.id = "rig", .data = player()});
			sheet.addChild<VehicleToken>({.id = "carrying", .data = carrying});
			sheet.addChild<VehicleToken>({.id = "raider", .data = raider()});
			sheet.addChild<VehicleToken>({.id = "hauler", .data = escort()});
			sheet.addChild<VehicleToken>({.id = "wreck", .data = wreck});
			sheet.addChild<VehicleToken>({.id = "unmanned", .data = unmanned});
			sheet.addChild<VehicleToken>({.id = "big", .data = player(), .scale = VehicleToken::kMaxScale});
		});
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(find("rig")->getSize(), (Foundation::Vec2{VehicleToken::kWidth, VehicleToken::kHeight}));
		EXPECT_EQ(find("carrying")->getSize(), (Foundation::Vec2{VehicleToken::kWidth, VehicleToken::kPassengerHeight}));
		EXPECT_EQ(find("hauler")->getSize(), (Foundation::Vec2{VehicleToken::kWidth, VehicleToken::kHeight}));
		EXPECT_EQ(
			find("big")->getSize(),
			(Foundation::Vec2{VehicleToken::kWidth * VehicleToken::kMaxScale, VehicleToken::kHeight * VehicleToken::kMaxScale})
		);
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
		const auto artOf = [this](const char* id) {
			nlohmann::json described;
			find(id)->describe(described);
			return described["art"].get<std::string>();
		};
		EXPECT_EQ(artOf("rig"), "vehicle-rig");
		EXPECT_EQ(artOf("raider"), "vehicle-buggy");
		EXPECT_EQ(artOf("hauler"), "vehicle-tanker");
		EXPECT_EQ(artOf("wreck"), "vehicle-buggy") << "a wreck keeps its shape, greyed";
		const auto lines = [this](const char* id) {
			nlohmann::json described;
			find(id)->describe(described);
			return std::pair{described["name"].get<std::string>(), described["vehicle"].get<std::string>()};
		};
		EXPECT_EQ(lines("rig"), (std::pair<std::string, std::string>{"Road Warrior 1", "War Rig"}))
			<< "a driver's name, the vehicle under it";
		EXPECT_EQ(lines("hauler"), (std::pair<std::string, std::string>{"Fuel Hauler", ""})) << "no driver: the vehicle is the title alone";
	}

} // namespace
