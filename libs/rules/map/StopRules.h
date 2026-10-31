#pragma once

#include "StopData.h"

#include <span>
#include <vector>

// The per-route rules a route's stops keep, in the order a run meets them (Area Map Generation, 9. Stops): no more than
// two fights in a row, and a non-fight in any three. Read literally the two are one rule; they part if a checkpoint,
// which can turn into a fight, isn't a non-fight (call 4). Then the second holds wherever the first does, so
// keepsRules checks it alone, and checkStopLayer reports them apart. Turning a stop calm, adding a calm one, or taking
// a fight away never breaks either.
namespace rules::map {

	[[nodiscard]] bool keepsRules(std::span<const StopType> types);

	struct ArrangeArgs {
		// The last stops, up to two, on every route behind the leg, the nearest last: every leg has one parent, so
		// they're the same on every route through it.
		std::span<const StopType> behind;
		int						  count{0};
		int						  fights{0};
		// No single POI owns the leg, so a route's floor fights may follow it on that route's own road.
		bool shared{false};
	};

	// Which of a leg's stops are fights, in driving order: `fights` of `count`, of every arrangement keeping the rules
	// after the stops behind it, the one ending on a calm stop where the leg is shared and can, then on the fewest
	// fights, so the legs past it have room, then the most evenly spread, then the one with its fights earliest. Past
	// kArrangeLimit stops, fights spread evenly and the last stop is calm. With no arrangement that keeps the rules it
	// takes a fight fewer, which the floor check catches.
	[[nodiscard]] std::vector<bool> arrange(const ArrangeArgs& args);

	// Stops on a leg past which arrange spreads its fights by a pattern rather than trying every arrangement.
	inline constexpr int kArrangeLimit = 12;

} // namespace rules::map
