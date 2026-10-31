#pragma once

#include "Battle.h"

#include <rules/packs/Pack.h>

#include <cstdint>
#include <vector>

namespace rules {

	// Building a fight from an encounter (Runs and Encounters, Encounters and How big).

	// The encounters a fight of `skulls` draws from at `tier`, in id order: the tier's own, or tier 4's for a
	// stronghold's tier 5 with none of its own (call 202). Empty when no loaded pack has one.
	[[nodiscard]] std::vector<EncounterId> encountersFor(const Content& content, int skulls, int tier);

	// One of those, picked on the fight's seed from a stream of its own, "encounter", which the fight never draws on:
	// the same seed fields the same encounter, and the pick moves none of the fight's shuffles. Throws
	// std::invalid_argument for skulls or a tier out of range, or when no loaded pack has an encounter for them.
	[[nodiscard]] EncounterId pickEncounter(const Content& content, int skulls, int tier, uint32_t seed);

	// Fills the raider side of a setup whose players are seated: the encounter's first wave on the road, the rest
	// queued, its road cap, and the game stage, which queues one more of its grow raider in the last wave every two
	// stages and grows every raider at startBattle. A lone driver meets half the raiders, rounded up and never fewer
	// than four, cut from the last wave first, and the first wave keeps at least one (call 204). Throws
	// std::invalid_argument for an encounter no loaded pack defines, a stage past 0 to 6, or a setup with no players
	// or more than two.
	void fieldEncounter(BattleSetup& setup, const Content& content, const EncounterId& encounter, int stage);

} // namespace rules
