#pragma once

#include "RoadGrid.h"

#include <rules/core/Condition.h>
#include <rules/core/Escort.h>
#include <rules/core/Ids.h>
#include <rules/core/RandomStreams.h>
#include <rules/core/Vehicle.h>

#include <compare>
#include <optional>
#include <variant>
#include <vector>

namespace rules {

	// A driver in the fight, by place in BattleState::drivers.
	struct DriverIndex {
		int value{0};

		auto operator<=>(const DriverIndex&) const = default;
	};

	// A vehicle in the fight, by place in BattleState::vehicles.
	struct VehicleIndex {
		int value{0};

		auto operator<=>(const VehicleIndex&) const = default;
	};

	// One card in a fight's piles.
	struct BattleCard {
		CardId card;
		bool   upgraded{false};

		bool operator==(const BattleCard&) const = default;
	};

	// One card of a raider's committed plan, as it was aimed when planned (enemy-intent-planning.md).
	struct PlannedStep {
		BattleCard					card;
		std::optional<VehicleIndex> target;
		std::optional<DriverIndex>	occupant;
		// The slot its move picked, if it picks one.
		std::optional<RoadSlot> destination;
		// Where its own move takes the raider, picked or not, which its intent outlines; a fixed swerve has to
		// still go there when it plays (call 330).
		std::optional<RoadSlot> movesTo;

		bool operator==(const PlannedStep&) const = default;
	};

	// A player's driver or a raider, each with their own deck, hand, and adrenaline (Combat Rules, Driver).
	// The numbers are the fight's own: a campaign driver comes in hurt, and a mod can change a hand limit.
	struct BattleDriver {
		Side side{Side::Player};
		// The archetype a player's driver is, or the opponent a raider is.
		std::variant<DriverId, OpponentId> profile;
		Skills							   skills;
		int								   hitpoints{0};
		int								   maxHitpoints{0};
		int								   adrenaline{0};
		int								   maxAdrenaline{0};
		int								   handLimit{0};
		// The top of the deck is its back.
		std::vector<BattleCard> deck;
		std::vector<BattleCard> hand;
		std::vector<BattleCard> discard;
		std::vector<BattleCard> exhausted;
		// Alive, but their vehicle was wrecked with no free seat to jump to.
		bool crashedOut{false};
		// Played a card tagged attack this turn, which their partner's partner_attacked reads.
		bool attackedThisTurn{false};
		// A raider's coming enemy turn, committed while the player's turn starts and played as it ends.
		std::vector<PlannedStep> plan;

		[[nodiscard]] bool isAlive() const { return hitpoints > 0; }

		bool operator==(const BattleDriver&) const = default;
	};

	// The crew a driven vehicle carries on with once its driver is down and nobody can take the wheel
	// (Combat Rules, Losing vehicles and drivers).
	inline constexpr CrewSkills kUnmannedCrew{.gunnery = 4, .evade = 3, .ramming = 2};

	// One status on a vehicle. Each application is its own, so two speed boosts add up.
	struct VehicleStatus {
		Status status{Status::Vulnerable};
		// Speed or evade it adds, or a damage bonus's percent; 0 for an on-or-off status.
		int value{0};
		// Player turn starts left before it wears off; none for the rest of the fight.
		std::optional<int> turns;

		bool operator==(const VehicleStatus&) const = default;
	};

	// A vehicle on the other side's shoulder (Combat Rules, Flanking). An ambusher started there and has neither.
	struct FlankState {
		// The formation slot it left, which nobody else can take while it's out.
		std::optional<RoadSlot> reservedSlot;
		// It holds the shoulder while it's faster than this vehicle, or while this one is out of the fight.
		std::optional<VehicleIndex> outran;

		bool operator==(const FlankState&) const = default;
	};

	struct BattleVehicle {
		Side side{Side::Player};
		// The driver whose vehicle it is, whoever rides in it now; none for a convoy escort.
		std::optional<DriverIndex> owner;
		// The convoy escort's type, which its signature card and a looter read; none for a driven vehicle,
		// carrying on as an escort or not.
		std::optional<EscortId> escort;
		int						maxStructure{0};
		int						structure{0};
		// Armor past this is plating welded on for the fight (heavy-armor.md).
		int baseArmor{0};
		int armor{0};
		int shield{0};
		// The driver at the wheel adds their own speed.
		int						   baseSpeed{0};
		std::optional<DriverIndex> driver;
		std::optional<DriverIndex> passenger;
		// An escort's crew, there from the start or once a driven vehicle carries on as one: no driver, and these
		// skills in every hit check.
		std::optional<CrewSkills> crew;
		// An escort that has acted this turn, which no order can send again until the player's next turn.
		bool	 spent{false};
		RoadSlot slot;
		// Set exactly while it's on a shoulder.
		std::optional<FlankState> flank;
		// A card changed its slot this turn, which Weave reads; the end-of-turn drop-back and close-up don't count.
		bool swervedThisTurn{false};
		// A wreck, or a raider left with nobody at the wheel, stays on the road until the end of the turn.
		bool					   onRoad{true};
		std::vector<VehicleStatus> statuses;
		// A raider whose stun just wore off can't be stunned again until the next player turn (Combat Rules,
		// Raider formation and stuns).
		bool steady{false};
		// Who got out of it alive when it was wrecked, driver first, whom a card planned at it follows.
		std::vector<DriverIndex> escaped;

		[[nodiscard]] bool isEscort() const { return crew.has_value(); }

		bool operator==(const BattleVehicle&) const = default;
	};

	// A fight opens each player turn in Planning, which planEnemyTurn ends. EnemyTurn is the rehearsal raiders plan
	// on: a fight itself plays its whole enemy turn inside the player's EndTurn.
	enum class Phase { Planning, PlayerTurn, EnemyTurn, Over };

	enum class Outcome { Won, Lost };

	// A fight, as a plain value: copy it to preview a play or look ahead, and the copy plays out exactly as the
	// original would. Drivers and vehicles refer to each other by index, and both lists keep every entry for
	// the whole fight, so an index never goes stale.
	struct BattleState {
		// The player's seats first, in seat order, then the raiders in the order they act.
		std::vector<BattleDriver>  drivers;
		std::vector<BattleVehicle> vehicles;
		RandomStreams			   random{0};
		int						   turn{1};
		Phase					   phase{Phase::Planning};
		// During the enemy turn, the raider whose move it is: on a rehearsal its policy picks from legalActions,
		// and in the fight its plan plays.
		std::optional<DriverIndex> actingRaider;
		std::optional<Outcome>	   outcome;
		// Escorts drawing fire until the end of the next enemy turn, in the order played; the last on a row covers it.
		std::vector<VehicleIndex> drawFireCovers;

		[[nodiscard]] BattleDriver&		   driver(DriverIndex index);
		[[nodiscard]] const BattleDriver&  driver(DriverIndex index) const;
		[[nodiscard]] BattleVehicle&	   vehicle(VehicleIndex index);
		[[nodiscard]] const BattleVehicle& vehicle(VehicleIndex index) const;

		bool operator==(const BattleState&) const = default;
	};

	// The vehicle a driver rides in, at the wheel or as a passenger.
	[[nodiscard]] std::optional<VehicleIndex> vehicleCarrying(const BattleState& state, DriverIndex driver);

	// On the road, with structure left, and an escort or someone at the wheel.
	[[nodiscard]] bool vehicleInFight(const BattleState& state, VehicleIndex vehicle);

	// Alive and riding in a vehicle that's in the fight. The down and the crashed out aren't.
	[[nodiscard]] bool driverInFight(const BattleState& state, DriverIndex driver);

	// The other player's seat, while there are two. A raider has no partner.
	[[nodiscard]] std::optional<DriverIndex> partnerOf(const BattleState& state, DriverIndex driver);

	[[nodiscard]] bool hasStatus(const BattleVehicle& vehicle, Status status);

	// What every application of a status adds together.
	[[nodiscard]] int statusTotal(const BattleVehicle& vehicle, Status status);

	// Carrying armor past its base: speed boosts don't count, slows still do (heavy-armor.md).
	[[nodiscard]] bool isHeavy(const BattleVehicle& vehicle);

	// Base speed, plus the speed of whoever is at the wheel (an escort has nobody), plus its speed statuses.
	// Never below 0.
	[[nodiscard]] int speedOf(const BattleState& state, VehicleIndex vehicle);

	// What an attack on this vehicle has to beat: its escort crew's evade or its driver's, plus Evade statuses.
	[[nodiscard]] int evadeOf(const BattleState& state, VehicleIndex vehicle);

	[[nodiscard]] bool isFlanking(const BattleVehicle& vehicle);

	// A vehicle on the road is in it, a wreck included, or a flanker holds it reserved.
	[[nodiscard]] bool slotTaken(const BattleState& state, RoadSlot slot);

} // namespace rules
