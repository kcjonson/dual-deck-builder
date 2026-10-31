#include "Condition.h"

#include <optional>

namespace rules {

	namespace {

		ConditionSlot slotOf(const Condition& condition) {
			using namespace condition;
			if (std::holds_alternative<CasterRow>(condition) || std::holds_alternative<TargetRow>(condition) ||
				std::holds_alternative<CasterSwerved>(condition)) {
				return ConditionSlot::Bonus;
			}
			if (std::holds_alternative<PartnerAttacked>(condition) || std::holds_alternative<TargetHasStatus>(condition) ||
				std::holds_alternative<SelfHasStatus>(condition)) {
				return ConditionSlot::Conditional;
			}
			return ConditionSlot::Effect;
		}

		std::string_view slotName(ConditionSlot slot) {
			switch (slot) {
				case ConditionSlot::Effect:
					return "an effect's condition";
				case ConditionSlot::Bonus:
					return "a bonus";
				case ConditionSlot::Conditional:
					return "a conditional effect";
			}
			return "";
		}

		// A parameterless condition by name, or nullopt for a name that takes parameters or isn't one.
		std::optional<Condition> plainCondition(std::string_view name) {
			using namespace condition;
			if (name == "target_flanking") {
				return TargetFlanking{};
			}
			if (name == "target_flanking_in_row") {
				return TargetFlankingInRow{};
			}
			if (name == "target_in_formation") {
				return TargetInFormation{};
			}
			if (name == "target_ambusher") {
				return TargetAmbusher{};
			}
			if (name == "partner_attacked") {
				return PartnerAttacked{};
			}
			if (name == "caster_swerved") {
				return CasterSwerved{};
			}
			return std::nullopt;
		}

		bool takesParameters(std::string_view name) {
			return name == "driven_vehicles_within" || name == "target_has_status" || name == "self_has_status" || name == "caster_row" ||
				   name == "target_row";
		}

		Condition parameterCondition(JsonReader& object, std::string_view name) {
			using namespace condition;
			if (name == "driven_vehicles_within") {
				return DrivenVehiclesWithin{.range = object.requireInt("range")};
			}
			if (name == "target_has_status") {
				return TargetHasStatus{.status = object.requireEnum("status", kStatusNames)};
			}
			if (name == "self_has_status") {
				return SelfHasStatus{.status = object.requireEnum("status", kStatusNames)};
			}
			if (name == "caster_row") {
				return CasterRow{.row = object.requireEnum("row", kRowNames)};
			}
			return TargetRow{.relation = object.requireEnum("relation", kRowRelationNames)};
		}

	} // namespace

	Condition readCondition(JsonReader& reader, std::string_view key, ConditionSlot slot) {
		const nlohmann::json&	 value = reader.requireValue(key);
		std::optional<Condition> condition;
		if (value.is_string()) {
			const auto name = value.get<std::string>();
			condition = plainCondition(name);
			if (!condition) {
				reader.failAt(
					key,
					takesParameters(name) ? "\"" + name + "\" takes parameters, so it's an object with a \"type\""
										  : "\"" + name + "\" is not a condition the rules know"
				);
			}
		} else if (value.is_object()) {
			JsonReader		  object(value, reader.where() + "." + std::string(key));
			const std::string name = object.requireString("type");
			condition = takesParameters(name) ? std::optional<Condition>(parameterCondition(object, name)) : plainCondition(name);
			if (!condition) {
				object.failAt("type", "\"" + name + "\" is not a condition the rules know");
			}
			object.finish();
		} else {
			reader.failAt(key, "must be a condition's name or an object with a \"type\"");
		}
		if (slotOf(*condition) != slot) {
			reader.failAt(key, "can't be " + std::string(slotName(slot)) + "; it's only for " + std::string(slotName(slotOf(*condition))));
		}
		return *condition;
	}

} // namespace rules
