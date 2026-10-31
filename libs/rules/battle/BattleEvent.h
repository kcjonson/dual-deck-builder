#pragma once

#include "BattleState.h"

#include <rules/core/Effect.h>

#include <optional>
#include <string>
#include <variant>

namespace rules {

	// Why a vehicle changed slot. The first six are a card's moves, which count as swerving this turn; losing the
	// flank (the end-of-turn drop-back) and the raiders' close-up happen between turns.
	enum class MoveCause { Flank, Swerve, Relocate, Swap, DropBack, FormationShift, LostTheFlank, CloseUp };

	// What happened, in order, for the combat log to word and a renderer to animate. Each says what changed
	// and by how much; anything else it needs is in the state.
	namespace event {
		// A side's turn begins. The player's turn number counts from 1; the enemy turn after it shares it.
		struct TurnStarted {
			int	 turn{1};
			Side side{Side::Player};

			bool operator==(const TurnStarted&) const = default;
		};
		// The enemy turn moves on to this raider.
		struct RaiderActing {
			DriverIndex raider;

			bool operator==(const RaiderActing&) const = default;
		};
		// Before the opening deal, or when a deck runs dry mid-draw and takes its discard back.
		struct DeckShuffled {
			DriverIndex driver;
			bool		fromDiscard{false};

			bool operator==(const DeckShuffled&) const = default;
		};
		struct CardDrawn {
			DriverIndex driver;
			BattleCard	card;

			bool operator==(const CardDrawn&) const = default;
		};
		// Drawn past the hand limit, so it went straight to discard.
		struct CardBurned {
			DriverIndex driver;
			BattleCard	card;

			bool operator==(const CardBurned&) const = default;
		};
		struct HandDiscarded {
			DriverIndex driver;
			int			cards{0};

			bool operator==(const HandDiscarded&) const = default;
		};
		struct AdrenalineRefilled {
			DriverIndex driver;
			int			adrenaline{0};

			bool operator==(const AdrenalineRefilled&) const = default;
		};
		struct ShieldCleared {
			VehicleIndex vehicle;
			int			 shield{0};

			bool operator==(const ShieldCleared&) const = default;
		};
		struct CardPlayed {
			DriverIndex					driver;
			BattleCard					card;
			std::optional<VehicleIndex> target;
			int							cost{0};
			// It went to the exhausted pile for the rest of the fight, not to discard.
			bool exhausted{false};

			bool operator==(const CardPlayed&) const = default;
		};
		// An attack's hit check: `skill` (gunnery or ramming) against `evade`, the hit modifier included.
		struct HitChecked {
			VehicleIndex attacker;
			VehicleIndex defender;
			AttackType	 attackType{AttackType::Ranged};
			int			 skill{0};
			int			 evade{0};
			bool		 hit{false};

			bool operator==(const HitChecked&) const = default;
		};
		// An area hit that doesn't reach one of the vehicles it would land on.
		struct OutOfRange {
			VehicleIndex attacker;
			VehicleIndex defender;
			int			 range{0};
			int			 reach{0};

			bool operator==(const OutOfRange&) const = default;
		};
		// A hit on a vehicle and where it went; what its occupants took follows as DriverDamaged.
		struct VehicleDamaged {
			VehicleIndex vehicle;
			int			 damage{0};
			int			 shield{0};
			int			 armor{0};
			int			 structure{0};

			bool operator==(const VehicleDamaged&) const = default;
		};
		struct DriverDamaged {
			DriverIndex driver;
			int			hitpoints{0};

			bool operator==(const DriverDamaged&) const = default;
		};
		// At 0 HP: a player's driver is down, a raider is dead. Either way they've left their seat.
		struct DriverDown {
			DriverIndex driver;

			bool operator==(const DriverDown&) const = default;
		};
		// A passenger moves to the wheel of the vehicle they ride in.
		struct TookTheWheel {
			DriverIndex	 driver;
			VehicleIndex vehicle;

			bool operator==(const TookTheWheel&) const = default;
		};
		// A player's vehicle with nobody left to drive it carries on as an escort.
		struct CarriesOnAsEscort {
			VehicleIndex vehicle;

			bool operator==(const CarriesOnAsEscort&) const = default;
		};
		// A raider with nobody left at the wheel is out of the fight.
		struct Unmanned {
			VehicleIndex vehicle;

			bool operator==(const Unmanned&) const = default;
		};
		struct VehicleWrecked {
			VehicleIndex vehicle;

			bool operator==(const VehicleWrecked&) const = default;
		};
		// A wreck's survivor takes a free passenger seat.
		struct JumpedAboard {
			DriverIndex	 driver;
			VehicleIndex vehicle;

			bool operator==(const JumpedAboard&) const = default;
		};
		struct CrashedOut {
			DriverIndex driver;

			bool operator==(const CrashedOut&) const = default;
		};
		// A vehicle out of the fight leaves the road at the end of the turn it went out in.
		struct LeftRoad {
			VehicleIndex vehicle;

			bool operator==(const LeftRoad&) const = default;
		};
		struct ShieldGained {
			VehicleIndex vehicle;
			int			 shield{0};

			bool operator==(const ShieldGained&) const = default;
		};
		struct ArmorGained {
			VehicleIndex vehicle;
			int			 armor{0};

			bool operator==(const ArmorGained&) const = default;
		};
		// Structure restored, and armor from what went past max structure.
		struct Repaired {
			VehicleIndex vehicle;
			int			 structure{0};
			int			 armor{0};

			bool operator==(const Repaired&) const = default;
		};
		struct DriverHealed {
			DriverIndex driver;
			int			hitpoints{0};

			bool operator==(const DriverHealed&) const = default;
		};
		struct AdrenalineGained {
			DriverIndex driver;
			int			adrenaline{0};

			bool operator==(const AdrenalineGained&) const = default;
		};
		struct VehicleMoved {
			VehicleIndex vehicle;
			RoadSlot	 from;
			RoadSlot	 to;
			MoveCause	 cause{MoveCause::Swerve};

			bool operator==(const VehicleMoved&) const = default;
		};
		// A move that can't happen. An optional one is skipped and the card plays on; any other cancels the
		// rest of the card.
		struct MoveBlocked {
			VehicleIndex vehicle;
			bool		 cancelsCard{false};

			bool operator==(const MoveBlocked&) const = default;
		};
		struct StatusApplied {
			VehicleIndex	   vehicle;
			Status			   status{Status::Vulnerable};
			int				   value{0};
			std::optional<int> turns;

			bool operator==(const StatusApplied&) const = default;
		};
		// It wore off at the start of a player turn, or an attack used it up.
		struct StatusEnded {
			VehicleIndex vehicle;
			Status		 status{Status::Vulnerable};

			bool operator==(const StatusEnded&) const = default;
		};
		// A raider whose stun just wore off, so it can't be stunned again until the next player turn.
		struct BecameSteady {
			VehicleIndex vehicle;

			bool operator==(const BecameSteady&) const = default;
		};
		// A stun that passes a Steady raider by.
		struct ShookOffStun {
			VehicleIndex vehicle;

			bool operator==(const ShookOffStun&) const = default;
		};
		// A stunned raider skips its part of the enemy turn.
		struct RaiderStunned {
			DriverIndex raider;

			bool operator==(const RaiderStunned&) const = default;
		};
		// An escort carries out an order, at the raider it's aimed at; none for Rally the Convoy's escort with no
		// raider in reach.
		struct OrderCarried {
			VehicleIndex				escort;
			std::optional<VehicleIndex> target;

			bool operator==(const OrderCarried&) const = default;
		};
		struct EscortSpent {
			VehicleIndex escort;

			bool operator==(const EscortSpent&) const = default;
		};
		// The escort draws fire across its row until the end of the next enemy turn.
		struct DrawingFire {
			VehicleIndex escort;

			bool operator==(const DrawingFire&) const = default;
		};
		// Step `step` was aimed at a vehicle in a row an escort draws fire across, and can reach the escort.
		struct FireDrawn {
			DriverIndex	 raider;
			int			 step{0};
			VehicleIndex from;
			VehicleIndex to;

			bool operator==(const FireDrawn&) const = default;
		};
		// A raider committed its coming turn, `steps` cards long.
		struct PlanCommitted {
			DriverIndex raider;
			int			steps{0};

			bool operator==(const PlanCommitted&) const = default;
		};
		// Step `step` of a raider's plan plays as planned; what it does follows.
		struct PlannedStepPlayed {
			DriverIndex raider;
			int			step{0};

			bool operator==(const PlannedStepPlayed&) const = default;
		};
		// Step `step` fizzles: the card is spent and does nothing, for `reason`.
		struct PlannedStepFizzled {
			DriverIndex raider;
			int			step{0};
			BattleCard	card;
			std::string reason;

			bool operator==(const PlannedStepFizzled&) const = default;
		};
		// Step `step` was aimed at a vehicle since wrecked, so it goes to the one its survivor rides in now.
		struct PlanRedirected {
			DriverIndex	 raider;
			int			 step{0};
			VehicleIndex from;
			VehicleIndex to;

			bool operator==(const PlanRedirected&) const = default;
		};
		// A raider wrecked or left without its driver drops the rest of its plan.
		struct PlanDropped {
			DriverIndex raider;

			bool operator==(const PlanDropped&) const = default;
		};
		// At the end of its side's turn, a death_mark takes whoever is at the wheel.
		struct DeathMarkTaken {
			VehicleIndex vehicle;
			DriverIndex	 driver;

			bool operator==(const DeathMarkTaken&) const = default;
		};
		// The next wave is announced, `wave` counting the first as 1: it pulls in at the end of this enemy turn as far as
		// there's room, which arrivalsOf reads.
		struct WaveDue {
			int wave{2};

			bool operator==(const WaveDue&) const = default;
		};
		// A queued raider takes a new seat, and its vehicle pulls into `slot`.
		struct RaiderArrived {
			DriverIndex	 raider;
			VehicleIndex vehicle;
			RoadSlot	 slot;

			bool operator==(const RaiderArrived&) const = default;
		};
		// A won fight's `rout` says why the raiders still in it fled; none for one won by taking every raider out.
		struct FightEnded {
			Outcome					 outcome{Outcome::Won};
			std::optional<RoutCause> rout;

			bool operator==(const FightEnded&) const = default;
		};
	} // namespace event

	using Event = std::variant<
		event::TurnStarted,
		event::RaiderActing,
		event::DeckShuffled,
		event::CardDrawn,
		event::CardBurned,
		event::HandDiscarded,
		event::AdrenalineRefilled,
		event::ShieldCleared,
		event::CardPlayed,
		event::HitChecked,
		event::OutOfRange,
		event::VehicleDamaged,
		event::DriverDamaged,
		event::DriverDown,
		event::TookTheWheel,
		event::CarriesOnAsEscort,
		event::Unmanned,
		event::VehicleWrecked,
		event::JumpedAboard,
		event::CrashedOut,
		event::LeftRoad,
		event::ShieldGained,
		event::ArmorGained,
		event::Repaired,
		event::DriverHealed,
		event::AdrenalineGained,
		event::VehicleMoved,
		event::MoveBlocked,
		event::StatusApplied,
		event::StatusEnded,
		event::BecameSteady,
		event::ShookOffStun,
		event::RaiderStunned,
		event::OrderCarried,
		event::EscortSpent,
		event::DrawingFire,
		event::FireDrawn,
		event::PlanCommitted,
		event::PlannedStepPlayed,
		event::PlannedStepFizzled,
		event::PlanRedirected,
		event::PlanDropped,
		event::DeathMarkTaken,
		event::WaveDue,
		event::RaiderArrived,
		event::FightEnded>;

} // namespace rules
