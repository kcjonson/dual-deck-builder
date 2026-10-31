#pragma once

#include "RoadGrid.h"

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

		[[nodiscard]] bool isAlive() const { return hitpoints > 0; }

		bool operator==(const BattleDriver&) const = default;
	};

	// The crew a driven vehicle carries on with once its driver is down and nobody can take the wheel
	// (Combat Rules, Losing vehicles and drivers).
	inline constexpr CrewSkills kUnmannedCrew{.gunnery = 4, .evade = 3, .ramming = 2};

	struct BattleVehicle {
		Side side{Side::Player};
		// The driver whose vehicle it is, whoever rides in it now.
		DriverIndex owner;
		int			maxStructure{0};
		int			structure{0};
		// Armor past this is plating welded on for the fight (heavy-armor.md).
		int baseArmor{0};
		int armor{0};
		int shield{0};
		// The driver at the wheel adds their own speed.
		int						   baseSpeed{0};
		std::optional<DriverIndex> driver;
		std::optional<DriverIndex> passenger;
		// Set once it carries on as an escort: no driver, and these skills in every hit check.
		std::optional<CrewSkills> crew;
		RoadSlot				  slot;
		// A wreck, or a raider left with nobody at the wheel, stays on the road until the end of the turn.
		bool onRoad{true};

		[[nodiscard]] bool isEscort() const { return crew.has_value(); }

		bool operator==(const BattleVehicle&) const = default;
	};

	enum class Phase { PlayerTurn, EnemyTurn, Over };

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
		Phase					   phase{Phase::PlayerTurn};
		// During the enemy turn, the raider whose move it is. Its behavior picks from legalActions.
		std::optional<DriverIndex> actingRaider;
		std::optional<Outcome>	   outcome;

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

	// Base speed plus the speed of whoever is at the wheel; an escort's is its base speed. Never below 0.
	[[nodiscard]] int speedOf(const BattleState& state, VehicleIndex vehicle);

	// The skills a hit check reads when this vehicle is attacked: an escort's crew, else its driver's.
	[[nodiscard]] CrewSkills defenseOf(const BattleState& state, VehicleIndex vehicle);

	[[nodiscard]] bool isFlanking(const BattleVehicle& vehicle);

} // namespace rules
