#pragma once

#include "BattleEvent.h"
#include "BattleState.h"
#include "Policy.h"

#include <rules/packs/Pack.h>

#include <optional>
#include <vector>

namespace rules {

	// Commits every raider's plan for the enemy turn ahead (enemy-intent-planning.md), which ends Planning. They plan
	// in seat order on a rehearsal of that turn: a copy of the fight as the player's turn would leave it now, so a
	// flanker too slow to hold the shoulder plans from the slot it would drop back to, and each raider plans with
	// the ones before it already played out. The player's EndTurn then plays the plans without choosing again.
	std::vector<Event> planEnemyTurn(BattleState& state, const Content& content, const PolicyFor& policyFor);

	// The ranking a card's intent takes, by what it does to whom: hitting the player's side, then a status on it,
	// then guarding itself, then moving, then anything else (call 331).
	enum class IntentKind { Attack, Debuff, Defend, Move, Buff };

	// What one step of a raider's plan will do, as the player sees it.
	struct Intent {
		DriverIndex raider;
		int			step{0};
		IntentKind	kind{IntentKind::Buff};
		// What it's aimed at; none for a card on every enemy (`area`) or one on the raider itself.
		std::optional<VehicleIndex> target;
		bool						area{false};
		// Where its own move takes the raider, shown at every tier (call 332).
		std::optional<RoadSlot> movesTo;
		// An elite or a boss hides everything below (Combat Rules, Enemy intents).
		bool				  hidden{false};
		std::optional<CardId> card;
		// Each hit's damage, and the hit checks that miss: the checks have no dice, so a miss is known.
		std::vector<int> hits;
		int				 misses{0};
		// Shield, armor, and structure it gains.
		int defense{0};
		// The statuses it puts on the player's side.
		std::vector<Status> statuses;

		bool operator==(const Intent&) const = default;
	};

	// What the plans will do if the player ends the turn now, read off that enemy turn played out on a copy, so a
	// Vulnerable picked up since planning raises a hit and a step that would fizzle shows nothing. Only in the
	// player's turn.
	[[nodiscard]] std::vector<Intent> intentsOf(const BattleState& state, const Content& content);

} // namespace rules
