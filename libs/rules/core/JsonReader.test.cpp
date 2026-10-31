#include <rules/core/ContentError.h>
#include <rules/core/JsonReader.h>
#include <rules/core/Road.h>

#include <gtest/gtest.h>

namespace {

	using rules::ContentError;
	using rules::JsonReader;

	// The ContentError `read` throws, so a test can check what it names.
	template <typename Read>
	std::string errorFrom(Read&& read) {
		try {
			read();
		} catch (const ContentError& error) {
			return error.what();
		}
		ADD_FAILURE() << "expected a ContentError";
		return "";
	}

	TEST(JsonReader, ReadsTheFieldsItIsAskedFor) {
		const auto json = nlohmann::json::parse(R"({"count": 3, "name": "Scav", "fast": true, "tags": ["a", "b"]})");
		JsonReader reader(json, "test.json");
		EXPECT_EQ(reader.requireInt("count"), 3);
		EXPECT_EQ(reader.requireString("name"), "Scav");
		EXPECT_TRUE(reader.optionalBool("fast"));
		EXPECT_EQ(reader.requireStrings("tags"), (std::vector<std::string>{"a", "b"}));
		EXPECT_EQ(reader.optionalInt("missing"), std::nullopt);
		reader.finish();
	}

	TEST(JsonReader, NamesTheFileAndPathOfAMissingField) {
		const auto		  json = nlohmann::json::parse(R"({"cards": [{"id": "ram"}]})");
		JsonReader		  reader(json, "cards.json");
		const std::string message = errorFrom([&] { (void)reader.requireObjects("cards")[0].requireInt("cost"); });
		EXPECT_EQ(message, "cards.json.cards[0].cost is required");
	}

	TEST(JsonReader, RejectsAWrongType) {
		const auto json = nlohmann::json::parse(R"({"cost": 1.5, "name": 3})");
		JsonReader reader(json, "test.json");
		EXPECT_NE(errorFrom([&] { (void)reader.requireInt("cost"); }).find("whole number"), std::string::npos);
		EXPECT_NE(errorFrom([&] { (void)reader.requireString("name"); }).find("must be a string"), std::string::npos);
	}

	TEST(JsonReader, FinishRejectsFieldsNothingRead) {
		const auto json = nlohmann::json::parse(R"({"cost": 1, "cots": 2})");
		JsonReader reader(json, "test.json");
		(void)reader.requireInt("cost");
		EXPECT_EQ(errorFrom([&] { reader.finish(); }), "test.json has fields nothing reads: cots");
	}

	TEST(JsonReader, ListsTheNamesAnEnumTakes) {
		const auto json = nlohmann::json::parse(R"({"row": "middle"})");
		JsonReader reader(json, "test.json");
		EXPECT_EQ(
			errorFrom([&] { (void)reader.requireEnum("row", rules::kRowNames); }),
			"test.json.row \"middle\" is not one of ahead, center, behind"
		);
	}

} // namespace
