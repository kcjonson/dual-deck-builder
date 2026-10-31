#pragma once

#include "Condition.h"
#include "JsonReader.h"

#include <optional>
#include <variant>
#include <vector>

namespace rules {

	// Who an effect lands on, against the card's caster and target.
	enum class EffectTarget { Target, Self, Driver, SelfDriver, SameVehicle, EnemyAll };

	inline constexpr EnumNames<EffectTarget, 6> kEffectTargetNames{{
		{"target", EffectTarget::Target},
		{"self", EffectTarget::Self},
		{"driver", EffectTarget::Driver},
		{"self_driver", EffectTarget::SelfDriver},
		{"same_vehicle", EffectTarget::SameVehicle},
		{"enemy_all", EffectTarget::EnemyAll},
	}};

	// The skill a hit check reads.
	enum class AttackType { Ranged, Ramming };

	inline constexpr EnumNames<AttackType, 2> kAttackTypeNames{{{"ranged", AttackType::Ranged}, {"ramming", AttackType::Ramming}}};

	// What a card variable or an effect scales with.
	enum class Scaling { Ramming, Gunnery, Evade, VehicleWeight, Armor, Speed };

	inline constexpr EnumNames<Scaling, 6> kScalingNames{{
		{"ramming", Scaling::Ramming},
		{"gunnery", Scaling::Gunnery},
		{"evade", Scaling::Evade},
		{"vehicle_weight", Scaling::VehicleWeight},
		{"armor", Scaling::Armor},
		{"speed", Scaling::Speed},
	}};

	// What a change_position effect does (movement-cards.md).
	enum class Move { Flanking, Swerve, Relocate, Swap, DropBack, FormationShift };

	inline constexpr EnumNames<Move, 6> kMoveNames{{
		{"flanking", Move::Flanking},
		{"swerve", Move::Swerve},
		{"move", Move::Relocate},
		{"swap", Move::Swap},
		{"drop_back", Move::DropBack},
		{"formation_shift", Move::FormationShift},
	}};

	// Where a swerve or a relocation goes.
	enum class Destination { OtherLane, Outside, Ahead, Behind, Pick, PickRow, BehindPartner };

	inline constexpr EnumNames<Destination, 7> kDestinationNames{{
		{"other_lane", Destination::OtherLane},
		{"outside", Destination::Outside},
		{"ahead", Destination::Ahead},
		{"behind", Destination::Behind},
		{"pick", Destination::Pick},
		{"pick_row", Destination::PickRow},
		{"behind_partner", Destination::BehindPartner},
	}};

	enum class Resource { Adrenaline };

	inline constexpr EnumNames<Resource, 1> kResourceNames{{{"adrenaline", Resource::Adrenaline}}};

	// Added to an effect's value while its condition holds.
	struct Bonus {
		int		  value{0};
		Condition condition;

		bool operator==(const Bonus&) const = default;
	};

	// A ram's damage on top of its value: the attacker's armor / armorPer (0 for none), plus speedDiff times
	// how much faster the attacker is. Never below 0.
	struct RamFormula {
		int armorPer{0};
		int speedDiff{0};

		bool operator==(const RamFormula&) const = default;
	};

	struct Effect;

	namespace effect {
		struct Damage {
			int						  value{0};
			EffectTarget			  target{EffectTarget::Target};
			std::optional<int>		  range;
			int						  hitModifier{0};
			bool					  alwaysHits{false};
			bool					  onHit{false};
			bool					  structureOnly{false};
			AttackType				  attackType{AttackType::Ranged};
			std::optional<Scaling>	  scaling;
			std::optional<RamFormula> formula;
			std::optional<Bonus>	  bonus;
			std::optional<Condition>  condition;

			bool operator==(const Damage&) const = default;
		};
		struct ApplyStatus {
			Status		 status{Status::Vulnerable};
			EffectTarget target{EffectTarget::Target};
			// In turns, at least 1; none for the rest of the fight ("duration": "fight").
			std::optional<int>		 duration;
			std::optional<int>		 value;
			std::optional<int>		 range;
			bool					 alwaysHits{false};
			std::optional<Bonus>	 bonus;
			std::optional<Condition> condition;

			bool operator==(const ApplyStatus&) const = default;
		};
		struct ChangePosition {
			Move					   move{Move::Swerve};
			std::optional<Destination> to;
			// Self moves the caster's vehicle, Target the card's target.
			EffectTarget target{EffectTarget::Self};
			// A move with nowhere legal to go is skipped and the rest of the card plays.
			bool					 optional{false};
			bool					 onHit{false};
			std::optional<int>		 range;
			std::optional<Condition> condition;

			bool operator==(const ChangePosition&) const = default;
		};
		struct DrawCards {
			int			 value{0};
			EffectTarget target{EffectTarget::Self};

			bool operator==(const DrawCards&) const = default;
		};
		struct GainShield {
			int			 value{0};
			EffectTarget target{EffectTarget::Self};

			bool operator==(const GainShield&) const = default;
		};
		struct GainArmor {
			int			 value{0};
			EffectTarget target{EffectTarget::Self};

			bool operator==(const GainArmor&) const = default;
		};
		struct GainResource {
			Resource	 resource{Resource::Adrenaline};
			int			 value{0};
			EffectTarget target{EffectTarget::Self};

			bool operator==(const GainResource&) const = default;
		};
		struct GrantAdrenaline {
			int			 value{0};
			EffectTarget target{EffectTarget::Target};

			bool operator==(const GrantAdrenaline&) const = default;
		};
		struct Heal {
			int			 value{0};
			EffectTarget target{EffectTarget::Self};
			bool		 overflowToArmor{false};

			bool operator==(const Heal&) const = default;
		};
		struct HealDriver {
			int			 value{0};
			EffectTarget target{EffectTarget::Target};

			bool operator==(const HealDriver&) const = default;
		};
		struct DrawFire {
			EffectTarget target{EffectTarget::Target};

			bool operator==(const DrawFire&) const = default;
		};
		// Its effects land only while its condition holds.
		struct Conditional {
			Condition			condition;
			std::vector<Effect> effects;

			bool operator==(const Conditional&) const = default;
		};
	} // namespace effect

	struct Effect {
		std::variant<
			effect::Damage,
			effect::ApplyStatus,
			effect::ChangePosition,
			effect::DrawCards,
			effect::GainShield,
			effect::GainArmor,
			effect::GainResource,
			effect::GrantAdrenaline,
			effect::Heal,
			effect::HealDriver,
			effect::DrawFire,
			effect::Conditional>
			kind;

		bool operator==(const Effect&) const = default;
	};

	[[nodiscard]] Effect			  readEffect(JsonReader reader);
	[[nodiscard]] std::vector<Effect> readEffects(JsonReader& reader, std::string_view key);

} // namespace rules
