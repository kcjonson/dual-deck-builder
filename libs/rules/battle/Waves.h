#pragma once

#include "BattleEvent.h"
#include "BattleState.h"

#include <rules/packs/Pack.h>

#include <vector>

namespace rules {

	// Reinforcements (Combat Rules): the first wave is on the road when the fight starts and the rest wait in
	// BattleState::reinforcements. The next is due at the start of the player's turn once the road thins to its
	// arrival count or its turn count has passed, or as soon as the road is empty; it pulls in at the end of the enemy
	// turn, after close-up, as many as the road cap and the formation have room for.

	// The wave on the road, counting the first as 1: the latest with a raider pulled in, for "Wave 2 of 3".
	[[nodiscard]] int waveOnRoad(const BattleState& state);

	// Where the raiders pulling in at the end of this enemy turn will take the road if the player ends the turn now,
	// read off that turn played on a copy as the intents are, in the order they pull in: what "+2 arriving" counts
	// and the road marks by row (call 207). Only in the player's turn.
	[[nodiscard]] std::vector<RoadSlot> arrivalsOf(const BattleState& state, const Content& content);

	// The steps the turn takes them in; only the battle's own files use these.

	// Raiders on the road and still in the fight, which a wave's arrival count and the road cap count.
	[[nodiscard]] int raidersInFight(const BattleState& state);

	// Seats a raider at the end of the fight's lists, at the wheel of its own vehicle, for the caller to give a slot.
	// Nothing already in the fight moves, so every index, deck stream, and plan stream stays put.
	VehicleIndex seatRaider(BattleState& state, QueuedRaider raider);

	// A raider vehicle just out of the fight: its row, or its reserved slot's for a flanker, is where the next arrivals
	// fill from.
	void noteRaiderOut(BattleState& state, VehicleIndex vehicle);

	// Announces the next wave, if there's one and it isn't due already.
	void announceWave(BattleState& state, std::vector<Event>& events);

	// At the start of the player's turn: the next wave is due once the raiders in the fight are at or under its
	// arrival count, or its turn count has passed since the last wave first played.
	void checkWaveDue(BattleState& state, std::vector<Event>& events);

	// At the end of the enemy turn: the due wave pulls in, or the next whether it's due or not when the road is empty.
	// Its raiders take the formation's free slots in opening order, each lane from the row the latest raider out
	// left, up to the road cap, and shuffle their decks; the rest wait, still due.
	void landWave(BattleState& state, std::vector<Event>& events);

} // namespace rules
