#include "Effect.h"

namespace rules {

	namespace {

		int readAmount(JsonReader& reader, std::string_view key) {
			const int amount = reader.requireInt(key);
			if (amount < 0) {
				reader.failAt(key, "can't be negative");
			}
			return amount;
		}

		std::optional<int> readOptionalAmount(JsonReader& reader, std::string_view key) {
			if (!reader.has(key)) {
				return std::nullopt;
			}
			return readAmount(reader, key);
		}

		std::optional<int> readDuration(JsonReader& reader) {
			const nlohmann::json& value = reader.requireValue("duration");
			if (value == "fight") {
				return std::nullopt;
			}
			const int turns = reader.requireInt("duration");
			if (turns < 1) {
				reader.failAt("duration", "must be at least 1 turn, or \"fight\" for the rest of the fight");
			}
			return turns;
		}

		std::optional<Condition> readOptionalCondition(JsonReader& reader, std::string_view key, ConditionSlot slot) {
			if (!reader.has(key)) {
				return std::nullopt;
			}
			return readCondition(reader, key, slot);
		}

		std::optional<Bonus> readBonus(JsonReader& reader) {
			std::optional<JsonReader> object = reader.optionalObject("bonus");
			if (!object) {
				return std::nullopt;
			}
			Bonus bonus{.value = object->requireInt("value"), .condition = readCondition(*object, "condition", ConditionSlot::Bonus)};
			object->finish();
			return bonus;
		}

		std::optional<RamFormula> readFormula(JsonReader& reader) {
			std::optional<JsonReader> object = reader.optionalObject("formula");
			if (!object) {
				return std::nullopt;
			}
			const RamFormula formula{.armorPer = readOptionalAmount(*object, "armorPer").value_or(0), .speedDiff = object->optionalInt("speedDiff").value_or(0)};
			object->finish();
			if (formula.armorPer == 0 && formula.speedDiff == 0) {
				reader.failAt("formula", "adds nothing; give it armorPer, speedDiff, or both");
			}
			return formula;
		}

		// A move's destination and mover, checked against what each move can do (movement-cards.md).
		void checkMove(JsonReader& reader, const effect::ChangePosition& move) {
			const bool moverIsTarget = move.target == EffectTarget::Target;
			if (move.target != EffectTarget::Self && !moverIsTarget) {
				reader.failAt("target", "must be \"self\" or \"target\" for a move");
			}
			const auto needsTo = [&](std::initializer_list<Destination> allowed) {
				if (!move.to) {
					reader.failAt("to", "is required for this move");
				}
				for (const Destination destination : allowed) {
					if (*move.to == destination) {
						return;
					}
				}
				reader.failAt("to", "isn't a destination this move can take");
			};
			const auto takesNoTo = [&] {
				if (move.to) {
					reader.failAt("to", "isn't something this move takes");
				}
			};
			const auto cantBeOptional = [&] {
				if (move.optional) {
					reader.failAt("optional", "isn't something this move takes");
				}
			};
			switch (move.move) {
				case Move::Flanking:
					takesNoTo();
					cantBeOptional();
					if (moverIsTarget) {
						reader.failAt("target", "must be \"self\": a flank moves whoever acts");
					}
					break;
				case Move::Swerve:
					needsTo({Destination::OtherLane, Destination::Outside, Destination::Ahead, Destination::Behind, Destination::Pick, Destination::PickRow}
					);
					break;
				case Move::Relocate:
					needsTo({Destination::Pick, Destination::BehindPartner});
					break;
				case Move::Swap:
					takesNoTo();
					if (!moverIsTarget) {
						reader.failAt("target", "must be \"target\": a swap trades slots with the card's target");
					}
					break;
				case Move::DropBack:
					takesNoTo();
					break;
				case Move::FormationShift:
					takesNoTo();
					cantBeOptional();
					if (moverIsTarget) {
						reader.failAt("target", "must be \"self\": a formation shift moves the caster's formation");
					}
					break;
			}
		}

		template <typename Simple>
		Simple readValueAndTarget(JsonReader& reader) {
			return Simple{.value = readAmount(reader, "value"), .target = reader.requireEnum("target", kEffectTargetNames)};
		}

	} // namespace

	Effect readEffect(JsonReader reader) {
		const std::string type = reader.requireString("type");
		Effect			  effect;
		if (type == "damage") {
			effect.kind = effect::Damage{
				.value = readAmount(reader, "value"),
				.target = reader.requireEnum("target", kEffectTargetNames),
				.range = readOptionalAmount(reader, "range"),
				.hitModifier = reader.optionalInt("hitModifier").value_or(0),
				.alwaysHits = reader.optionalBool("alwaysHits"),
				.onHit = reader.optionalBool("onHit"),
				.structureOnly = reader.optionalBool("structureOnly"),
				.attackType = reader.optionalEnum("attackType", kAttackTypeNames).value_or(AttackType::Ranged),
				.scaling = reader.optionalEnum("scaling", kScalingNames),
				.formula = readFormula(reader),
				.bonus = readBonus(reader),
				.condition = readOptionalCondition(reader, "condition", ConditionSlot::Effect),
			};
		} else if (type == "apply_status") {
			effect.kind = effect::ApplyStatus{
				.status = reader.requireEnum("status", kStatusNames),
				.target = reader.requireEnum("target", kEffectTargetNames),
				.duration = readDuration(reader),
				.value = reader.optionalInt("value"),
				.range = readOptionalAmount(reader, "range"),
				.alwaysHits = reader.optionalBool("alwaysHits"),
				.bonus = readBonus(reader),
				.condition = readOptionalCondition(reader, "condition", ConditionSlot::Effect),
			};
		} else if (type == "change_position") {
			const effect::ChangePosition move{
				.move = reader.requireEnum("position", kMoveNames),
				.to = reader.optionalEnum("to", kDestinationNames),
				.target = reader.requireEnum("target", kEffectTargetNames),
				.optional = reader.optionalBool("optional"),
				.onHit = reader.optionalBool("onHit"),
				.range = readOptionalAmount(reader, "range"),
				.condition = readOptionalCondition(reader, "condition", ConditionSlot::Effect),
			};
			checkMove(reader, move);
			effect.kind = move;
		} else if (type == "draw_cards") {
			effect.kind = readValueAndTarget<effect::DrawCards>(reader);
		} else if (type == "gain_shield") {
			effect.kind = readValueAndTarget<effect::GainShield>(reader);
		} else if (type == "gain_armor") {
			effect.kind = readValueAndTarget<effect::GainArmor>(reader);
		} else if (type == "gain_resource") {
			effect.kind = effect::GainResource{
				.resource = reader.requireEnum("resource", kResourceNames),
				.value = readAmount(reader, "value"),
				.target = reader.requireEnum("target", kEffectTargetNames),
			};
		} else if (type == "grant_adrenaline") {
			effect.kind = readValueAndTarget<effect::GrantAdrenaline>(reader);
		} else if (type == "heal") {
			effect.kind = effect::Heal{
				.value = readAmount(reader, "value"),
				.target = reader.requireEnum("target", kEffectTargetNames),
				.overflowToArmor = reader.optionalBool("overflowToArmor"),
			};
		} else if (type == "heal_driver") {
			effect.kind = readValueAndTarget<effect::HealDriver>(reader);
		} else if (type == "draw_fire") {
			effect.kind = effect::DrawFire{.target = reader.requireEnum("target", kEffectTargetNames)};
		} else if (type == "conditional") {
			effect::Conditional conditional{
				.condition = readCondition(reader, "condition", ConditionSlot::Conditional),
				.effects = readEffects(reader, "effects"),
			};
			if (conditional.effects.empty()) {
				reader.failAt("effects", "can't be empty");
			}
			effect.kind = std::move(conditional);
		} else {
			reader.failAt("type", "\"" + type + "\" is not an effect the rules know");
		}
		reader.finish();
		return effect;
	}

	std::vector<Effect> readEffects(JsonReader& reader, std::string_view key) {
		std::vector<Effect> effects;
		for (JsonReader& object : reader.requireObjects(key)) {
			effects.push_back(readEffect(std::move(object)));
		}
		return effects;
	}

} // namespace rules
