#include <rules/core/ContentError.h>
#include <rules/packs/Pack.h>

#include <gtest/gtest.h>

#include <fstream>

namespace {

	using namespace rules;
	namespace fs = std::filesystem;

	const fs::path kBase = fs::path(DDB_PACKS_DIR) / "base";

	constexpr std::string_view kCheapPointBlank = R"({"cards": [{
		"id": "point_blank", "name": "Point Blank", "summary": "Deal 3.", "description": "Deal 3 damage.",
		"rarity": "common", "cost": 0, "targetType": "enemy_single",
		"effects": [{"type": "damage", "value": 3, "range": 1, "target": "target"}],
		"tags": ["attack"], "image": "cards/point_blank.png"
	}]})";

	// Packs written to a scratch folder for one test, deleted after it.
	class PackLoading : public ::testing::Test {
	  protected:
		fs::path scratch;

		void SetUp() override {
			const auto* test = ::testing::UnitTest::GetInstance()->current_test_info();
			scratch = fs::temp_directory_path() / (std::string("ddb-packs-") + test->name());
			fs::remove_all(scratch);
		}

		void TearDown() override { fs::remove_all(scratch); }

		fs::path pack(std::string_view id, std::string_view requiredPacks = R"(["base"])") {
			const fs::path root = scratch / std::string(id);
			write(root / "pack.json", std::string(R"({"id": ")") + std::string(id) + R"(", "name": "Test", "version": "1", "requires": )" + std::string(requiredPacks) + "}");
			return root;
		}

		static void write(const fs::path& file, std::string_view text) {
			fs::create_directories(file.parent_path());
			std::ofstream(file, std::ios::binary) << text;
		}

		static std::string errorFrom(const std::vector<fs::path>& roots) {
			try {
				(void)loadPacks(roots);
			} catch (const ContentError& error) {
				return error.what();
			}
			ADD_FAILURE() << "expected a ContentError";
			return "";
		}

		static bool mentions(const std::string& message, std::string_view part) { return message.find(part) != std::string::npos; }
	};

	TEST(BasePack, LoadsWithEveryReferenceResolved) {
		const std::vector<fs::path> roots{kBase};
		const Content				content = loadPacks(roots);
		ASSERT_EQ(content.packs.size(), 1U);
		EXPECT_EQ(content.packs[0].id, PackId{"base"});
		EXPECT_EQ(content.cards.size(), 47U);
		EXPECT_EQ(content.drivers.size(), 4U);
		EXPECT_EQ(content.escorts.size(), 4U);
		EXPECT_EQ(content.opponents.size(), 4U);

		const OpponentDefinition& warlord = content.opponents.at(OpponentId{"warlord"});
		EXPECT_EQ(warlord.opponentClass, OpponentClass::Leader);
		EXPECT_EQ(warlord.intentTier, IntentTier::Elite);
		EXPECT_EQ(warlord.behavior.policy, "aggressive_flanker");
		EXPECT_EQ(content.escorts.at(EscortId{"med_truck"}).signatureCard, CardId{"triage"});
		EXPECT_EQ(content.cards.at(CardId{"ram"}).pack, PackId{"base"});
	}

	TEST_F(PackLoading, APackOverridesWhatItRequires) {
		const fs::path mod = pack("cheap");
		write(mod / "cards" / "cards.json", kCheapPointBlank);
		const Content content = loadPacks(std::vector<fs::path>{kBase, mod});
		const CardDefinition& card = content.cards.at(CardId{"point_blank"});
		EXPECT_EQ(card.cost, 0);
		EXPECT_EQ(card.pack, PackId{"cheap"});
		EXPECT_EQ(content.cards.size(), 47U);
	}

	TEST_F(PackLoading, AnOverrideNeedsTheOverriddenPackRequired) {
		const fs::path mod = pack("loner", "[]");
		write(mod / "cards" / "cards.json", kCheapPointBlank);
		EXPECT_TRUE(mentions(errorFrom({kBase, mod}), "pack loner overrides card point_blank from pack base without requiring base"));
	}

	TEST_F(PackLoading, TwoPacksCantOverrideTheSameIdUnlessOneRequiresTheOther) {
		const fs::path first = pack("first");
		const fs::path second = pack("second");
		write(first / "cards" / "cards.json", kCheapPointBlank);
		write(second / "cards" / "cards.json", kCheapPointBlank);
		EXPECT_TRUE(mentions(errorFrom({kBase, first, second}), "pack second overrides card point_blank from pack first without requiring first"));

		const fs::path layered = pack("layered", R"(["first"])");
		write(layered / "cards" / "cards.json", kCheapPointBlank);
		EXPECT_NO_THROW((void)loadPacks(std::vector<fs::path>{kBase, first, layered}));
	}

	TEST_F(PackLoading, RequiredPacksLoadFirst) {
		const fs::path mod = pack("early");
		EXPECT_TRUE(mentions(errorFrom({mod, kBase}), "requires base, which loads after it"));
		const fs::path orphan = pack("orphan", R"(["missing"])");
		EXPECT_TRUE(mentions(errorFrom({kBase, orphan}), "requires missing, which isn't among the packs loaded"));
	}

	TEST_F(PackLoading, AnIdDefinedTwiceInOnePackFails) {
		const fs::path mod = pack("doubled");
		write(mod / "cards" / "a.json", kCheapPointBlank);
		write(mod / "cards" / "b.json", kCheapPointBlank);
		EXPECT_TRUE(mentions(errorFrom({kBase, mod}), "card point_blank is defined twice in pack doubled"));
	}

	TEST_F(PackLoading, EveryReferenceHasToResolve) {
		const fs::path mod = pack("broken");
		write(mod / "opponents" / "ghost" / "opponent.json", R"({
			"name": "Ghost", "class": "mook", "specialty": "", "flavorText": "", "threat": 1, "intentTier": "basic",
			"skills": {"ramming": 1, "gunnery": 1, "evade": 1, "speed": 1},
			"vehicle": {"name": "Ghost Bike", "maxStructure": 5, "weight": 1, "armor": 0, "speed": 3, "gunnery": 1, "evade": 1},
			"hitpoints": 3, "maxAdrenaline": 1, "handLimit": 7,
			"deck": [{"card": "phantom_shot", "count": 2}],
			"behavior": {"script": "behavior.lua"}
		})");
		EXPECT_TRUE(mentions(errorFrom({kBase, mod}), "behavior.script names behavior.lua, which isn't in the opponent's folder"));

		write(mod / "opponents" / "ghost" / "behavior.lua", "return {}\n");
		EXPECT_TRUE(mentions(errorFrom({kBase, mod}), "opponent ghost's deck names card phantom_shot, which no pack defines"));
	}

} // namespace
