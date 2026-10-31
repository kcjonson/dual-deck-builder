#include <rules/core/ContentError.h>
#include <rules/map/AreaMapPipeline.h>
#include <rules/map/PoiData.h>
#include <rules/map/StopData.h>
#include <rules/map/StopRoom.h>
#include <rules/map/StopTables.h>

#include <gtest/gtest.h>

#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <vector>

namespace {

	using namespace rules::map;
	namespace fs = std::filesystem;

	const MapContent& base() {
		static const MapContent content = readMapContent(fs::path(DDB_PACKS_DIR) / "base");
		return content;
	}

	// The error reading `text` as a file of its own, or empty when it reads.
	template <typename Read>
	std::string errorFrom(std::string_view name, std::string_view text, Read read) {
		const fs::path folder = fs::temp_directory_path() / "ddb-map-content";
		fs::create_directories(folder);
		const fs::path file = folder / name;
		std::ofstream(file, std::ios::binary) << text;
		try {
			(void)read(file);
		} catch (const rules::ContentError& error) {
			return error.what();
		}
		return "";
	}

	// The base pack's file with `from` replaced by `to`, once.
	std::string edited(std::string_view file, std::string_view from, std::string_view to) {
		std::ifstream stream(fs::path(DDB_PACKS_DIR) / "base" / "map" / file, std::ios::binary);
		std::string	  text((std::istreambuf_iterator<char>(stream)), std::istreambuf_iterator<char>());
		const size_t  at = text.find(from);
		EXPECT_NE(at, std::string::npos) << from;
		return text.replace(at, from.size(), to);
	}

	TEST(MapContent, ReadsTheBasePacksPoisFactionsAndStops) {
		const MapContent& content = base();
		EXPECT_EQ(content.pois.rings.targets, (std::vector<int>{5, 7, 9, 9}));
		EXPECT_EQ(content.pois.cover, (std::vector<Resource>{Resource::Food, Resource::Water, Resource::Fuel}));
		EXPECT_EQ(content.pois.placement.size(), 7U);
		EXPECT_EQ(content.pois.types.at("farm").yields[static_cast<size_t>(Resource::Food)], 12);
		EXPECT_EQ(content.factions.size(), 10U);
		// In id order.
		EXPECT_EQ(content.factions.front().id, "asphaltPhantoms");
		EXPECT_EQ(content.stops.tightGap, 12);
		EXPECT_EQ(content.stops.bands[3].fights.min, 2);
		EXPECT_EQ(content.stops.dawn, 6);
		EXPECT_EQ(content.stops.types[static_cast<size_t>(StopType::Warband)].hours, 1.5);
	}

	TEST(MapContent, ReadsPoisAndStopsStrictlyNamingTheFile) {
		const auto pois = [](const fs::path& file) {
			return readPoiTuning(file);
		};
		const auto stops = [](const fs::path& file) {
			return readStopTuning(file);
		};
		const auto poisWith = [&](std::string_view from, std::string_view to) {
			return errorFrom("pois.json", edited("pois.json", from, to), pois);
		};
		const auto stopsWith = [&](std::string_view from, std::string_view to) {
			return errorFrom("stops.json", edited("stops.json", from, to), stops);
		};
		EXPECT_EQ(poisWith("\"fitJitter\": 0.1", "\"fitJitter\": 0.1"), "");
		EXPECT_NE(
			poisWith("\"types\": [\"farm\", \"silo\"]", "\"types\": [\"farm\", \"barn\"]").find("names barn, which isn't a type"),
			std::string::npos
		);
		EXPECT_NE(
			poisWith(
				"{ \"types\": [\"salvageYard\"], \"where\": [{}] }",
				"{ \"types\": [\"salvageYard\"], \"where\": [{ \"ruinAtLeast\": 0.1 }] }"
			)
				.find("must end with a rule that holds everywhere"),
			std::string::npos
		);
		EXPECT_NE(
			poisWith("\"cover\": [\"food\", \"water\", \"fuel\"]", "\"cover\": [\"food\", \"food\"]").find("lists food twice"),
			std::string::npos
		);
		EXPECT_NE(poisWith("\"biomes\": [\"mountains\"]", "\"biomes\": [\"peaks\"]").find("\"peaks\" is not one of"), std::string::npos);
		EXPECT_NE(poisWith("\"outer\": 0.97", "\"outer\": 0.5").find("outer must be past inner"), std::string::npos);
		EXPECT_NE(poisWith("\"step\": 12,", "\"step\": 12, \"steps\": 3,").find("fields nothing reads: steps"), std::string::npos);
		EXPECT_NE(stopsWith("\"tightGap\": 12", "\"tightGap\": 50").find("tightGap must be at most minGap"), std::string::npos);
		EXPECT_NE(
			stopsWith("\"fights\": { \"min\": 1, \"max\": 2 }", "\"fights\": { \"min\": 0, \"max\": 2 }").find("min must be at least 1"),
			std::string::npos
		);
		EXPECT_NE(
			stopsWith("\"extras\": [2, 4]", "\"extras\": [4, 2]").find("extras must be game stages from 1, rising"), std::string::npos
		);
		EXPECT_NE(stopsWith("\"dawn\": 6", "\"dusk\": 20").find("dawn is required"), std::string::npos);
		fs::remove_all(fs::temp_directory_path() / "ddb-map-content");
	}

	TEST(StopTables, DrawByTheirWeightsOnlyTypesTheRunResolves) {
		const StopTables& tables = base().stopTables;
		EXPECT_EQ(tables.territories().size(), 1U);
		const int none = tables.territory(kNoTerritory);
		// A highway at tier 3: ambushes 7 to a warband's 1, and the calm types the run resolves, wrecks 3, distress 2, Find:
		// driver 0.2, cards 1, and supplies 2, in type order; checkpoints, garages, and the rest weigh nothing.
		EXPECT_EQ(tables.draw(RoadClass::Highway, Biome::Scrub, 3, none, 0.874, true), StopType::Ambush);
		EXPECT_EQ(tables.draw(RoadClass::Highway, Biome::Scrub, 3, none, 0.876, true), StopType::Warband);
		EXPECT_EQ(tables.draw(RoadClass::Highway, Biome::Scrub, 3, none, 0.36, false), StopType::Wreck);
		EXPECT_EQ(tables.draw(RoadClass::Highway, Biome::Scrub, 3, none, 0.37, false), StopType::Distress);
		EXPECT_EQ(tables.draw(RoadClass::Highway, Biome::Scrub, 3, none, 0.999, false), StopType::FindSupplies);
		// No warbands at tier 1.
		EXPECT_EQ(tables.draw(RoadClass::Trail, Biome::Mire, 1, none, 0.999, true), StopType::Ambush);
		for (int step = 0; step < 100; ++step) {
			for (const auto& [name, road] : kRoadClassNames) {
				for (const auto& [biomeName, biome] : kBiomeNames) {
					EXPECT_TRUE(isFight(tables.draw(road, biome, 5, none, step / 100.0, true)));
					const StopType calm = tables.draw(road, biome, 5, none, step / 100.0, false);
					EXPECT_TRUE(isCalm(calm) && isResolvable(calm)) << kStopTypeNames[static_cast<size_t>(calm)].first;
				}
			}
		}
	}

	TEST(MapContent, ReadsTheStopTablesStrictlyAndFailsARowWithNothingToDraw) {
		const auto read = [](const fs::path& file) {
			return readStopTables(file);
		};
		const auto tablesWith = [&](std::string_view from, std::string_view to) {
			return errorFrom("stop-tables.json", edited("stop-tables.json", from, to), read);
		};
		EXPECT_EQ(tablesWith("\"scrub\": {}", "\"scrub\": {}"), "");
		EXPECT_NE(
			tablesWith("\"scrub\": {}", "\"scrub\": { \"ambushes\": 2 }").find("biomes.scrub has fields nothing reads: ambushes"),
			std::string::npos
		);
		EXPECT_NE(tablesWith("\"scrub\": {}", "\"swamp\": {}").find("\"swamp\" is not one of"), std::string::npos);
		EXPECT_NE(tablesWith("\"3\": {}", "\"6\": {}").find("\"6\" is not a tier from 1 to 5"), std::string::npos);
		EXPECT_NE(tablesWith("\"none\": {", "\"scavengers\": {").find("must hold \"none\""), std::string::npos);
		EXPECT_NE(tablesWith("\"3\": {}", "\"3\": { \"wreck\": -1 }").find("tiers.3.wreck must be at least 0"), std::string::npos);
		// Tier 1 already weighs no warband, so no ambush leaves a tier 1 fight nothing to be.
		EXPECT_NE(
			tablesWith("\"ambush\": 0.8, \"findSupplies\": 1.3", "\"ambush\": 0, \"findSupplies\": 1.3")
				.find("highway in scrub at tier 1 in territory none weighs no fight"),
			std::string::npos
		);
		EXPECT_NE(
			tablesWith(
				"\"checkpoint\": 1.5, \"findSupplies\": 0.6",
				"\"wreck\": 0, \"distress\": 0, \"findDriver\": 0, \"findCards\": 0, \"findSupplies\": 0"
			)
				.find("highway in scrub at tier 5 in territory none weighs no calm stop"),
			std::string::npos
		);
		fs::remove_all(fs::temp_directory_path() / "ddb-map-content");
	}

	TEST(StopRoom, PicksTheNearestPointClearOfEveryJunctionTheLowerOfTwo) {
		const std::vector<double> joins{50};
		EXPECT_EQ(nearestClear(30, 0, 100, joins, 8), 30);
		// 48 is inside the junction's clearance: 42 is two off, 58 ten.
		EXPECT_EQ(nearestClear(44, 0, 100, joins, 8), 42);
		EXPECT_EQ(nearestClear(50, 0, 100, joins, 8), 42);
		EXPECT_EQ(nearestClear(56, 0, 100, joins, 8), 58);
		// A target outside the range aims at its end.
		EXPECT_EQ(nearestClear(120, 0, 100, joins, 8), 100);
		EXPECT_FALSE(nearestClear(50, 45, 55, joins, 8).has_value());
		const LegSpan span = legSpan(100, 12, base().stops);
		EXPECT_EQ(span.from, 21);
		EXPECT_EQ(span.to, 79);
	}

	TEST(StopRoom, NeedsTheFightFloorOrHalfTheBandsLeastStopsOnARoutesOwnRoad) {
		const StopTuning& stops = base().stops;
		EXPECT_EQ(ownRoadNeed(1, stops), 2);
		EXPECT_EQ(ownRoadNeed(3, stops), 2);
		EXPECT_EQ(ownRoadNeed(4, stops), 3);
		EXPECT_EQ(ownRoadNeed(5, stops), 3);
		// A tier past the bands reads as the last.
		EXPECT_EQ(ownRoadNeed(9, stops), 3);
		// Two warbands, the costliest fight, and a Find: driver, out and home on a two-hour route, then the objective.
		EXPECT_DOUBLE_EQ(floorRunHours(2, 3, 1.5, stops), 4 + 2 * 1.5 + 0.5 + 1.5);
	}

	TEST(StopRoom, PacksALegsStopsAGapApartClearOfItsEndsAndItsJunctions) {
		const StopTuning& stops = base().stops;
		// 100 units, 15 kept from each end and half a gap more: 21 to 79, which holds 5 at 12 apart.
		EXPECT_EQ(legRoom(100, {}, 12, stops), 5);
		// A junction at 50 clears 42 to 58: 21, 33, then 58 and 70.
		EXPECT_EQ(packAlong(21, 79, 12, std::vector<double>{50}, 8), (std::vector<double>{21, 33, 58, 70}));
		EXPECT_EQ(legRoom(100, std::vector<double>{50}, 12, stops), 4);
		// A short leg keeps a quarter of itself from each end.
		EXPECT_EQ(legEnds(40, stops), 10);
		EXPECT_EQ(legRoom(10, {}, 12, stops), 0);
	}

} // namespace
