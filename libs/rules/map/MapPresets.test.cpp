#include <rules/core/ContentError.h>
#include <rules/map/MapPresets.h>
#include <rules/map/ParamValidator.h>

#include <gtest/gtest.h>

#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>

namespace {

	using namespace rules;
	using namespace rules::map;
	namespace fs = std::filesystem;

	const fs::path kPresets = fs::path(DDB_PACKS_DIR) / "base" / "map" / "presets";

	MapParamSet setFrom(std::string_view text) {
		const nlohmann::json json = nlohmann::json::parse(text);
		return readMapParamSet(JsonReader(json, "preset.json"));
	}

	std::string errorFrom(std::string_view text) {
		try {
			(void)setFrom(text);
		} catch (const ContentError& error) {
			return error.what();
		}
		ADD_FAILURE() << "expected a ContentError reading " << text;
		return "";
	}

	TEST(MapPresets, ShipsADefaultPresetThatNeedsNoClamps) {
		const std::vector<MapPreset> presets = readMapPresets(kPresets);
		ASSERT_EQ(presets.size(), 1U);
		EXPECT_EQ(presets[0].name, "default");
		EXPECT_EQ(presets[0].params.seed, 2183746551U);
		EXPECT_EQ(presets[0].params.environment, Environment::Mixed);
		EXPECT_TRUE(validateMapParams(resolveMapParams(presets[0].params)).clamps.empty());
	}

	TEST(MapPresets, ReadsOnlyTheValuesAPresetOverrides) {
		const MapParamSet set = setFrom(R"({"seed": 0, "environment": "badlands", "rivers": 3, "aridity": 0.25})");
		EXPECT_EQ(set.seed, 0U);
		EXPECT_EQ(set.environment, Environment::Badlands);
		EXPECT_EQ(set.overrides[static_cast<size_t>(NumberParam::Rivers)], 3);
		EXPECT_EQ(set.overrides[static_cast<size_t>(NumberParam::Aridity)], 0.25);
		EXPECT_FALSE(set.overrides[static_cast<size_t>(NumberParam::Lakes)].has_value());
		EXPECT_EQ(resolveMapParams(set).lakes, 1);
	}

	TEST(MapPresets, KeepsAValueOutsideItsRangeForTheValidatorToReport) {
		const MapParamSet		 set = setFrom(R"({"seed": 4294967295, "environment": "mixed", "highways": 40})");
		const ValidatedMapParams validated = validateMapParams(resolveMapParams(set));
		EXPECT_EQ(validated.params.seed, 4294967295U);
		EXPECT_EQ(validated.params.highways, 9);
		ASSERT_FALSE(validated.clamps.empty());
		EXPECT_EQ(validated.clamps[0].param, "highways");
	}

	TEST(MapPresets, RefusesWhatIsntAParameterSetNamingWhere) {
		EXPECT_EQ(errorFrom(R"({"environment": "mixed"})"), "preset.json.seed is required");
		EXPECT_EQ(errorFrom(R"({"seed": -1, "environment": "mixed"})"), "preset.json.seed must be a whole number from 0 to 4294967295");
		EXPECT_EQ(
			errorFrom(R"({"seed": 4294967296, "environment": "mixed"})"), "preset.json.seed must be a whole number from 0 to 4294967295"
		);
		EXPECT_EQ(errorFrom(R"({"seed": 1})"), "preset.json.environment is required");
		EXPECT_EQ(
			errorFrom(R"({"seed": 1, "environment": "tundra"})"),
			"preset.json.environment \"tundra\" is not one of highDesert, rustBelt, floodlands, badlands, mixed"
		);
		EXPECT_EQ(errorFrom(R"({"seed": 1, "environment": "mixed", "rivers": 2.5})"), "preset.json.rivers must be a whole number");
		EXPECT_EQ(errorFrom(R"({"seed": 1, "environment": "mixed", "aridity": "dry"})"), "preset.json.aridity must be a number");
		EXPECT_EQ(
			errorFrom(R"({"seed": 1, "environment": "mixed", "mountainCoverge": 0.3})"),
			"preset.json has fields nothing reads: mountainCoverge"
		);
	}

	TEST(MapPresets, RefusesANumberTooBigForADoubleNamingTheFile) {
		const fs::path folder = fs::temp_directory_path() / "ddb-map-presets-infinite";
		fs::remove_all(folder);
		fs::create_directories(folder);
		std::ofstream(folder / "huge.json", std::ios::binary) << R"({"seed": 1, "environment": "mixed", "aridity": 1e999})";
		std::string message;
		try {
			(void)readMapPresets(folder);
		} catch (const ContentError& error) {
			message = error.what();
		}
		fs::remove_all(folder);
		EXPECT_NE(message.find("huge.json"), std::string::npos) << message;
	}

	TEST(MapPresets, RefusesAFileInTheFolderThatIsntJson) {
		const fs::path folder = fs::temp_directory_path() / "ddb-map-presets-stray";
		fs::remove_all(folder);
		fs::create_directories(folder);
		std::ofstream(folder / "notes.txt", std::ios::binary) << "tuning notes";
		std::string message;
		try {
			(void)readMapPresets(folder);
		} catch (const ContentError& error) {
			message = error.what();
		}
		fs::remove_all(folder);
		EXPECT_NE(message.find("notes.txt isn't a .json file"), std::string::npos) << message;
	}

} // namespace
