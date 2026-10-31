#pragma once

#include "BattleAction.h"
#include "BattleEvent.h"
#include "BattleState.h"

#include <rules/packs/Pack.h>

#include <optional>
#include <vector>

namespace rules {

	// The turn's steps that apply, planning, and the enemy turn share. Only the battle's own files use them.

	// The raider's vehicle, if it's in the fight with the raider at the wheel, the one place a raider acts from.
	[[nodiscard]] std::optional<VehicleIndex> raiderAtTheWheel(const BattleState& state, DriverIndex raider);

	// A player's driver plays from wherever they ride; a raider from the wheel, unless it's stunned.
	[[nodiscard]] bool canAct(const BattleState& state, DriverIndex driver);

	// Checked after every card and every enemy step (Combat Rules, How a fight ends). Lost once no player's driver
	// is still in the fight, a last hit that takes out both sides included. Won once no raider is on the road or
	// queued, or by a rout: a warband's leader out of the fight, or the nominal threat on the road and queued at or
	// under a quarter of the fight's start. A road with no raider left on it and a wave queued isn't over; the wave
	// is announced, to pull in at the end of the enemy turn.
	bool endIfOver(BattleState& state, std::vector<Event>& events);

	// The end of a played player turn, before the enemy turn: one that hurt no raider counts toward a break-off, and
	// one that hurt any starts the count again. Three running and the raiders break off, so there's no enemy turn.
	// A rehearsal never asks, since whether the turn was quiet hangs on what the player does in it.
	bool breakOffIfQuiet(BattleState& state, std::vector<Event>& events);

	// A new player turn: statuses tick, the hands go, adrenaline refills, Shield clears, everyone draws, the next
	// wave comes due if it's time, and the raiders are left to plan.
	void openPlayerTurn(BattleState& state, std::vector<Event>& events);

	// Into the enemy turn's start once the player's turn has ended and its death marks are taken, with nobody
	// acting yet.
	void beginEnemyTurn(BattleState& state, std::vector<Event>& events);

	// The next raider in seat order that can act, or the end of the enemy turn.
	void passToNextRaider(BattleState& state, std::vector<Event>& events);

	// The enemy turn's end, into the next player turn.
	void finishEnemyTurn(BattleState& state, std::vector<Event>& events);

	// The player's EndTurn: the enemy turn played from the raiders' plans, into the next player turn.
	void playEnemyTurn(BattleState& state, const Content& content, std::vector<Event>& events);

	// Pays for and plays a card the caller has checked.
	void playCard(BattleState& state, const Content& content, const action::PlayCard& play, std::vector<Event>& events);

} // namespace rules
