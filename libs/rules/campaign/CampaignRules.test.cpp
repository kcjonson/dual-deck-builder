#include <rules/campaign/CampaignTesting.h>
#include <rules/core/ContentError.h>

#include <gtest/gtest.h>

#include <array>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>

namespace {

	using namespace rules;
	using namespace rules::campaigns;
	namespace fs = std::filesystem;

	const fs::path kBase = fs::path(DDB_PACKS_DIR) / "base";

	constexpr std::string_view kSmallStart = R"({
		"poolSize": 2,
		"resources": {"food": 5, "water": 5, "fuel": 1, "meds": 0, "scrap": 0, "people": 4},
		"escorts": ["fuel_hauler"],
		"buildings": ["garage", "bunkhouse"]
	})";

	// Packs over the base pack, written to a scratch folder for one test and deleted after it.
	class CampaignPacks : public ::testing::Test {
	  protected:
		fs::path scratch;

		void SetUp() override {
			scratch = fs::temp_directory_path() /
					  (std::string("ddb-campaign-") + ::testing::UnitTest::GetInstance()->current_test_info()->name());
			fs::remove_all(scratch);
		}

		void TearDown() override { fs::remove_all(scratch); }

		fs::path pack(std::string_view id, std::string_view requiredPacks) {
			const fs::path root = scratch / std::string(id);
			write(
				root / "pack.json",
				std::string(R"({"id": ")") + std::string(id) + R"(", "name": "Test", "version": "1", "requires": )" +
					std::string(requiredPacks) + "}"
			);
			return root;
		}

		static void write(const fs::path& file, std::string_view text) {
			fs::create_directories(file.parent_path());
			std::ofstream(file, std::ios::binary) << text;
		}

		static std::string errorFrom(const std::vector<fs::path>& roots) {
			const Content content = loadPacks(roots);
			try {
				(void)loadCampaignRules(content);
			} catch (const ContentError& error) {
				return error.what();
			}
			ADD_FAILURE() << "expected a ContentError";
			return "";
		}

		static bool mentions(const std::string& message, std::string_view part) { return message.find(part) != std::string::npos; }
	};

	TEST(CampaignRules, TheBasePackStartsAWeekOfFoodAndTheBunkhouseWithDecksOf8To20) {
		const CampaignRules& rules = testRules();
		EXPECT_EQ(rules.start.poolSize, 4);
		EXPECT_EQ(rules.start.stores, (Resources{.food = 21, .water = 21, .fuel = 10, .meds = 3, .scrap = 150, .people = 12}));
		EXPECT_TRUE(rules.start.escorts.empty());
		EXPECT_EQ(rules.start.buildings, std::vector{Building::Bunkhouse});
		EXPECT_EQ(rules.deck.fewestCards, 8);
		EXPECT_EQ(rules.deck.mostCards, 20);
		EXPECT_EQ(rules.deck.scrapPerCard, 5);
		EXPECT_EQ(rules.compound.peoplePerFood, 4);
		EXPECT_EQ(rules.compound.hitpointsPerDay, 10);
		EXPECT_EQ(rules.compound.scavengedScrap.least, 5);
		EXPECT_EQ(rules.compound.scavengedScrap.most, 15);
		EXPECT_EQ(rules.compound.riotAtUnrest, 10);
		EXPECT_EQ(rules.compound.returnAmbush, (std::array<int, kMostStage + 1>{0, 0, 3, 6, 9, 12, 15}))
			<< "none before stage 2, then 3 in a hundred a stage";
		EXPECT_EQ(rules.garage.stock, 4);
		EXPECT_EQ(rules.garage.cardPrices.size(), 4U);
		EXPECT_EQ(rules.garage.cardPrices.at(Rarity::Rare), 90);
		EXPECT_EQ(rules.garage.repairPerPoint, 1);
		EXPECT_EQ(rules.garage.hirePrices.at(EscortId{"med_truck"}), 90);
	}

	TEST_F(CampaignPacks, ALaterPackReplacesAFileWholeAndOnlyOverAPackItRequires) {
		const fs::path expansion = pack("expansion", R"(["base"])");
		write(expansion / "campaign" / "start.json", kSmallStart);
		const std::vector<fs::path> roots{kBase, expansion};
		const CampaignRules			rules = loadCampaignRules(loadPacks(roots));
		EXPECT_EQ(rules.start.poolSize, 2);
		EXPECT_EQ(rules.start.escorts, std::vector{EscortId{"fuel_hauler"}});
		EXPECT_EQ(rules.start.buildings, (std::vector{Building::Bunkhouse, Building::Garage})) << "in building order";
		EXPECT_EQ(rules.deck.mostCards, 20) << "the files it doesn't have are still the base pack's";

		const fs::path rival = pack("rival", "[]");
		write(rival / "campaign" / "start.json", kSmallStart);
		const std::string error = errorFrom({kBase, rival});
		EXPECT_TRUE(mentions(error, "pack rival overrides campaign/start.json from pack base without requiring base")) << error;
	}

	TEST_F(CampaignPacks, AnUnknownFieldFileOrEscortFailsNamingIt) {
		const fs::path field = pack("field", R"(["base"])");
		write(field / "campaign" / "deck-rules.json", R"({"deckSize": {"min": 8, "max": 20}, "scrapPerCard": 5, "handLimit": 7})");
		EXPECT_TRUE(mentions(errorFrom({kBase, field}), "handLimit"));

		const fs::path odds = pack("odds", R"(["base"])");
		std::ifstream  compound(kBase / "campaign" / "compound-rules.json", std::ios::binary);
		std::string	   text((std::istreambuf_iterator<char>(compound)), std::istreambuf_iterator<char>());
		text.replace(text.find("[0, 0, 3"), std::string("[0, 0, 3").size(), "[0, 3");
		write(odds / "campaign" / "compound-rules.json", text);
		EXPECT_TRUE(mentions(errorFrom({kBase, odds}), "returnAmbush.percentByStage must be 7 chances in a hundred"));

		const fs::path notes = pack("notes", R"(["base"])");
		write(notes / "campaign" / "notes.txt", "remember the milk");
		EXPECT_TRUE(mentions(errorFrom({kBase, notes}), "notes.txt"));

		const fs::path rig = pack("rig", R"(["base"])");
		std::string	   start(kSmallStart);
		start.replace(start.find("fuel_hauler"), std::string("fuel_hauler").size(), "war_rig");
		write(rig / "campaign" / "start.json", start);
		EXPECT_TRUE(mentions(errorFrom({kBase, rig}), "names escort war_rig, which no loaded pack defines"));

		const fs::path hire = pack("hire", R"(["base"])");
		write(
			hire / "campaign" / "garage-rules.json",
			R"({"stock": 4, "cardPrices": {"common": 1, "uncommon": 2, "rare": 3, "legendary": 4}, "repairPerPoint": 1,
				"hirePrices": {"war_rig": 50}})"
		);
		EXPECT_TRUE(mentions(errorFrom({kBase, hire}), "hirePrices.war_rig names escort war_rig, which no loaded pack defines"));
	}

} // namespace
