#include <rules/core/CardText.h>
#include <rules/packs/Pack.h>

#include <gtest/gtest.h>

#include <filesystem>
#include <vector>

namespace {

	using namespace rules;

	CardDefinition card(std::string_view extra = "{}") {
		nlohmann::json json = nlohmann::json::parse(R"({
			"id": "brake_check",
			"name": "Brake Check",
			"summary": "[Flank]er drops back or takes {damage}. You -{slow} Speed.",
			"description": "A raider flanking on your shoulder drops back; an ambusher takes {damage} instead. Range 1. You are {slow} slower.",
			"rarity": "uncommon",
			"cost": 1,
			"targetType": "enemy_single",
			"effects": [{"type": "damage", "value": 4, "range": 1, "target": "target"}],
			"variables": {"damage": {"base": 4, "upgraded": 6}, "slow": {"base": 1}},
			"tags": ["utility"],
			"image": "cards/brake_check.png"
		})");
		json.merge_patch(nlohmann::json::parse(extra));
		return readCard(JsonReader(json, "card"));
	}

	TEST(CardText, FillsEveryVariableWithItsBaseOrUpgradedValue) {
		const CardDefinition brakeCheck = card();
		EXPECT_EQ(cardSummary(brakeCheck, false), "[Flank]er drops back or takes 4. You -1 Speed.");
		// A variable with no upgraded value keeps its base.
		EXPECT_EQ(cardSummary(brakeCheck, true), "[Flank]er drops back or takes 6. You -1 Speed.");
		EXPECT_EQ(cardName(brakeCheck, true), "Brake Check+");
	}

	TEST(CardText, AnUpgradeThatRewritesItsTextsShowsItsOwn) {
		const CardDefinition brakeCheck =
			card(R"({"upgrades": {"summary": "Drops back or takes {damage}. [Vulnerable].", "description": "As base, and Vulnerable."}})");
		EXPECT_EQ(cardSummary(brakeCheck, false), "[Flank]er drops back or takes 4. You -1 Speed.");
		EXPECT_EQ(cardSummary(brakeCheck, true), "Drops back or takes 6. [Vulnerable].");
		EXPECT_EQ(cardDescription(brakeCheck, true), "As base, and Vulnerable.");
	}

	TEST(CardText, BracketsMarkKeywordsInsideAWord) {
		const std::vector<TextWord> words = keywordWords("[Flank]er takes [Range 1].", KeywordMarks::Bracketed);
		ASSERT_EQ(words.size(), 4U);
		EXPECT_EQ(words[0], (TextWord{{.text = "Flank", .keyword = true}, {.text = "er"}}));
		EXPECT_EQ(words[1], (TextWord{{.text = "takes"}}));
		EXPECT_EQ(words[2], (TextWord{{.text = "Range", .keyword = true}}));
		EXPECT_EQ(words[3], (TextWord{{.text = "1", .keyword = true}, {.text = "."}}));
		EXPECT_EQ(plainText("[Flank]er takes [Range 1]."), "Flanker takes Range 1.");
	}

	TEST(CardText, TheFullTextMarksAKeywordWhereverItsNameStandsAsAWord) {
		const std::vector<TextPiece> pieces =
			keywordPieces("Gain 4 shield; sure-hit at range  2. Shielded and Armory aren't.", KeywordMarks::Anywhere);
		std::vector<std::string> marked;
		for (const TextPiece& piece : pieces) {
			if (piece.keyword) {
				marked.push_back(piece.text);
			}
		}
		EXPECT_EQ(marked, (std::vector<std::string>{"shield", "sure-hit", "range  2"}));
	}

	TEST(CardText, TheDetailViewExplainsTheFullTextsKeywordsThenTheSummarysThenTheRange) {
		std::vector<std::string_view> names;
		for (const Keyword* keyword : cardKeywords(card(), false)) {
			names.push_back(keyword->name);
		}
		EXPECT_EQ(names, (std::vector<std::string_view>{"Range 1", "Flank"}));
	}

	// DDB-599: no card in the base pack reaches the screen with a {variable} unfilled, and every keyword it brackets is one
	// the keyword boxes can explain.
	TEST(CardText, EveryBasePackCardsTextIsFilledAndItsKeywordsKnown) {
		const std::vector<std::filesystem::path> roots{std::filesystem::path(DDB_PACKS_DIR) / "base"};
		const Content							 content = loadPacks(roots);
		ASSERT_FALSE(content.cards.empty());
		for (const auto& [id, definition] : content.cards) {
			for (const bool upgraded : {false, true}) {
				const std::string summary = cardSummary(definition, upgraded);
				const std::string description = cardDescription(definition, upgraded);
				EXPECT_EQ(summary.find_first_of("{}"), std::string::npos) << id.value << ": " << summary;
				EXPECT_EQ(description.find_first_of("{}"), std::string::npos) << id.value << ": " << description;
				EXPECT_EQ(plainText(summary).find_first_of("[]"), std::string::npos) << id.value << ": " << summary;
				for (const TextPiece& piece : keywordPieces(summary, KeywordMarks::Bracketed)) {
					if (piece.keyword) {
						EXPECT_NE(findKeyword(piece.text), nullptr) << id.value << " brackets [" << piece.text << "]";
					}
				}
			}
		}
	}

} // namespace
