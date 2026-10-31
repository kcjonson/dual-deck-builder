#pragma once

#include "JsonReader.h"
#include "Road.h"

#include <variant>

namespace rules {

	// The statuses card data names. The battle adds the ones only it applies.
	enum class Status {
		SpeedReduction,
		Vulnerable,
		SpeedBoost,
		SpeedPlus,
		EvadeBoost,
		Stunned,
		TripleDamage,
		DeathMark,
		DamageBonus,
		BoxedIn
	};

	inline constexpr EnumNames<Status, 10> kStatusNames{{
		{"speed_reduction", Status::SpeedReduction},
		{"vulnerable", Status::Vulnerable},
		{"speed_boost", Status::SpeedBoost},
		{"speed_plus", Status::SpeedPlus},
		{"evade_boost", Status::EvadeBoost},
		{"stunned", Status::Stunned},
		{"triple_damage", Status::TripleDamage},
		{"death_mark", Status::DeathMark},
		{"damage_bonus", Status::DamageBonus},
		{"boxed_in", Status::BoxedIn},
	}};

	// Where the target's row is against the caster's.
	enum class RowRelation { Ahead, Behind, Same };

	inline constexpr EnumNames<RowRelation, 3> kRowRelationNames{
		{{"ahead", RowRelation::Ahead}, {"behind", RowRelation::Behind}, {"same", RowRelation::Same}}
	};

	namespace condition {
		struct TargetFlanking {
			bool operator==(const TargetFlanking&) const = default;
		};
		struct TargetFlankingInRow {
			bool operator==(const TargetFlankingInRow&) const = default;
		};
		struct TargetInFormation {
			bool operator==(const TargetInFormation&) const = default;
		};
		// Flanking with no reserved slot to drop back to.
		struct TargetAmbusher {
			bool operator==(const TargetAmbusher&) const = default;
		};
		// Both of the caster's side's driven vehicles are within `range` of the target.
		struct DrivenVehiclesWithin {
			int	 range{0};
			bool operator==(const DrivenVehiclesWithin&) const = default;
		};
		struct PartnerAttacked {
			bool operator==(const PartnerAttacked&) const = default;
		};
		struct TargetHasStatus {
			Status status{Status::Vulnerable};
			bool   operator==(const TargetHasStatus&) const = default;
		};
		struct SelfHasStatus {
			Status status{Status::Vulnerable};
			bool   operator==(const SelfHasStatus&) const = default;
		};
		struct CasterRow {
			Row	 row{Row::Center};
			bool operator==(const CasterRow&) const = default;
		};
		struct TargetRow {
			RowRelation relation{RowRelation::Same};
			bool		operator==(const TargetRow&) const = default;
		};
		// The caster's vehicle has changed slot this turn.
		struct CasterSwerved {
			bool operator==(const CasterSwerved&) const = default;
		};
	} // namespace condition

	using Condition = std::variant<
		condition::TargetFlanking,
		condition::TargetFlankingInRow,
		condition::TargetInFormation,
		condition::TargetAmbusher,
		condition::DrivenVehiclesWithin,
		condition::PartnerAttacked,
		condition::TargetHasStatus,
		condition::SelfHasStatus,
		condition::CasterRow,
		condition::TargetRow,
		condition::CasterSwerved>;

	// Where a condition sits, which limits the conditions it takes: an effect's own `condition` is about its
	// target, a bonus's about the board, and a conditional effect's about what has happened in the fight.
	enum class ConditionSlot { Effect, Bonus, Conditional };

	// The condition at `key`: a name ("target_flanking"), or an object with a `type` and its parameters
	// ({"type": "caster_row", "row": "ahead"}).
	[[nodiscard]] Condition readCondition(JsonReader& reader, std::string_view key, ConditionSlot slot);

} // namespace rules
