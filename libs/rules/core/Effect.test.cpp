#include <rules/core/ContentError.h>
#include <rules/core/Effect.h>

#include <gtest/gtest.h>

namespace {

	using namespace rules;

	Effect effectFrom(std::string_view text) {
		const auto json = nlohmann::json::parse(text);
		return readEffect(JsonReader(json, "effect"));
	}

	std::string errorFrom(std::string_view text) {
		try {
			(void)effectFrom(text);
		} catch (const ContentError& error) {
			return error.what();
		}
		ADD_FAILURE() << "expected a ContentError for " << text;
		return "";
	}

	bool mentions(const std::string& message, std::string_view part) {
		return message.find(part) != std::string::npos;
	}

	TEST(Effect, ReadsADamageEffectWithItsBonus) {
		const Effect effect = effectFrom(
			R"({"type": "damage", "value": 1, "range": 2, "target": "target", "bonus": {"value": 3, "condition": {"type": "caster_row", "row": "ahead"}}})"
		);
		const auto* damage = std::get_if<effect::Damage>(&effect.kind);
		ASSERT_NE(damage, nullptr);
		EXPECT_EQ(damage->value, 1);
		EXPECT_EQ(damage->range, 2);
		EXPECT_EQ(damage->target, EffectTarget::Target);
		ASSERT_TRUE(damage->bonus.has_value());
		EXPECT_EQ(damage->bonus->value, 3);
		EXPECT_EQ(damage->bonus->condition, Condition(condition::CasterRow{.row = Row::Ahead}));
	}

	TEST(Effect, ReadsARamFormula) {
		const Effect effect = effectFrom(R"({"type": "damage", "value": 0, "formula": {"armorPer": 10, "speedDiff": 1}, "attackType": "ramming", "target": "target"})");
		const auto&	 damage = std::get<effect::Damage>(effect.kind);
		EXPECT_EQ(damage.attackType, AttackType::Ramming);
		EXPECT_EQ(damage.formula, (RamFormula{.armorPer = 10, .speedDiff = 1}));
	}

	TEST(Effect, ReadsAConditionalsEffects) {
		const Effect effect = effectFrom(R"({
			"type": "conditional",
			"condition": {"type": "target_has_status", "status": "vulnerable"},
			"effects": [{"type": "gain_resource", "resource": "adrenaline", "value": 1, "target": "self"}]
		})");
		const auto& conditional = std::get<effect::Conditional>(effect.kind);
		EXPECT_EQ(conditional.condition, Condition(condition::TargetHasStatus{.status = Status::Vulnerable}));
		ASSERT_EQ(conditional.effects.size(), 1U);
		EXPECT_TRUE(std::holds_alternative<effect::GainResource>(conditional.effects[0].kind));
	}

	TEST(Effect, RejectsWhatTheRulesDontKnow) {
		EXPECT_TRUE(mentions(errorFrom(R"({"type": "explode", "target": "target"})"), "\"explode\" is not an effect the rules know"));
		EXPECT_TRUE(mentions(errorFrom(R"({"type": "draw_cards", "value": 1, "target": "self", "vaule": 2})"), "nothing reads: vaule"));
		EXPECT_TRUE(mentions(errorFrom(R"({"type": "damage", "value": 2, "target": "target", "condition": "target_sleeping"})"), "not a condition"));
		EXPECT_TRUE(mentions(errorFrom(R"({"type": "damage", "value": -2, "target": "target"})"), "can't be negative"));
	}

	TEST(Effect, KeepsEachConditionToItsSlot) {
		// A bonus reads the board; an effect's own condition is about its target.
		EXPECT_TRUE(mentions(
			errorFrom(R"({"type": "damage", "value": 1, "target": "target", "bonus": {"value": 1, "condition": "target_flanking"}})"), "can't be a bonus"
		));
		EXPECT_TRUE(mentions(errorFrom(R"({"type": "damage", "value": 1, "target": "target", "condition": "caster_swerved"})"), "can't be an effect's condition"));
		EXPECT_TRUE(mentions(
			errorFrom(R"({"type": "apply_status", "status": "vulnerable", "duration": 1, "target": "target", "condition": "driven_vehicles_within"})"),
			"takes parameters"
		));
	}

	TEST(Effect, ChecksAMoveAgainstWhatItCanDo) {
		EXPECT_NO_THROW((void)effectFrom(R"({"type": "change_position", "position": "swerve", "to": "pick_row", "target": "target", "optional": true})"));
		EXPECT_TRUE(mentions(errorFrom(R"({"type": "change_position", "position": "swerve", "target": "self"})"), ".to is required"));
		EXPECT_TRUE(mentions(errorFrom(R"({"type": "change_position", "position": "move", "to": "outside", "target": "self"})"), "isn't a destination"));
		EXPECT_TRUE(mentions(errorFrom(R"({"type": "change_position", "position": "flanking", "target": "target"})"), "a flank moves whoever acts"));
		EXPECT_TRUE(mentions(errorFrom(R"({"type": "change_position", "position": "swap", "target": "self"})"), "a swap trades slots"));
	}

} // namespace
