#pragma once

// What the battle scene's pieces share about aiming a card from the hand (Battle Screen Design 6; targeting-preview.md,
// slot-targeting.md, hand-target-preview.md): the card a drag carries, the picks it waits for, and what a play would do,
// read off apply on a copy of the fight. Targeting works them out; the dock, the road and the scene pass them around.

#include <rules/battle/BattleEvent.h>
#include <rules/battle/BattleState.h>

#include <cstdint>
#include <optional>
#include <string_view>
#include <vector>

namespace game::battle {

	// A drag from the hand carries this kind and a HandCard as its value.
	inline constexpr std::string_view kCardDrag = "card";

	// A card in a driver's hand, by its place there, as every legal PlayCard names it.
	struct HandCard {
		rules::DriverIndex driver;
		int				   handIndex = 0;

		bool operator==(const HandCard&) const = default;
	};

	// The picks a play waits for, in the order its effects need them (slot-targeting.md): a vehicle, the slot a move it
	// makes goes to, or which of the people aboard it lands on (Medical Kit).
	enum class AimStep : uint8_t { Vehicle, Slot, Occupant };

	// One pick: exactly one of the three is set, the one its step names.
	struct AimPick {
		std::optional<rules::VehicleIndex> vehicle;
		std::optional<rules::RoadSlot>	   slot;
		std::optional<rules::DriverIndex>  occupant;

		bool operator==(const AimPick&) const = default;
	};

	// What a play does to one vehicle, off apply on a copy: the hit check it makes there and what it takes off, for the
	// damage ghost on each bar it moves and the hit check that rides with the card.
	struct AimHit {
		rules::VehicleIndex						vehicle;
		std::optional<rules::event::HitChecked> check; // none for a play that makes no hit check on it
		int										shield = 0;
		int										armor = 0;
		int										structure = 0;
		int										driverHp = 0; // whoever is at the wheel
		int										passengerHp = 0;
		bool									outOfFight = false; // the play wrecks it, or leaves nobody at the wheel

		bool operator==(const AimHit&) const = default;
	};

	// A vehicle the play moves, and where (hand-target-preview.md, Moves).
	struct AimMove {
		rules::VehicleIndex vehicle;
		rules::RoadSlot		from;
		rules::RoadSlot		to;

		bool operator==(const AimMove&) const = default;
	};

	// A raider's range readout while a card is aimed (R1, R2, OUT), from the slot the card acts from.
	struct RangeChip {
		rules::VehicleIndex vehicle;
		int					range = 0;
		bool				inReach = false; // within the card's range
		bool				lands = false;	 // the card could land on it: the chip's red edge

		bool operator==(const RangeChip&) const = default;
	};

	// What a play with some picks would do, from apply on a copy.
	struct AimPreview {
		std::optional<rules::VehicleIndex> from; // the vehicle it acts from: the caster's, or an order's escort
		std::vector<AimHit>				   hits;
		std::vector<AimMove>			   moves;

		bool operator==(const AimPreview&) const = default;
	};

} // namespace game::battle
