#include <rules/core/Card.h>
#include <rules/core/ContentError.h>

#include <gtest/gtest.h>

namespace {

	using namespace rules;

	// A valid card's JSON, with `extra` fields merged over it.
	nlohmann::json cardJson(std::string_view extra = "{}") {
		nlohmann::json card = nlohmann::json::parse(R"({
			"id": "point_blank",
			"name": "Point Blank",
			"summary": "Deal {damage}. [Range 1].",
			"description": "Deal {damage} damage. Range 1.",
			"rarity": "common",
			"cost": 1,
			"targetType": "enemy_single",
			"effects": [{"type": "damage", "value": 3, "range": 1, "target": "target"}],
			"variables": {"damage": {"base": 3, "upgraded": 5}},
			"tags": ["attack", "ranged"],
			"image": "cards/point_blank.png"
		})");
		card.merge_patch(nlohmann::json::parse(extra));
		return card;
	}

	std::string errorFrom(const nlohmann::json& json) {
		try {
			(void)readCard(JsonReader(json, "card"));
		} catch (const ContentError& error) {
			return error.what();
		}
		ADD_FAILURE() << "expected a ContentError";
		return "";
	}

	bool mentions(const std::string& message, std::string_view part) {
		return message.find(part) != std::string::npos;
	}

	TEST(Card, ReadsACard) {
		const nlohmann::json json = cardJson();
		const CardDefinition card = readCard(JsonReader(json, "card"));
		EXPECT_EQ(card.id, CardId{"point_blank"});
		EXPECT_EQ(card.target, CardTarget::EnemySingle);
		EXPECT_EQ(card.variables.at("damage").upgraded, 5);
		EXPECT_TRUE(card.hasTag("attack"));
		EXPECT_FALSE(card.upgrade.has_value());
	}

	TEST(Card, ChecksTheVariablesItsTextShows) {
		EXPECT_TRUE(mentions(errorFrom(cardJson(R"({"summary": "Deal {dmg}."})")), "shows {dmg}"));
		EXPECT_TRUE(mentions(errorFrom(cardJson(R"({"upgrades": {"summary": "Deal {range}."}})")), "shows {range}"));
	}

	TEST(Card, ChecksOrdersAndSignatures) {
		EXPECT_TRUE(mentions(errorFrom(cardJson(R"({"tags": ["order", "attack"]})")), "can't also be tagged attack"));
		EXPECT_TRUE(mentions(errorFrom(cardJson(R"({"targetType": "escort"})")), "has to be tagged order"));
		EXPECT_TRUE(mentions(errorFrom(cardJson(R"({"rarity": "signature"})")), "signature rarity exactly when"));
	}

	TEST(Card, RejectsAnUpgradeThatChangesNothing) {
		EXPECT_TRUE(mentions(errorFrom(cardJson(R"({"upgrades": {}})")), "changes nothing"));
	}

} // namespace
