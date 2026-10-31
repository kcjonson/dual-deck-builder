#pragma once

#include "BattleEvent.h"
#include "BattleState.h"

#include <vector>

namespace rules {

	// Shuffles a driver's deck from their seat's stream of the fight's randomness.
	void shuffleDeck(BattleState& state, DriverIndex driver, bool fromDiscard, std::vector<Event>& events);

	// Draws `count` cards, the ones past the driver's hand limit straight to discard. A deck that runs dry takes
	// its discard back, shuffled; with both empty the draw stops short.
	void drawCards(BattleState& state, DriverIndex driver, int count, std::vector<Event>& events);

	void discardHand(BattleState& state, DriverIndex driver, std::vector<Event>& events);

} // namespace rules
